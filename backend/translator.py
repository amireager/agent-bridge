#!/usr/bin/env python3
"""Prose-only bilingual translator client preserving fenced & inline code."""

from __future__ import annotations

import json
import re
import time
import urllib.request

# Only split out multi-line fenced code blocks; inline `code` stays in-sentence
# so translate-kit's placeholder shield preserves full FA<->EN grammar & word order!
FENCE_RE = re.compile(r"(```[\s\S]*?```)")


def translate_prose(
    text: str,
    target_lang: str,
    tr_cfg: dict,
    glossary: list[dict],
) -> dict:
    if not text or not text.strip():
        return {"translation": "", "engine": "noop", "elapsed_ms": 0.0}

    engine_key = tr_cfg.get("engine", "online")
    if engine_key == "off":
        return {"translation": text, "engine": "off", "elapsed_ms": 0.0}

    base_url = tr_cfg.get("endpoints", {}).get(engine_key, "http://127.0.0.1:18091")

    working = text
    if target_lang == "en":
        for item in glossary:
            fa_term = item.get("fa", "").strip()
            en_term = item.get("en", "").strip()
            if fa_term and en_term and fa_term in working:
                working = working.replace(fa_term, f"`{en_term}`")

    # Split out fenced/inline code blocks so code is NEVER sent to translation
    parts = FENCE_RE.split(working)
    out_parts: list[str] = []
    total_ms = 0.0
    used_engine = engine_key

    for idx, part in enumerate(parts):
        if idx % 2 == 1:
            out_parts.append(part)
            continue
        if not part.strip():
            out_parts.append(part)
            continue

        payload = json.dumps(
            {"text": part, "from": "auto", "to": target_lang}
        ).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url.rstrip('/')}/translate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                total_ms += (time.perf_counter() - t0) * 1000.0
                used_engine = res.get("engine", engine_key)
                out_parts.append(res.get("translation", part))
        except Exception as exc:
            return {
                "translation": text,
                "engine": f"{engine_key}-error",
                "error": str(exc),
                "elapsed_ms": round(total_ms, 1),
            }

    final_text = "".join(out_parts)
    if target_lang == "en":
        for item in glossary:
            en_term = item.get("en", "").strip()
            if en_term:
                final_text = final_text.replace(f"`{en_term}`", en_term)

    return {
        "translation": final_text,
        "engine": used_engine,
        "elapsed_ms": round(total_ms, 1),
    }


def probe_translator_health(tr_cfg: dict) -> bool:
    eng = tr_cfg.get("engine", "online")
    if eng == "off":
        return True
    url = tr_cfg.get("endpoints", {}).get(eng, "http://127.0.0.1:18091")
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/health", timeout=1.2) as r:
            return r.status == 200
    except Exception:
        return False
