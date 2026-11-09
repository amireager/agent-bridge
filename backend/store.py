#!/usr/bin/env python3
"""Isolated ./.data/ persistence, per-model/per-agent SQLite telemetry, and retention manager."""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import time
from pathlib import Path

CLOUD_PRICING_PROFILES = {
    "claude-sonnet-4.6": {
        "label": "Claude Sonnet 4.6 ($3 / $0.30 / $15)",
        "input_per_m": 3.00,
        "cached_per_m": 0.30,
        "output_per_m": 15.00,
    },
    "claude-opus-4.6": {
        "label": "Claude Opus 4.6 ($15 / $1.50 / $75)",
        "input_per_m": 15.00,
        "cached_per_m": 1.50,
        "output_per_m": 75.00,
    },
    "gpt-5.4": {
        "label": "GPT-5.4 ($2.50 / $0.25 / $10)",
        "input_per_m": 2.50,
        "cached_per_m": 0.25,
        "output_per_m": 10.00,
    },
    "deepseek-v3": {
        "label": "DeepSeek V3 ($0.27 / $0.07 / $1.10)",
        "input_per_m": 0.27,
        "cached_per_m": 0.07,
        "output_per_m": 1.10,
    },
    "local-zero": {
        "label": "Local Hardware ($0.00)",
        "input_per_m": 0.00,
        "cached_per_m": 0.00,
        "output_per_m": 0.00,
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
        self.pi_agent_dir = self.data_dir / "pi-agent"
        self.db_path = self.data_dir / "telemetry.sqlite"
        self.config_path = self.data_dir / "config.json"
        self.glossary_path = self.data_dir / "glossary.json"
        self._db_lock = threading.Lock()

        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.pi_agent_dir.mkdir(parents=True, exist_ok=True)

        gi = self.data_dir / ".gitignore"
        if not gi.exists():
            gi.write_text("*\n", encoding="utf-8")

        self._init_db()
        self._ensure_defaults()

    def _init_db(self) -> None:
        with self._db_lock, sqlite3.connect(self.db_path) as conn:
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
                    prompt_ms REAL NOT NULL,
                    decode_ms REAL NOT NULL,
                    prompt_tps REAL NOT NULL,
                    decode_tps REAL NOT NULL,
                    shadow_cost_usd REAL NOT NULL,
                    preview TEXT NOT NULL
                );
                """
            )
            cols = {r[1] for r in conn.execute("PRAGMA table_info(llm_requests);").fetchall()}
            if "uncached_input" not in cols and "prompt_tokens" in cols:
                conn.executescript(
                    """
                    ALTER TABLE llm_requests RENAME TO llm_requests_legacy;
                    CREATE TABLE llm_requests (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ts REAL NOT NULL,
                        hour_bucket TEXT NOT NULL,
                        agent TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        model TEXT NOT NULL,
                        uncached_input INTEGER NOT NULL,
                        cached_input INTEGER NOT NULL,
                        output_tokens INTEGER NOT NULL,
                        prompt_ms REAL NOT NULL,
                        decode_ms REAL NOT NULL,
                        prompt_tps REAL NOT NULL,
                        decode_tps REAL NOT NULL,
                        shadow_cost_usd REAL NOT NULL,
                        preview TEXT NOT NULL
                    );
                    INSERT INTO llm_requests (
                        id, ts, hour_bucket, agent, session_id, model,
                        uncached_input, cached_input, output_tokens,
                        prompt_ms, decode_ms, prompt_tps, decode_tps,
                        shadow_cost_usd, preview
                    )
                    SELECT
                        id, ts, hour_bucket, agent, session_id, model_name,
                        prompt_tokens, cached_tokens, completion_tokens,
                        0.0, duration_ms, prompt_tps, decode_tps,
                        0.0, preview
                    FROM llm_requests_legacy;
                    DROP TABLE llm_requests_legacy;
                    """
                )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_req_ts ON llm_requests(ts);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_req_agent ON llm_requests(agent);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_req_model ON llm_requests(model);")

    @staticmethod
    def default_config() -> dict:
        return {
            "ui": {
                "sidebar_side": "left",
                "theme": "hacker-dark",
                "show_english_reply": True,   # نمایش/مخفی کردن متن انگلیسی کنار ترجمه فارسی
                "show_think": True,
                "show_tools": True,
                "show_inline_tokens": True,
                "show_shadow_cost": True,
                "show_wire_en": True,
            },
            "translation": {
                "engine": "builtin-online",   # builtin-online (0 external servers) | bergamot | plamo | offline-openai
                "proxy": "",                  # Optional proxy e.g. socks5h://127.0.0.1:1080 or http://127.0.0.1:10808
                "openai_model": "hy-mt2-1.8b",
                "endpoints": {
                    "bergamot": "http://127.0.0.1:18092",
                    "plamo": "http://127.0.0.1:18093",
                    "openai": "http://127.0.0.1:18093",
                },
            },
            "tap": {
                "upstream_url": os.environ.get("LLAMA_UPSTREAM", "http://127.0.0.1:8080"),
                "pi_bin": detect_pi_binary(),
                "workdir": str(Path.cwd()),
            },
            "pricing": {
                "active_profile": "claude-sonnet-4.6",
            },
            "retention": {
                "days": 7,  # 1 | 7 | 30 | 0 (forever)
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
            raw = self.load_config_raw()
            # Migrate upstream_url if previously under engine
            if "engine" in raw and "upstream_url" in raw["engine"]:
                raw.setdefault("tap", {})["upstream_url"] = raw["engine"]["upstream_url"]
            merged = self._deep_merge(defaults, raw)
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
            profile_key, CLOUD_PRICING_PROFILES["claude-sonnet-4.6"]
        )
        return (
            (uncached_in / 1_000_000.0) * p["input_per_m"]
            + (cached_in / 1_000_000.0) * p["cached_per_m"]
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
        prompt_ms: float,
        decode_ms: float,
        prompt_tps: float,
        decode_tps: float,
        shadow_cost_usd: float,
        preview: str,
    ) -> None:
        now = time.time()
        hour_bucket = time.strftime("%Y-%m-%d %H:00", time.localtime(now))
        with self._db_lock, sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO llm_requests (
                    ts, hour_bucket, agent, session_id, model,
                    uncached_input, cached_input, output_tokens,
                    prompt_ms, decode_ms, prompt_tps, decode_tps,
                    shadow_cost_usd, preview
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    now,
                    hour_bucket,
                    agent,
                    session_id,
                    model,
                    int(uncached_input),
                    int(cached_input),
                    int(output_tokens),
                    float(prompt_ms),
                    float(decode_ms),
                    float(prompt_tps),
                    float(decode_tps),
                    float(shadow_cost_usd),
                    preview[:200],
                ),
            )

    def prune_expired(self, days: int | None = None) -> dict:
        cfg = self.load_config()
        keep_days = cfg["retention"]["days"] if days is None else int(days)
        if keep_days <= 0:
            return {"deleted_requests": 0, "deleted_sessions": 0, "retention_days": 0}

        cutoff = time.time() - (keep_days * 86400.0)
        with self._db_lock, sqlite3.connect(self.db_path) as conn:
            cur = conn.execute("DELETE FROM llm_requests WHERE ts < ?", (cutoff,))
            deleted_reqs = cur.rowcount or 0

        deleted_sess = 0
        for p in self.sessions_dir.rglob("*.json"):
            try:
                if p.stat().st_mtime < cutoff:
                    p.unlink()
                    deleted_sess += 1
            except OSError:
                pass
        return {
            "deleted_requests": deleted_reqs,
            "deleted_sessions": deleted_sess,
            "retention_days": keep_days,
        }

    def clear_telemetry(self) -> None:
        with self._db_lock, sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM llm_requests;")

    def query_usage(
        self,
        pricing_profile: str,
        window_hours: int = 24,
        model_filter: str = "all",
        agent_filter: str = "all",
    ) -> dict:
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

        with self._db_lock, sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row

            obs_models = [
                r["model"]
                for r in conn.execute(
                    "SELECT DISTINCT model FROM llm_requests ORDER BY model ASC"
                ).fetchall()
            ]
            obs_agents = [
                r["agent"]
                for r in conn.execute(
                    "SELECT DISTINCT agent FROM llm_requests ORDER BY agent ASC"
                ).fetchall()
            ]

            def agg_since(since_ts: float) -> dict:
                row = conn.execute(
                    f"""
                    SELECT
                        COUNT(*) AS reqs,
                        COALESCE(SUM(uncached_input), 0) AS u_in,
                        COALESCE(SUM(cached_input), 0) AS c_in,
                        COALESCE(SUM(output_tokens), 0) AS out_t,
                        COALESCE(MAX(uncached_input + cached_input), 0) AS peak_ctx,
                        COALESCE(AVG(NULLIF(decode_tps, 0)), 0) AS avg_tg,
                        COALESCE(AVG(NULLIF(prompt_tps, 0)), 0) AS avg_pp
                    FROM llm_requests
                    WHERE ts >= ? {extra_sql}
                    """,
                    [since_ts, *params_extra],
                ).fetchone()
                u_in = int(row["u_in"])
                c_in = int(row["c_in"])
                out_t = int(row["out_t"])
                tot_in = u_in + c_in
                return {
                    "requests": int(row["reqs"]),
                    "uncached_input": u_in,
                    "cached_input": c_in,
                    "output_tokens": out_t,
                    "total_tokens": tot_in + out_t,
                    "peak_ctx_tokens": int(row["peak_ctx"]),
                    "cache_hit_pct": round((c_in / tot_in * 100.0), 1) if tot_in > 0 else 0.0,
                    "avg_decode_tps": round(float(row["avg_tg"]), 1),
                    "avg_prompt_tps": round(float(row["avg_pp"]), 1),
                    "shadow_cost_usd": round(
                        self.compute_shadow_cost(u_in, c_in, out_t, pricing_profile), 5
                    ),
                }

            by_agent_rows = conn.execute(
                """
                SELECT
                    agent,
                    COUNT(*) AS reqs,
                    COALESCE(SUM(uncached_input), 0) AS u_in,
                    COALESCE(SUM(cached_input), 0) AS c_in,
                    COALESCE(SUM(output_tokens), 0) AS out_t,
                    COALESCE(AVG(NULLIF(decode_tps, 0)), 0) AS avg_tg
                FROM llm_requests
                WHERE ts >= ?
                GROUP BY agent
                ORDER BY (u_in + c_in + out_t) DESC
                """,
                (win_since,),
            ).fetchall()

            by_model_rows = conn.execute(
                """
                SELECT
                    model,
                    COUNT(*) AS reqs,
                    COALESCE(SUM(uncached_input), 0) AS u_in,
                    COALESCE(SUM(cached_input), 0) AS c_in,
                    COALESCE(SUM(output_tokens), 0) AS out_t,
                    COALESCE(MAX(uncached_input + cached_input), 0) AS peak_ctx,
                    COALESCE(AVG(NULLIF(decode_tps, 0)), 0) AS avg_tg
                FROM llm_requests
                WHERE ts >= ?
                GROUP BY model
                ORDER BY (u_in + c_in + out_t) DESC
                """,
                (win_since,),
            ).fetchall()

            hourly_rows = conn.execute(
                f"""
                SELECT
                    hour_bucket,
                    COUNT(*) AS reqs,
                    COALESCE(SUM(uncached_input), 0) AS u_in,
                    COALESCE(SUM(cached_input), 0) AS c_in,
                    COALESCE(SUM(output_tokens), 0) AS out_t
                FROM llm_requests
                WHERE ts >= ? {extra_sql}
                GROUP BY hour_bucket
                ORDER BY hour_bucket ASC
                LIMIT 24
                """,
                [now - 86400.0, *params_extra],
            ).fetchall()

            recent_rows = conn.execute(
                f"""
                SELECT id, ts, agent, session_id, model, uncached_input, cached_input,
                       output_tokens, prompt_tps, decode_tps, preview
                FROM llm_requests
                WHERE ts >= ? {extra_sql}
                ORDER BY id DESC
                LIMIT 35
                """,
                [win_since, *params_extra],
            ).fetchall()

        def pack_group(rows: list, key_name: str) -> list[dict]:
            out = []
            for r in rows:
                u_in, c_in, out_t = int(r["u_in"]), int(r["c_in"]), int(r["out_t"])
                tot_in = u_in + c_in
                item = {
                    key_name: r[key_name],
                    "requests": int(r["reqs"]),
                    "uncached_input": u_in,
                    "cached_input": c_in,
                    "output_tokens": out_t,
                    "total_tokens": tot_in + out_t,
                    "cache_hit_pct": round((c_in / tot_in * 100.0), 1) if tot_in > 0 else 0.0,
                    "avg_decode_tps": round(float(r["avg_tg"]), 1),
                    "shadow_cost_usd": round(
                        self.compute_shadow_cost(u_in, c_in, out_t, pricing_profile), 5
                    ),
                }
                if "peak_ctx" in r.keys():
                    item["peak_ctx"] = int(r["peak_ctx"])
                out.append(item)
            return out

        hourly = [
            {
                "hour": r["hour_bucket"],
                "requests": int(r["reqs"]),
                "uncached_input": int(r["u_in"]),
                "cached_input": int(r["c_in"]),
                "output_tokens": int(r["out_t"]),
            }
            for r in hourly_rows
        ]

        recent = [
            {
                "id": int(r["id"]),
                "time": time.strftime("%H:%M:%S", time.localtime(float(r["ts"]))),
                "agent": r["agent"],
                "session_id": r["session_id"],
                "model": r["model"],
                "uncached_in": int(r["uncached_input"]),
                "cached_in": int(r["cached_input"]),
                "out_tok": int(r["output_tokens"]),
                "decode_tps": round(float(r["decode_tps"]), 1),
                "cost_usd": round(
                    self.compute_shadow_cost(
                        int(r["uncached_input"]),
                        int(r["cached_input"]),
                        int(r["output_tokens"]),
                        pricing_profile,
                    ),
                    6,
                ),
                "preview": r["preview"],
            }
            for r in recent_rows
        ]

        return {
            "window_hours": window_hours,
            "model_filter": model_filter,
            "agent_filter": agent_filter,
            "observed_models": obs_models,
            "observed_agents": obs_agents,
            "pricing_profile": pricing_profile,
            "pricing_profiles": CLOUD_PRICING_PROFILES,
            "window": agg_since(win_since),
            "last_1h": agg_since(now - 3600.0),
            "last_24h": agg_since(now - 86400.0),
            "all_time": agg_since(0.0),
            "by_agent": pack_group(by_agent_rows, "agent"),
            "by_model": pack_group(by_model_rows, "model"),
            "hourly": hourly,
            "recent": recent,
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
            "files": files[:40],
        }
