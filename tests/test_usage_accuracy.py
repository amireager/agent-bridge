import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.store import DataStore


class UsageAccuracyTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.store = DataStore(Path(self.temp.name) / ".data")

    def tearDown(self):
        self.temp.cleanup()

    def record(self, *, uncached, cached, output, input_reported=True, output_reported=True):
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
        )

    def test_total_includes_input_cache_and_output_and_peak_includes_output(self):
        self.record(uncached=80, cached=20, output=40)
        usage = self.store.query_usage("claude-sonnet-4.6", 24)
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

    def test_unreported_counts_are_not_silently_presented_as_reported(self):
        self.record(uncached=0, cached=0, output=0, input_reported=False, output_reported=False)
        window = self.store.query_usage("claude-sonnet-4.6", 24)["window"]
        self.assertEqual(window["missing_input_count_requests"], 1)
        self.assertEqual(window["missing_cache_count_requests"], 1)
        self.assertEqual(window["missing_output_count_requests"], 1)

    def test_chart_granularity_tracks_selected_window(self):
        for hours, expected in ((1, "hour"), (24, "hour"), (168, "day"), (720, "day"), (0, "week")):
            with self.subTest(hours=hours):
                usage = self.store.query_usage("claude-sonnet-4.6", hours)
                self.assertEqual(usage["chart_granularity"], expected)

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
