#!/usr/bin/env python3
"""
Built-in Online Translator + Clean API-Driven Offline Translator Client.
- Built-in Online (0 external servers needed): Google Chrome -> Google GTX -> MyMemory
  with SOCKS5H/HTTP proxy compatibility (via curl or urllib), Code/Path Shield, and SHA-256 LRU cache.
- Offline API Modes:
  1) Standard REST API (`POST /translate {"text", "from", "to"}`) — e.g. Bergamot (:18092) / PLaMo (:18093)
  2) OpenAI-compatible API (`POST /v1/chat/completions`) — e.g. llama-server running HY-MT2-1.8B or Qwen3.5-0.8B
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import ssl
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from collections import OrderedDict

# Loopback opener bypassing system HTTP_PROXY / ALL_PROXY (e.g. socks5h:// on NixOS)
LOOPBACK_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

FENCE_RE = re.compile(r"(```[\s\S]*?```)")
INLINE_SHIELD_RE = re.compile(
    r"(`[^`\n]+`|--[a-zA-Z0-9_-]+|(?:~|\B)/(?:[\w.-]+/)+[\w.-]*|\b[A-Z][A-Z0-9_]{2,}=\S+)"
)
PERSIAN_RE = re.compile(r"[\u0600-\u06FF]")
PERSIAN_DIGITS_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

_CACHE_LOCK = threading.Lock()
_LRU_CACHE: OrderedDict[str, tuple[str, str]] = OrderedDict()
_LRU_MAX = 2048


def _cache_get(key: str) -> tuple[str, str] | None:
    with _CACHE_LOCK:
        val = _LRU_CACHE.get(key)
        if val is not None:
            _LRU_CACHE.move_to_end(key)
        return val


def _cache_put(key: str, translation: str, engine: str) -> None:
    with _CACHE_LOCK:
        _LRU_CACHE[key] = (translation, engine)
        _LRU_CACHE.move_to_end(key)
        while len(_LRU_CACHE) > _LRU_MAX:
            _LRU_CACHE.popitem(last=False)


def _shield_inline(text: str) -> tuple[str, list[str]]:
    saved: list[str] = []

    def repl(m: re.Match[str]) -> str:
        idx = len(saved)
        saved.append(m.group(0))
        return f"[[{idx + 100}]]"

    return INLINE_SHIELD_RE.sub(repl, text), saved


def _unshield_inline(text: str, saved: list[str]) -> str:
    def restore(m: re.Match[str]) -> str:
        idx = int(m.group(1).translate(PERSIAN_DIGITS_MAP)) - 100
        return saved[idx] if 0 <= idx < len(saved) else m.group(0)

    return re.sub(r"\[\s*\[\s*([0-9۰-۹٠-٩]{3,4})\s*\]\s*\]", restore, text)


def _http_get_external(url: str, proxy: str = "", timeout: int = 8) -> bytes:
    """Uses curl first if present (handles socks5h:// tunnels natively on NixOS), else urllib."""
    curl_bin = shutil.which("curl")
    if curl_bin:
        cmd = [curl_bin, "-fsSL", "--max-time", str(timeout), "-A", "Mozilla/5.0"]
        if proxy:
            cmd += ["--proxy", proxy]
        cmd.append(url)
        res = subprocess.run(cmd, capture_output=True, timeout=timeout + 2)
        if res.returncode == 0 and res.stdout:
            return res.stdout

    handlers: list[urllib.request.BaseHandler] = []
    if proxy and not proxy.startswith("socks"):
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    elif proxy.startswith("socks"):
        raise RuntimeError(f"curl failed via proxy {proxy}")
    handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with opener.open(req, timeout=timeout) as resp:
        return resp.read()


def _builtin_online_segment(seg: str, src: str, tgt: str, proxy: str) -> tuple[str, str]:
    shielded, saved = _shield_inline(seg)

    def p_chrome() -> str:
        q = urllib.parse.urlencode({"client": "dict-chrome-ex", "sl": src, "tl": tgt, "q": shielded})
        data = json.loads(_http_get_external(f"https://clients5.google.com/translate_a/t?{q}", proxy).decode("utf-8"))
        if isinstance(data, list) and data:
            if isinstance(data[0], str):
                return "".join(data)
            if isinstance(data[0], list):
                return "".join(s[0] for s in data if s and s[0])
        raise ValueError("unexpected chrome payload")

    def p_gtx() -> str:
        q = urllib.parse.urlencode({"client": "gtx", "sl": src, "tl": tgt, "dt": "t", "q": shielded})
        data = json.loads(_http_get_external(f"https://translate.googleapis.com/translate_a/single?{q}", proxy).decode("utf-8"))
        return "".join(s[0] for s in data[0] if s and s[0])

    def p_mymemory() -> str:
        q = urllib.parse.urlencode({"q": shielded, "langpair": f"{src}|{tgt}"})
        data = json.loads(_http_get_external(f"https://api.mymemory.translated.net/get?{q}", proxy).decode("utf-8"))
        return str(data["responseData"]["translatedText"])

    last_err: Exception | None = None
    for name, fn in (("builtin:google-chrome", p_chrome), ("builtin:google-gtx", p_gtx), ("builtin:mymemory", p_mymemory)):
        try:
            out = _unshield_inline(fn(), saved).strip()
            if out:
                return out, name
        except Exception as exc:
            last_err = exc
    raise RuntimeError(f"Online translation unreachable ({last_err})")


def _offline_rest_segment(seg: str, target_lang: str, endpoint_url: str, engine_label: str) -> tuple[str, str]:
    payload = json.dumps({"text": seg, "from": "auto", "to": target_lang}).encode("utf-8")
    req = urllib.request.Request(
        f"{endpoint_url.rstrip('/')}/translate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with LOOPBACK_OPENER.open(req, timeout=20) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        return res.get("translation", seg), res.get("engine", engine_label)


def _offline_openai_segment(seg: str, src: str, tgt: str, base_url: str, model_name: str) -> tuple[str, str]:
    shielded, saved = _shield_inline(seg)
    lang_label = "English" if tgt == "en" else "Persian"
    sys_msg = (
        f"Translate the user text accurately to {lang_label}. "
        "Keep every [[NNN]] placeholder token untouched. Output ONLY the translation, nothing else."
    )
    body = {
        "model": model_name or "local-translator",
        "messages": [
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": shielded},
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with LOOPBACK_OPENER.open(req, timeout=45) as resp:
        parsed = json.loads(resp.read().decode("utf-8"))
        raw = parsed["choices"][0]["message"]["content"]
        raw = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
        return _unshield_inline(raw, saved), f"openai:{parsed.get('model', 'local')}"


def translate_prose(
    text: str,
    target_lang: str,
    tr_cfg: dict,
    glossary: list[dict],
) -> dict:
    if not text or not text.strip():
        return {"translation": "", "engine": "noop", "elapsed_ms": 0.0}

    engine_key = tr_cfg.get("engine", "builtin-online")
    if engine_key == "online":
        engine_key = "builtin-online"
    if engine_key == "off":
        return {"translation": text, "engine": "off", "elapsed_ms": 0.0}

    has_fa = bool(PERSIAN_RE.search(text))
    src = "fa" if has_fa else "en"
    tgt = ("en" if has_fa else "fa") if (not target_lang or target_lang == "auto") else target_lang.lower()

    working = text
    if tgt == "en":
        for item in glossary:
            fa_term = item.get("fa", "").strip()
            en_term = item.get("en", "").strip()
            if fa_term and en_term and fa_term in working:
                working = working.replace(fa_term, f"`{en_term}`")

    cache_key = hashlib.sha256(f"{engine_key}|{src}|{tgt}|{working}".encode("utf-8")).hexdigest()
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"translation": cached[0], "engine": f"{cached[1]} (cache)", "elapsed_ms": 0.1}

    parts = FENCE_RE.split(working)
    out_parts: list[str] = []
    used_engine = engine_key
    proxy = str(tr_cfg.get("proxy", "") or "").strip()
    endpoints = tr_cfg.get("endpoints", {})
    t0 = time.perf_counter()

    try:
        for idx, part in enumerate(parts):
            if idx % 2 == 1 or not part.strip():
                out_parts.append(part)
                continue

            if engine_key == "builtin-online":
                tr_seg, used_engine = _builtin_online_segment(part, src, tgt, proxy)
            elif engine_key in ("bergamot", "plamo"):
                ep = endpoints.get(engine_key, "http://127.0.0.1:18092" if engine_key == "bergamot" else "http://127.0.0.1:18093")
                tr_seg, used_engine = _offline_rest_segment(part, tgt, ep, engine_key)
            elif engine_key == "offline-openai":
                ep = endpoints.get("openai", "http://127.0.0.1:18093")
                mname = tr_cfg.get("openai_model", "hy-mt2-1.8b")
                tr_seg, used_engine = _offline_openai_segment(part, src, tgt, ep, mname)
            else:
                tr_seg = part

            out_parts.append(tr_seg)
    except Exception as exc:
        return {
            "translation": "",
            "engine": f"{engine_key}-error",
            "error": str(exc),
            "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
        }

    final_text = "".join(out_parts)
    if tgt == "en":
        for item in glossary:
            en_term = item.get("en", "").strip()
            if en_term:
                final_text = final_text.replace(f"`{en_term}`", en_term)

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    _cache_put(cache_key, final_text, used_engine)
    return {
        "translation": final_text,
        "engine": used_engine,
        "elapsed_ms": elapsed_ms,
    }


def probe_translator_health(tr_cfg: dict) -> bool:
    eng = tr_cfg.get("engine", "builtin-online")
    if eng in ("builtin-online", "online", "off"):
        return True
    eps = tr_cfg.get("endpoints", {})
    if eng == "offline-openai":
        url = f"{eps.get('openai', 'http://127.0.0.1:18093').rstrip('/')}/v1/models"
    else:
        default_ep = "http://127.0.0.1:18092" if eng == "bergamot" else "http://127.0.0.1:18093"
        url = f"{eps.get(eng, default_ep).rstrip('/')}/health"
    try:
        with LOOPBACK_OPENER.open(url, timeout=1.2) as r:
            return r.status == 200
    except Exception:
        return False
