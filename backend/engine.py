#!/usr/bin/env python3
"""Passive upstream model & KV-cache listener (never spawns or mutates model processes)."""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

PARAM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[bB]")
LOOPBACK_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def estimate_kv_mb_for_tokens(model_name: str, tokens: int, kv_type: str = "q8_0") -> float:
    """Passive KV-cache volume estimate (MB) for observed token count."""
    if tokens <= 0:
        return 0.0
    m = PARAM_RE.search(model_name or "")
    params_b = float(m.group(1)) if m else 4.0
    if params_b <= 0.8:
        fp16_bpt = 57344
    elif params_b <= 2.2:
        fp16_bpt = 73728
    elif params_b <= 4.5:
        fp16_bpt = 147456
    else:
        fp16_bpt = 196608
    mult = {"f16": 1.0, "q8_0": 0.53, "q4_0": 0.28}.get(kv_type.lower(), 0.53)
    return round((tokens * fp16_bpt * mult) / (1024 * 1024), 1)


def probe_upstream_passive(upstream_url: str) -> dict:
    """Read-only probe of the upstream OpenAI/llama-server endpoint."""
    upstream = upstream_url.rstrip("/")
    online = False
    detected_model = "listening..."
    server_ctx = 0

    try:
        with LOOPBACK_OPENER.open(f"{upstream}/v1/models", timeout=1.2) as r:
            obj = json.loads(r.read().decode("utf-8"))
            online = True
            items = obj.get("data", [])
            if items:
                detected_model = Path(items[0].get("id", "model")).name
    except Exception:
        pass

    if online:
        try:
            with LOOPBACK_OPENER.open(f"{upstream}/props", timeout=1.0) as r:
                props = json.loads(r.read().decode("utf-8"))
                server_ctx = int(props.get("default_generation_settings", {}).get("n_ctx", 0))
        except Exception:
            pass

    metrics: dict[str, float] = {}
    if online:
        try:
            with LOOPBACK_OPENER.open(f"{upstream}/metrics", timeout=1.2) as r:
                raw = r.read().decode("utf-8", errors="replace")
            for line in raw.splitlines():
                if line.startswith("llamacpp:") and " " in line:
                    k, v = line.split(None, 1)
                    k_short = k.replace("llamacpp:", "").split("{")[0]
                    try:
                        metrics[k_short] = round(float(v.strip()), 4)
                    except ValueError:
                        pass
        except Exception:
            pass

    peak_tok = int(metrics.get("n_tokens_max", 0))
    return {
        "online": online,
        "detected_model": detected_model,
        "server_ctx": server_ctx,
        "peak_kv_mb_q8": estimate_kv_mb_for_tokens(detected_model, peak_tok, "q8_0"),
        "full_ctx_kv_mb_q8": estimate_kv_mb_for_tokens(detected_model, server_ctx, "q8_0") if server_ctx else 0.0,
        "metrics": metrics,
    }
