#!/usr/bin/env python3
"""Isolated ./.data/ persistence, Dynamic Multi-Model Cost Matrix & KV-Cache Ledger."""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
from contextlib import contextmanager
import threading
import time
from pathlib import Path

CLOUD_PRICING_PROFILES = {
    "deepseek-v4.1-flash": {
        "label": "DeepSeek V4.1 Flash (off-peak baseline)",
        "rates": "$0.15 / $0.003 / $0.60 · peak x2",
        "input_per_m": 0.15,
        "cached_per_m": 0.003,
        "output_per_m": 0.60,
        "source": "https://api-docs.deepseek.com/quick_start/pricing/",
        "checked_at": "2026-10-25",
        "note": "نرخ پایهٔ off-peak؛ در ساعات peak قیمت ورودی/کش/خروجی دوبرابر است.",
    },
    "glm-5.3-flash": {
        "label": "GLM-5.3 Flash (USD list via Z.ai/OpenRouter)",
        "rates": "$0.15 / $0.03 / $0.50",
        "input_per_m": 0.15,
        "cached_per_m": 0.03,
        "output_per_m": 0.50,
        "source": "https://openrouter.ai/z-ai/glm-5.3-flash",
        "checked_at": "2026-10-25",
        "note": "نرخ USD مسیر Z.ai در OpenRouter؛ قیمت مستقیم Z.ai به CNY است و نرخ providerهای دیگر فرق می‌کند.",
    },
    "gpt-6-luna": {
        "label": "OpenAI GPT-6 Luna (standard)",
        "rates": "$0.10 / $0.01 / $0.50",
        "input_per_m": 0.10,
        "cached_per_m": 0.01,
        "output_per_m": 0.50,
        "source": "https://developers.openai.com/api/docs/pricing",
        "checked_at": "2026-10-25",
        "note": "نرخ standard؛ نرخ‌های Batch/Fast و ضریب long-context جداگانه‌اند.",
    },
    "gpt-6-astra": {
        "label": "OpenAI GPT-6 Astra (standard · premium)",
        "rates": "$10 / $1 / $50",
        "input_per_m": 10.00,
        "cached_per_m": 1.00,
        "output_per_m": 50.00,
        "source": "https://developers.openai.com/api/docs/pricing",
        "checked_at": "2026-10-25",
        "note": "نرخ standard برای مقایسهٔ ردهٔ گران؛ Batch/Fast و هزینهٔ نوشتن cache اعمال نشده.",
    },
}


def detect_pi_binary() -> str:
    found = shutil.which("pi")
    if found:
        return found
    lab_pi = Path("/var/tmp/lab/pi/node_modules/.bin/pi")
    if lab_pi.exists():
        return str(lab_pi)
    return "pi"


class DataStore:
    """Manages ./.data/ exclusively — zero files ever touch ~ or ~/.config."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir.resolve()
        self.sessions_dir = self.data_dir / "sessions"
        self.mirrors_dir = self.data_dir / "mirrors"
        self.pi_agent_dir = self.data_dir / "pi-agent"
        self.db_path = self.data_dir / "telemetry.sqlite"
        self.config_path = self.data_dir / "config.json"
        self.glossary_path = self.data_dir / "glossary.json"
        self._db_lock = threading.Lock()

        for d in (self.data_dir, self.sessions_dir, self.mirrors_dir, self.pi_agent_dir):
            d.mkdir(parents=True, exist_ok=True)

        gi = self.data_dir / ".gitignore"
        if not gi.exists():
            gi.write_text("*\n", encoding="utf-8")

        self._init_db()
        self._ensure_defaults()

    @contextmanager
    def _connection(self):
        conn = sqlite3.connect(self.db_path)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._db_lock, self._connection() as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS llm_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    hour_bucket TEXT NOT NULL,
                    agent TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    uncached_input INTEGER NOT NULL,
                    cached_input INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    input_count_reported INTEGER NOT NULL DEFAULT 0,
                    cache_count_reported INTEGER NOT NULL DEFAULT 0,
                    output_count_reported INTEGER NOT NULL DEFAULT 0,
                    saved_fa_tokens INTEGER NOT NULL DEFAULT 0,
                    kv_status TEXT NOT NULL DEFAULT 'cold',
                    prompt_ms REAL NOT NULL,
                    decode_ms REAL NOT NULL,
                    prompt_tps REAL NOT NULL,
                    decode_tps REAL NOT NULL,
                    shadow_cost_usd REAL NOT NULL,
                    preview TEXT NOT NULL,
                    provider TEXT NOT NULL DEFAULT '',
                    route_mode TEXT NOT NULL DEFAULT '',
                    latency_ms INTEGER NOT NULL DEFAULT 0,
                    translation_status TEXT NOT NULL DEFAULT 'unknown'
                );
                """
            )
            cols = {r[1] for r in conn.execute("PRAGMA table_info(llm_requests);").fetchall()}
            if "input_count_reported" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN input_count_reported INTEGER NOT NULL DEFAULT 0;")
            if "cache_count_reported" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN cache_count_reported INTEGER NOT NULL DEFAULT 0;")
            if "output_count_reported" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN output_count_reported INTEGER NOT NULL DEFAULT 0;")
            if "saved_fa_tokens" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN saved_fa_tokens INTEGER NOT NULL DEFAULT 0;")
            if "kv_status" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN kv_status TEXT NOT NULL DEFAULT 'cold';")
            if "provider" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN provider TEXT NOT NULL DEFAULT ''; ")
            if "route_mode" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN route_mode TEXT NOT NULL DEFAULT ''; ")
            if "latency_ms" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0;")
            if "translation_status" not in cols:
                conn.execute("ALTER TABLE llm_requests ADD COLUMN translation_status TEXT NOT NULL DEFAULT 'unknown';")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS route_failures (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    agent TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    route_mode TEXT NOT NULL DEFAULT '',
                    provider TEXT NOT NULL DEFAULT '',
                    model TEXT NOT NULL DEFAULT '',
                    http_status INTEGER NOT NULL DEFAULT 0,
                    error_kind TEXT NOT NULL,
                    latency_ms INTEGER NOT NULL DEFAULT 0,
                    translation_status TEXT NOT NULL DEFAULT 'unknown'
                );
                """
            )
            failure_cols = {r[1] for r in conn.execute("PRAGMA table_info(route_failures);").fetchall()}
            if "translation_status" not in failure_cols:
                conn.execute("ALTER TABLE route_failures ADD COLUMN translation_status TEXT NOT NULL DEFAULT 'unknown';")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_route_failures_ts ON route_failures(ts);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_req_ts ON llm_requests(ts);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_req_agent ON llm_requests(agent);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_req_model ON llm_requests(model);")

    @staticmethod
    def default_config() -> dict:
        return {
            "ui": {
                "sidebar_side": "left",
                "sidebar_width": 280,
                "theme": "openwebui-dark",   # openwebui-dark | mocha-dark | zed-dark | lobechat-dark
                "font_scale": "large",       # normal (14px) | large (15.5px) | xlarge (17px)
                "chat_mode": "interleaved",  # interleaved | fa_only | en_only
                "translate_thinking": False,
                "show_think": True,
                "think_default_mode": "half",  # closed | half (6 lines) | full
                "box_style": "outlined",       # outlined | soft | flat | glass | raised
                "think_style": "violet",       # violet | focus | minimal | outline | amber
                "tool_style": "cards",         # cards | compact | minimal | outlined | timeline
                "translation_style": "accent", # accent | soft | outline | underline | minimal | contrast
                "markdown_style": "reader",   # reader | compact | editorial | contrast | technical
                "paragraph_spacing": "comfortable", # snug | compact | comfortable | airy | spacious
                "image_mode": "click",         # off | placeholder | click | hover | inline
                "image_size": "large",         # small | medium | large | wide | viewport
                "code_wrap": "scroll",         # scroll | wrap | break | clip
                "code_theme": "midnight",      # midnight | surface | graphite | paper | neon
                "show_code_lines": False,
                "tool_output_mode": "terminal", # terminal | markdown | plain | json
                "show_tools": True,
                "show_inline_tokens": True,
                "show_shadow_cost": True,
                "recent_requests_limit": 10,
                "xray_limit": 40,
            },
            "translation": {
                "enabled": True,
                "engine": "builtin-online",  # builtin-online | custom-offline
                "proxy": "",
                "offline_protocol": "openai",  # openai (/v1/chat/completions) | rest (POST /translate)
                "offline_url": "http://127.0.0.1:18095",
                "offline_model": "local-translator",
            },
            "models": {
                "default_mode": "local",
                "default_model": "",
                "active_account_id": "",
                "online_fallback": False,
                "fallback_account_id": "",
                "fallback_model": "",
                "account_encryption": False,
            },
            "tap": {
                "upstream_url": os.environ.get("LLAMA_UPSTREAM", "http://127.0.0.1:8080"),
                "pi_bin": detect_pi_binary(),
                "workdir": str(Path.cwd()),
                "lab_enable_tools": False,
                "lab_system_prompt": "You are a sharp, concise coding and systems assistant. Think clearly and write clean code.",
            },
            "pricing": {
                "active_profile": "deepseek-v4.1-flash",
            },
            "retention": {
                "days": 7,
                "auto_prune_on_boot": True,
            },
        }

    def _deep_merge(self, base: dict, override: dict) -> dict:
        out = dict(base)
        for k, v in override.items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k] = self._deep_merge(out[k], v)
            else:
                out[k] = v
        return out

    def _ensure_defaults(self) -> None:
        defaults = self.default_config()
        if not self.config_path.exists():
            self.save_config(defaults)
        else:
            merged = self._deep_merge(defaults, self.load_config_raw())
            if merged["pricing"].get("active_profile") not in CLOUD_PRICING_PROFILES:
                merged["pricing"]["active_profile"] = "deepseek-v4.1-flash"
            self.save_config(merged)

        if not self.glossary_path.exists():
            self.save_glossary(
                [
                    {"fa": "کش کی‌وی", "en": "KV cache"},
                    {"fa": "پرامپت سیستم", "en": "system prompt"},
                    {"fa": "فشرده‌سازی کانتکست", "en": "context compaction"},
                    {"fa": "فراخوانی ابزار", "en": "tool call"},
                    {"fa": "کوانتیزاسیون", "en": "quantization"},
                ]
            )

    def load_config_raw(self) -> dict:
        try:
            return json.loads(self.config_path.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def load_config(self) -> dict:
        return self._deep_merge(self.default_config(), self.load_config_raw())

    def save_config(self, cfg: dict) -> None:
        self.config_path.write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def load_glossary(self) -> list[dict]:
        try:
            return json.loads(self.glossary_path.read_text(encoding="utf-8"))
        except Exception:
            return []

    def save_glossary(self, items: list[dict]) -> None:
        self.glossary_path.write_text(
            json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def compute_shadow_cost(
        self, uncached_in: int, cached_in: int, out_tok: int, profile_key: str
    ) -> float:
        p = CLOUD_PRICING_PROFILES.get(
            profile_key, CLOUD_PRICING_PROFILES["deepseek-v4.1-flash"]
        )
        return (
            (uncached_in / 1_000_000.0) * p["input_per_m"]
            + (cached_in / 1_000_000.0) * p["cached_per_m"]
            + (out_tok / 1_000_000.0) * p["output_per_m"]
        )

    def compute_nocache_cost(
        self, uncached_in: int, cached_in: int, out_tok: int, profile_key: str
    ) -> float:
        p = CLOUD_PRICING_PROFILES.get(
            profile_key, CLOUD_PRICING_PROFILES["deepseek-v4.1-flash"]
        )
        return (
            ((uncached_in + cached_in) / 1_000_000.0) * p["input_per_m"]
            + (out_tok / 1_000_000.0) * p["output_per_m"]
        )

    def record_llm_request(
        self,
        *,
        agent: str,
        session_id: str,
        model: str,
        uncached_input: int,
        cached_input: int,
        output_tokens: int,
        saved_fa_tokens: int = 0,
        input_count_reported: bool = False,
        cache_count_reported: bool = False,
        output_count_reported: bool = False,
        prompt_ms: float,
        decode_ms: float,
        prompt_tps: float,
        decode_tps: float,
        shadow_cost_usd: float,
        preview: str,
        provider: str = "",
        route_mode: str = "",
        latency_ms: int = 0,
        translation_status: str = "unknown",
    ) -> str:
        now = time.time()
        hour_bucket = time.strftime("%Y-%m-%d %H:00", time.localtime(now))
        tot_in = int(uncached_input) + int(cached_input)
        hit_ratio = (cached_input / tot_in) if tot_in > 0 else 0.0

        with self._db_lock, self._connection() as conn:
            prev = conn.execute(
                """
                SELECT uncached_input, cached_input, ts
                FROM llm_requests
                WHERE agent = ? AND model = ?
                ORDER BY id DESC LIMIT 1
                """,
                (agent, model),
            ).fetchone()

            if prev and (now - float(prev[2])) < 1200:
                prev_tot = int(prev[0]) + int(prev[1])
                prev_cached = int(prev[1])
                current_tot = int(uncached_input) + int(cached_input)
                likely_cache_drop = (
                    prev_tot >= 400
                    and prev_cached >= prev_tot * 0.35
                    and current_tot >= prev_tot * 0.70
                    and cached_input < prev_cached * 0.35
                    and uncached_input > 300
                )
                if likely_cache_drop:
                    kv_status = "flush"
                elif hit_ratio >= 0.75:
                    kv_status = "warm"
                elif hit_ratio >= 0.25:
                    kv_status = "partial"
                else:
                    kv_status = "cold"
            else:
                kv_status = "warm" if hit_ratio >= 0.75 else ("partial" if hit_ratio >= 0.25 else "cold")

            conn.execute(
                """
                INSERT INTO llm_requests (
                    ts, hour_bucket, agent, session_id, model,
                    uncached_input, cached_input, output_tokens,
                    input_count_reported, cache_count_reported, output_count_reported,
                    saved_fa_tokens, kv_status,
                    prompt_ms, decode_ms, prompt_tps, decode_tps,
                    shadow_cost_usd, preview, provider, route_mode, latency_ms, translation_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    now,
                    hour_bucket,
                    agent,
                    session_id,
                    model,
                    max(0, int(uncached_input)),
                    max(0, int(cached_input)),
                    max(0, int(output_tokens)),
                    int(bool(input_count_reported)),
                    int(bool(cache_count_reported)),
                    int(bool(output_count_reported)),
                    max(0, int(saved_fa_tokens)),
                    kv_status,
                    float(prompt_ms),
                    float(decode_ms),
                    float(prompt_tps),
                    float(decode_tps),
                    float(shadow_cost_usd),
                    preview[:200],
                    str(provider or "")[:100],
                    str(route_mode or "")[:32],
                    max(0, int(latency_ms)),
                    translation_status if translation_status in {"used", "bypassed", "unknown"} else "unknown",
                ),
            )
        return kv_status

    def record_route_failure(
        self,
        *,
        agent: str,
        session_id: str,
        route_mode: str,
        provider: str,
        model: str,
        error_kind: str,
        http_status: int = 0,
        latency_ms: int = 0,
        translation_status: str = "unknown",
    ) -> None:
        allowed_error_kinds = {"configuration", "upstream-http", "connection", "fallback"}
        safe_error_kind = error_kind if error_kind in allowed_error_kinds else "connection"
        with self._db_lock, self._connection() as conn:
            conn.execute(
                """INSERT INTO route_failures
                   (ts, agent, session_id, route_mode, provider, model, http_status, error_kind, latency_ms, translation_status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    time.time(), str(agent or "")[:160], str(session_id or "")[:160],
                    str(route_mode or "")[:32], str(provider or "")[:100],
                    str(model or "")[:160], max(0, int(http_status)), safe_error_kind,
                    max(0, int(latency_ms)),
                    translation_status if translation_status in {"used", "bypassed", "unknown"} else "unknown",
                ),
            )

    def prune_expired(self, days: int | None = None) -> dict:
        cfg = self.load_config()
        keep_days = cfg["retention"]["days"] if days is None else int(days)
        if keep_days <= 0:
            return {"deleted_requests": 0, "deleted_failures": 0, "deleted_sessions": 0, "retention_days": 0}

        cutoff = time.time() - (keep_days * 86400.0)
        with self._db_lock, self._connection() as conn:
            cur = conn.execute("DELETE FROM llm_requests WHERE ts < ?", (cutoff,))
            deleted_reqs = cur.rowcount or 0
            failed_cur = conn.execute("DELETE FROM route_failures WHERE ts < ?", (cutoff,))
            deleted_failures = failed_cur.rowcount or 0

        deleted_sess = 0
        for folder in (self.sessions_dir, self.mirrors_dir):
            for p in folder.rglob("*.json"):
                try:
                    if p.stat().st_mtime < cutoff:
                        p.unlink()
                        deleted_sess += 1
                except OSError:
                    pass
        return {
            "deleted_requests": deleted_reqs,
            "deleted_failures": deleted_failures,
            "deleted_sessions": deleted_sess,
            "retention_days": keep_days,
        }

    def clear_telemetry(self) -> None:
        with self._db_lock, self._connection() as conn:
            conn.execute("DELETE FROM llm_requests;")
            conn.execute("DELETE FROM route_failures;")
            conn.commit()
            conn.execute("VACUUM;")

    def query_usage(
        self,
        pricing_profile: str,
        window_hours: int = 24,
        model_filter: str = "all",
        agent_filter: str = "all",
        recent_limit: int = 10,
    ) -> dict:
        if pricing_profile not in CLOUD_PRICING_PROFILES:
            pricing_profile = "deepseek-v4.1-flash"
        now = time.time()
        win_since = 0.0 if window_hours <= 0 else (now - window_hours * 3600.0)

        where_extra = []
        params_extra: list = []
        if model_filter and model_filter != "all":
            where_extra.append("model = ?")
            params_extra.append(model_filter)
        if agent_filter and agent_filter != "all":
            where_extra.append("agent = ?")
            params_extra.append(agent_filter)

        extra_sql = (" AND " + " AND ".join(where_extra)) if where_extra else ""

        with self._db_lock, self._connection() as conn:
            conn.row_factory = sqlite3.Row

            obs_models = [
                r["model"]
                for r in conn.execute("SELECT DISTINCT model FROM llm_requests ORDER BY model ASC").fetchall()
            ]
            obs_agents = [
                r["agent"]
                for r in conn.execute("SELECT DISTINCT agent FROM llm_requests ORDER BY agent ASC").fetchall()
            ]

            def agg_since(since_ts: float) -> dict:
                row = conn.execute(
                    f"""
                    SELECT
                        COUNT(*) AS reqs,
                        COALESCE(SUM(CASE WHEN input_count_reported = 0 THEN 1 ELSE 0 END), 0) AS missing_input_counts,
                        COALESCE(SUM(CASE WHEN cache_count_reported = 0 THEN 1 ELSE 0 END), 0) AS missing_cache_counts,
                        COALESCE(SUM(CASE WHEN output_count_reported = 0 THEN 1 ELSE 0 END), 0) AS missing_output_counts,
                        COALESCE(SUM(uncached_input), 0) AS u_in,
                        COALESCE(SUM(cached_input), 0) AS c_in,
                        COALESCE(SUM(output_tokens), 0) AS out_t,
                        COALESCE(SUM(saved_fa_tokens), 0) AS saved_fa,
                        COALESCE(SUM(CASE WHEN kv_status = 'flush' THEN 1 ELSE 0 END), 0) AS flushes,
                        COALESCE(MAX(uncached_input + cached_input + output_tokens), 0) AS peak_ctx,
                        COALESCE(AVG(NULLIF(decode_tps, 0)), 0) AS avg_tg,
                        COALESCE(AVG(NULLIF(prompt_tps, 0)), 0) AS avg_pp
                    FROM llm_requests
                    WHERE ts >= ? {extra_sql}
                    """,
                    [since_ts, *params_extra],
                ).fetchone()
                u_in, c_in, out_t = int(row["u_in"]), int(row["c_in"]), int(row["out_t"])
                tot_in = u_in + c_in
                return {
                    "requests": int(row["reqs"]),
                    "missing_input_count_requests": int(row["missing_input_counts"]),
                    "missing_cache_count_requests": int(row["missing_cache_counts"]),
                    "missing_output_count_requests": int(row["missing_output_counts"]),
                    "uncached_input": u_in,
                    "cached_input": c_in,
                    "total_input": tot_in,
                    "output_tokens": out_t,
                    "total_tokens": tot_in + out_t,
                    "saved_fa_tokens": int(row["saved_fa"]),
                    "flush_count": int(row["flushes"]),
                    "peak_request_tokens": int(row["peak_ctx"]),
                    "peak_ctx_tokens": int(row["peak_ctx"]),  # legacy API alias
                    "cache_hit_pct": round((c_in / tot_in * 100.0), 1) if tot_in > 0 else 0.0,
                    "avg_decode_tps": round(float(row["avg_tg"]), 1),
                    "avg_prompt_tps": round(float(row["avg_pp"]), 1),
                    "shadow_cost_usd": round(self.compute_shadow_cost(u_in, c_in, out_t, pricing_profile), 5),
                    "nocache_cost_usd": round(self.compute_nocache_cost(u_in, c_in, out_t, pricing_profile), 5),
                }

            by_agent_rows = conn.execute(
                """
                SELECT agent, COUNT(*) AS reqs,
                       COALESCE(SUM(uncached_input), 0) AS u_in,
                       COALESCE(SUM(cached_input), 0) AS c_in,
                       COALESCE(SUM(output_tokens), 0) AS out_t,
                       COALESCE(SUM(saved_fa_tokens), 0) AS saved_fa,
                       COALESCE(SUM(CASE WHEN kv_status = 'flush' THEN 1 ELSE 0 END), 0) AS flushes,
                       COALESCE(AVG(NULLIF(prompt_tps, 0)), 0) AS avg_pp,
                       COALESCE(AVG(NULLIF(decode_tps, 0)), 0) AS avg_tg
                FROM llm_requests WHERE ts >= ?
                GROUP BY agent ORDER BY (u_in + c_in + out_t) DESC
                """,
                (win_since,),
            ).fetchall()

            by_model_rows = conn.execute(
                """
                SELECT model, COUNT(*) AS reqs,
                       COALESCE(SUM(uncached_input), 0) AS u_in,
                       COALESCE(SUM(cached_input), 0) AS c_in,
                       COALESCE(SUM(output_tokens), 0) AS out_t,
                       COALESCE(SUM(CASE WHEN kv_status = 'flush' THEN 1 ELSE 0 END), 0) AS flushes,
                       COALESCE(MAX(uncached_input + cached_input + output_tokens), 0) AS peak_ctx,
                       COALESCE(AVG(NULLIF(prompt_tps, 0)), 0) AS avg_pp,
                       COALESCE(AVG(NULLIF(decode_tps, 0)), 0) AS avg_tg
                FROM llm_requests WHERE ts >= ?
                GROUP BY model ORDER BY (u_in + c_in + out_t) DESC
                """,
                (win_since,),
            ).fetchall()

            if 0 < window_hours <= 24:
                chart_granularity = "hour"
                bucket_expr = "hour_bucket"
                chart_limit = 24
            elif 0 < window_hours <= 24 * 30:
                chart_granularity = "day"
                bucket_expr = "date(hour_bucket)"
                chart_limit = 31
            else:
                chart_granularity = "week"
                bucket_expr = "strftime('%Y-W%W', hour_bucket)"
                chart_limit = 54
            chart_rows = conn.execute(
                f"""
                SELECT {bucket_expr} AS bucket, COUNT(*) AS reqs,
                       COALESCE(SUM(uncached_input), 0) AS u_in,
                       COALESCE(SUM(cached_input), 0) AS c_in,
                       COALESCE(SUM(output_tokens), 0) AS out_t
                FROM llm_requests WHERE ts >= ? {extra_sql}
                GROUP BY bucket ORDER BY bucket ASC LIMIT ?
                """,
                [win_since, *params_extra, chart_limit],
            ).fetchall()

            recent_rows = conn.execute(
                f"""
                SELECT id, ts, agent, session_id, model, uncached_input, cached_input,
                       output_tokens, input_count_reported, cache_count_reported, output_count_reported,
                       saved_fa_tokens, kv_status, prompt_tps, decode_tps, preview, provider, route_mode, latency_ms, translation_status
                FROM llm_requests WHERE ts >= ? {extra_sql}
                ORDER BY id DESC LIMIT ?
                """,
                [win_since, *params_extra, max(1, min(100, int(recent_limit)))],
            ).fetchall()
            recent_failure_rows = conn.execute(
                f"""SELECT id, ts, agent, session_id, route_mode, provider, model,
                          http_status, error_kind, latency_ms, translation_status
                   FROM route_failures WHERE ts >= ? {extra_sql}
                   ORDER BY id DESC LIMIT ?""",
                [win_since, *params_extra, max(1, min(100, int(recent_limit)))],
            ).fetchall()
            win_summary = agg_since(win_since)
            last_1h_summary = agg_since(now - 3600.0)
            last_24h_summary = agg_since(now - 86400.0)
            all_time_summary = agg_since(0.0)

        # Simultaneous Multi-Model Cost Comparison Matrix (recalculated dynamically!)
        cost_matrix = []
        for pk, pinfo in CLOUD_PRICING_PROFILES.items():
            with_kv = self.compute_shadow_cost(
                win_summary["uncached_input"], win_summary["cached_input"], win_summary["output_tokens"], pk
            )
            no_kv = self.compute_nocache_cost(
                win_summary["uncached_input"], win_summary["cached_input"], win_summary["output_tokens"], pk
            )
            cost_matrix.append(
                {
                    "id": pk,
                    "label": pinfo["label"],
                    "rates": pinfo["rates"],
                    "source": pinfo.get("source", ""),
                    "note": pinfo.get("note", ""),
                    "cost_usd": round(with_kv, 4),
                    "nocache_usd": round(no_kv, 4),
                    "saved_usd": round(max(0.0, no_kv - with_kv), 4),
                }
            )

        def pack_group(rows: list, key_name: str) -> list[dict]:
            out = []
            for r in rows:
                u_in, c_in, out_t = int(r["u_in"]), int(r["c_in"]), int(r["out_t"])
                tot_in = u_in + c_in
                rk = r.keys()
                item = {
                    key_name: r[key_name],
                    "requests": int(r["reqs"]),
                    "uncached_input": u_in,
                    "cached_input": c_in,
                    "total_input": tot_in,
                    "output_tokens": out_t,
                    "total_tokens": tot_in + out_t,
                    "flushes": int(r["flushes"]) if "flushes" in rk else 0,
                    "saved_fa_tokens": int(r["saved_fa"]) if "saved_fa" in rk else 0,
                    "cache_hit_pct": round((c_in / tot_in * 100.0), 1) if tot_in > 0 else 0.0,
                    "avg_prompt_tps": round(float(r["avg_pp"]), 1) if "avg_pp" in rk else 0.0,
                    "avg_decode_tps": round(float(r["avg_tg"]), 1),
                    "shadow_cost_usd": round(self.compute_shadow_cost(u_in, c_in, out_t, pricing_profile), 4),
                    "nocache_cost_usd": round(self.compute_nocache_cost(u_in, c_in, out_t, pricing_profile), 4),
                }
                if "peak_ctx" in rk:
                    item["peak_request_tokens"] = int(r["peak_ctx"])
                    item["peak_ctx"] = int(r["peak_ctx"])  # legacy API alias
                out.append(item)
            return out

        hourly = [
            {
                "hour": r["bucket"],
                "requests": int(r["reqs"]),
                "uncached_input": int(r["u_in"]),
                "cached_input": int(r["c_in"]),
                "output_tokens": int(r["out_t"]),
            }
            for r in chart_rows
        ]

        recent = []
        for r in recent_rows:
            u_in, c_in, out_t = int(r["uncached_input"]), int(r["cached_input"]), int(r["output_tokens"])
            tot_in = u_in + c_in
            pct = round((c_in / tot_in * 100.0), 1) if tot_in > 0 else 0.0
            recent.append(
                {
                    "id": int(r["id"]),
                    "ts": float(r["ts"]),
                    "time": time.strftime("%H:%M:%S", time.localtime(float(r["ts"]))),
                    "agent": r["agent"],
                    "session_id": r["session_id"],
                    "model": r["model"],
                    "provider": r["provider"],
                    "route_mode": r["route_mode"],
                    "latency_ms": int(r["latency_ms"]),
                    "translation_status": r["translation_status"],
                    "status": "success",
                    "uncached_in": u_in,
                    "cached_in": c_in,
                    "total_in": tot_in,
                    "cache_pct": pct,
                    "out_tok": out_t,
                    "input_count_reported": bool(r["input_count_reported"]),
                    "cache_count_reported": bool(r["cache_count_reported"]),
                    "output_count_reported": bool(r["output_count_reported"]),
                    "saved_fa": int(r["saved_fa_tokens"]),
                    "kv_status": r["kv_status"],
                    "prompt_tps": round(float(r["prompt_tps"]), 1),
                    "decode_tps": round(float(r["decode_tps"]), 1),
                    "cost_usd": round(self.compute_shadow_cost(u_in, c_in, out_t, pricing_profile), 5),
                    "nocache_usd": round(self.compute_nocache_cost(u_in, c_in, out_t, pricing_profile), 5),
                    "preview": r["preview"],
                }
            )

        recent_failures = [
            {
                "id": int(r["id"]),
                "ts": float(r["ts"]),
                "time": time.strftime("%H:%M:%S", time.localtime(float(r["ts"]))),
                "agent": r["agent"],
                "session_id": r["session_id"],
                "route_mode": r["route_mode"],
                "provider": r["provider"],
                "model": r["model"],
                "http_status": int(r["http_status"]),
                "error_kind": r["error_kind"],
                "latency_ms": int(r["latency_ms"]),
                "translation_status": r["translation_status"],
                "status": "failed",
            }
            for r in recent_failure_rows
        ]

        return {
            "window_hours": window_hours,
            "model_filter": model_filter,
            "agent_filter": agent_filter,
            "observed_models": obs_models,
            "observed_agents": obs_agents,
            "pricing_profile": pricing_profile,
            "pricing_profiles": CLOUD_PRICING_PROFILES,
            "cost_matrix": cost_matrix,
            "window": win_summary,
            "last_1h": last_1h_summary,
            "last_24h": last_24h_summary,
            "all_time": all_time_summary,
            "by_agent": pack_group(by_agent_rows, "agent"),
            "by_model": pack_group(by_model_rows, "model"),
            "hourly": hourly,
            "chart_granularity": chart_granularity,
            "recent": recent,
            "recent_failures": recent_failures,
        }

    def data_dir_stats(self) -> dict:
        total_bytes = 0
        files = []
        for p in sorted(self.data_dir.rglob("*")):
            if p.is_file():
                sz = p.stat().st_size
                total_bytes += sz
                files.append({"path": str(p.relative_to(self.data_dir)), "bytes": sz})
        return {
            "data_dir": str(self.data_dir),
            "total_kib": round(total_bytes / 1024.0, 1),
            "file_count": len(files),
            "files": files[:45],
        }
