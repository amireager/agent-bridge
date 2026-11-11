import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.store import CLOUD_PRICING_PROFILES, DataStore
from backend.translator import estimate_persian_token_savings, estimate_text_tokens


class UsageAccuracyTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.store = DataStore(Path(self.temp.name) / ".data")

    def tearDown(self):
        self.temp.cleanup()

    def record(self, *, uncached, cached, output, input_reported=True, output_reported=True, provider="", route_mode="", latency_ms=0, translation_status="unknown"):
        return self.store.record_llm_request(
            agent="pi",
            session_id="test-session",
            model="test-model",
            uncached_input=uncached,
            cached_input=cached,
            output_tokens=output,
            input_count_reported=input_reported,
            cache_count_reported=input_reported,
            output_count_reported=output_reported,
            prompt_ms=1,
            decode_ms=1,
            prompt_tps=10,
            decode_tps=10,
            shadow_cost_usd=0,
            preview="",
            provider=provider,
            route_mode=route_mode,
            latency_ms=latency_ms,
            translation_status=translation_status,
        )

    def test_total_includes_input_cache_and_output_and_peak_includes_output(self):
        self.record(uncached=80, cached=20, output=40, provider="OpenRouter", route_mode="online", latency_ms=438, translation_status="used")
        usage = self.store.query_usage("deepseek-v4.1-flash", 24)
        window = usage["window"]
        self.assertEqual(window["total_input"], 100)
        self.assertEqual(window["output_tokens"], 40)
        self.assertEqual(window["total_tokens"], 140)
        self.assertEqual(window["peak_request_tokens"], 140)
        self.assertEqual(window["peak_ctx_tokens"], 140)
        self.assertEqual(window["missing_input_count_requests"], 0)
        self.assertEqual(window["missing_cache_count_requests"], 0)
        self.assertEqual(window["missing_output_count_requests"], 0)
        self.assertEqual(usage["recent"][0]["input_count_reported"], True)
        self.assertEqual(usage["recent"][0]["cache_count_reported"], True)
        self.assertEqual(usage["recent"][0]["output_count_reported"], True)
        self.assertEqual(usage["recent"][0]["provider"], "OpenRouter")
        self.assertEqual(usage["recent"][0]["route_mode"], "online")
        self.assertEqual(usage["recent"][0]["latency_ms"], 438)
        self.assertEqual(usage["recent"][0]["status"], "success")
        self.assertEqual(usage["recent"][0]["translation_status"], "used")

    def test_old_request_rows_have_unknown_destination_not_a_guessed_provider(self):
        self.record(uncached=10, cached=0, output=5)
        recent = self.store.query_usage("deepseek-v4.1-flash", 24)["recent"][0]
        self.assertEqual(recent["provider"], "")
        self.assertEqual(recent["route_mode"], "")

    def test_unreported_counts_are_not_silently_presented_as_reported(self):
        self.record(uncached=0, cached=0, output=0, input_reported=False, output_reported=False)
        window = self.store.query_usage("deepseek-v4.1-flash", 24)["window"]
        self.assertEqual(window["missing_input_count_requests"], 1)
        self.assertEqual(window["missing_cache_count_requests"], 1)
        self.assertEqual(window["missing_output_count_requests"], 1)

    def test_input_estimate_reports_source_and_sent_text_and_model_prices(self):
        estimate = estimate_persian_token_savings("سلام، لطفاً این را توضیح بده", "Please explain this.")
        self.assertGreater(estimate["fa_est"], 0)
        self.assertGreater(estimate["en_est"], 0)
        self.assertEqual(estimate["delta"], estimate["fa_est"] - estimate["en_est"])
        self.assertGreater(estimate_text_tokens("سلام دنیا"), estimate_text_tokens("hello world"))
        self.assertEqual(set(CLOUD_PRICING_PROFILES), {
            "deepseek-v4.1-flash", "glm-5.3-flash", "gpt-6-luna", "gpt-6-astra"
        })

    def test_chart_granularity_tracks_selected_window(self):
        for hours, expected in ((1, "hour"), (24, "hour"), (168, "day"), (720, "day"), (0, "week")):
            with self.subTest(hours=hours):
                usage = self.store.query_usage("deepseek-v4.1-flash", hours)
                self.assertEqual(usage["chart_granularity"], expected)

    def test_existing_telemetry_database_migrates_route_detail_columns(self):
        legacy_dir = Path(self.temp.name) / "legacy-data"
        legacy_dir.mkdir()
        db_path = legacy_dir / "telemetry.sqlite"
        with sqlite3.connect(db_path) as conn:
            conn.execute(
                """CREATE TABLE llm_requests (
                    id INTEGER PRIMARY KEY, ts REAL NOT NULL, agent TEXT NOT NULL,
                    model TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '',
                    route_mode TEXT NOT NULL DEFAULT ''
                )"""
            )
        DataStore(legacy_dir)
        with sqlite3.connect(db_path) as conn:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(llm_requests)")}
            self.assertIn("latency_ms", columns)
            self.assertIn("translation_status", columns)
            failed_columns = {row[1] for row in conn.execute("PRAGMA table_info(route_failures)")}
            self.assertIn("translation_status", failed_columns)

    def test_failed_route_is_auditable_without_logging_prompt_or_secret(self):
        self.store.record_route_failure(
            agent="omp-2", session_id="omp-2", route_mode="online-fallback",
            provider="OpenRouter", model="model-x", error_kind="fallback",
            http_status=502, latency_ms=913,
        )
        usage = self.store.query_usage("deepseek-v4.1-flash", 24)
        failure = usage["recent_failures"][0]
        self.assertEqual(failure["agent"], "omp-2")
        self.assertEqual(failure["provider"], "OpenRouter")
        self.assertEqual(failure["route_mode"], "online-fallback")
        self.assertEqual(failure["http_status"], 502)
        self.assertEqual(failure["error_kind"], "fallback")
        self.assertEqual(failure["latency_ms"], 913)
        self.assertEqual(failure["status"], "failed")

    def test_cache_drop_is_heuristic_and_requires_previously_warm_cache(self):
        self.record(uncached=100, cached=900, output=10)
        status = self.record(uncached=950, cached=50, output=10)
        self.assertEqual(status, "flush")

        store = DataStore(Path(self.temp.name) / "other-data")
        store.record_llm_request(
            agent="pi", session_id="s", model="m", uncached_input=900, cached_input=100,
            output_tokens=10, prompt_ms=1, decode_ms=1, prompt_tps=1, decode_tps=1,
            shadow_cost_usd=0, preview="",
        )
        status = store.record_llm_request(
            agent="pi", session_id="s", model="m", uncached_input=950, cached_input=50,
            output_tokens=10, prompt_ms=1, decode_ms=1, prompt_tps=1, decode_tps=1,
            shadow_cost_usd=0, preview="",
        )
        self.assertNotEqual(status, "flush")


if __name__ == "__main__":
    unittest.main()
