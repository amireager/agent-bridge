#!/usr/bin/env python3
"""
Built-in Online + User-Customizable Offline API Translator:
1) Paragraph-by-paragraph 1-to-1 aligned Markdown block translation (Immersive-Translate style)
2) Collapsible `<think>` reasoning block translation support
3) Strict Fenced/Inline Code, Path, and CLI-Flag Shielding
4) Proxy Ping Tester + User-Defined Custom Local API (OpenAI or Simple JSON REST on any port)
5) Zero-overhead O(1) Persian->English BPE Token Savings Estimator
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

LOOPBACK_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

FENCE_RE = re.compile(r"(```[\s\S]*?```)")
INLINE_SHIELD_RE = re.compile(
    r"(`[^`\n]+`|--[a-zA-Z0-9_-]+|(?:~|\B)/(?:[\w.-]+/)+[\w.-]*|\b[A-Z][A-Z0-9_]{2,}=\S+)"
)
PERSIAN_RE = re.compile(r"[\u0600-\u06FF]")
PERSIAN_RUN_RE = re.compile(r"[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)*")
LATIN_RE = re.compile(r"[A-Za-z]")
PERSIAN_DIGITS_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

_CACHE_LOCK = threading.Lock()
_LRU_CACHE: OrderedDict[str, tuple[str, str]] = OrderedDict()
_LRU_MAX = 3000


def estimate_persian_token_savings(raw_fa_text: str, sent_en_text: str) -> dict:
    """Zero-overhead O(1) BPE token estimate (pure multiplication, zero CPU load)."""
    if not raw_fa_text or not PERSIAN_RE.search(raw_fa_text):
        en_t = max(1, round(len(sent_en_text or "") * 0.25)) if sent_en_text else 0
        return {"fa_est": en_t, "en_est": en_t, "saved": 0, "saved_pct": 0.0}

    fa_chars = len(PERSIAN_RE.findall(raw_fa_text))
    other_chars = max(0, len(raw_fa_text) - fa_chars)
    fa_est = max(1, round(fa_chars * 0.68 + other_chars * 0.25))
    en_est = max(1, round(len(sent_en_text or "") * 0.25))
    saved = max(0, fa_est - en_est)
    pct = round((saved / fa_est) * 100.0, 1) if fa_est > 0 else 0.0
    return {"fa_est": fa_est, "en_est": en_est, "saved": saved, "saved_pct": pct}


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
    curl_bin = shutil.which("curl")
    if curl_bin:
        cmd = [curl_bin, "-fsSL", "--max-time", str(timeout), "-A", "Mozilla/5.0"]
        if proxy:
            cmd += ["--proxy", proxy]
        cmd.append(url)
        res = subprocess.run(cmd, capture_output=True, timeout=timeout + 2)
        if res.returncode == 0 and res.stdout:
            return res.stdout
        if proxy:
            err_txt = res.stderr.decode("utf-8", errors="replace").strip() or f"exit {res.returncode}"
            raise RuntimeError(f"Proxy connection failed ({proxy}): {err_txt}")

    handlers: list[urllib.request.BaseHandler] = []
    if proxy and not proxy.startswith("socks"):
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    elif proxy.startswith("socks"):
        raise RuntimeError(f"SOCKS proxy requires curl ({proxy})")
    handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with opener.open(req, timeout=timeout) as resp:
        return resp.read()


def _builtin_online_segment(seg: str, src: str, tgt: str, proxy: str, provider: str = "builtin-online") -> tuple[str, str]:
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

    providers = {
        "online-google": ("online:google-chrome", p_chrome),
        "online-google-gtx": ("online:google-gtx", p_gtx),
        "online-mymemory": ("online:mymemory", p_mymemory),
    }
    chain = [providers[provider]] if provider in providers else list(providers.values())
    last_err: Exception | None = None
    for name, fn in chain:
        try:
            out = _unshield_inline(fn(), saved).strip()
            if out:
                return out, name
        except Exception as exc:
            last_err = exc
    raise RuntimeError(f"Online translation unreachable ({last_err})")


def _offline_rest_segment(seg: str, src: str, tgt: str, endpoint_url: str) -> tuple[str, str]:
    shielded, saved = _shield_inline(seg)
    base = endpoint_url.rstrip("/")
    target_url = base if base.endswith("/translate") else f"{base}/translate"
    payload = json.dumps(
        {"text": shielded, "source": src, "target": tgt, "from": src, "to": tgt}
    ).encode("utf-8")
    req = urllib.request.Request(
        target_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with LOOPBACK_OPENER.open(req, timeout=25) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        raw_out = res.get("translation") or res.get("translatedText") or res.get("text") or shielded
        return _unshield_inline(str(raw_out), saved).strip(), str(res.get("engine", "custom-rest"))


def _offline_openai_segment(seg: str, src: str, tgt: str, base_url: str, model_name: str) -> tuple[str, str]:
    shielded, saved = _shield_inline(seg)
    lang_label = "English" if tgt == "en" else "Persian"
    sys_msg = (
        f"Translate the user text accurately into fluent {lang_label}. "
        "Keep every [[NNN]] placeholder token untouched. Output ONLY the translated text."
    )
    clean_base = base_url.rstrip("/")
    if clean_base.endswith("/v1"):
        clean_base = clean_base[:-3]
    body = {
        "model": model_name or "local-translator",
        "messages": [
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": shielded},
        ],
        "temperature": 0.1,
        "max_tokens": 1400,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    req = urllib.request.Request(
        f"{clean_base}/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with LOOPBACK_OPENER.open(req, timeout=45) as resp:
        parsed = json.loads(resp.read().decode("utf-8"))
        raw = parsed["choices"][0]["message"]["content"]
        raw = re.sub(r"<think>[\s\S]*?</think>", "", raw).strip()
        return _unshield_inline(raw, saved), f"custom-openai:{parsed.get('model', 'local')}"


def _resolve_mode(tr_cfg: dict) -> tuple[str, str, str, str]:
    """Normalizes config into (mode, protocol, url, model)."""
    eng = str(tr_cfg.get("engine", "builtin-online"))
    if eng in ("builtin-online", "online"):
        return "online", "builtin-online", "", ""
    if eng in ("online-google", "online-google-gtx", "online-mymemory"):
        return "online", eng, "", ""
    # Backward-compat with older config keys if present
    proto = str(tr_cfg.get("offline_protocol", "openai"))
    url = str(tr_cfg.get("offline_url", "http://127.0.0.1:18095")).strip()
    model = str(tr_cfg.get("offline_model", tr_cfg.get("openai_model", "local-translator"))).strip()
    if eng in ("bergamot", "plamo"):
        proto = "rest"
        url = tr_cfg.get("endpoints", {}).get(eng, url)
    elif eng == "offline-openai":
        proto = "openai"
        url = tr_cfg.get("endpoints", {}).get("openai", url)
    return "offline", proto, url, model


def test_translator_connection(test_cfg: dict) -> dict:
    """Tests either Online Proxy or Custom Offline Endpoint with real roundtrip latency."""
    t0 = time.perf_counter()
    mode, proto, url, model = _resolve_mode(test_cfg)
    proxy = str(test_cfg.get("proxy", "") or "").strip()
    sample = "بررسی سلامت اتصال مترجم"
    try:
        if mode == "online":
            out, used = _builtin_online_segment(sample, "fa", "en", proxy, provider=proto)
        elif proto == "rest":
            out, used = _offline_rest_segment(sample, "fa", "en", url)
        else:
            out, used = _offline_openai_segment(sample, "fa", "en", url, model)
        ms = round((time.perf_counter() - t0) * 1000.0, 1)
        return {"ok": True, "latency_ms": ms, "engine": used, "sample": out}
    except Exception as exc:
        ms = round((time.perf_counter() - t0) * 1000.0, 1)
        return {"ok": False, "latency_ms": ms, "error": str(exc)}


def _translate_one_prose_chunk(
    chunk: str,
    src: str,
    tgt: str,
    tr_cfg: dict,
    glossary: list[dict],
) -> tuple[str, str]:
    working = chunk
    protected_persian: dict[str, str] = {}
    if tgt == "fa" and src == "en":
        def shield_fa(match: re.Match[str]) -> str:
            token = f"ZXQFA{len(protected_persian)}QXZ"
            protected_persian[token] = match.group(0)
            return token
        working = PERSIAN_RUN_RE.sub(shield_fa, working)
    if tgt == "en":
        for item in glossary:
            fa_term = item.get("fa", "").strip()
            en_term = item.get("en", "").strip()
            if fa_term and en_term and fa_term in working:
                working = working.replace(fa_term, f"`{en_term}`")

    mode, proto, url, model = _resolve_mode(tr_cfg)
    proxy = str(tr_cfg.get("proxy", "") or "").strip()
    cache_sig = f"{mode}|{proto}|{url}|{model}|{proxy}|{src}|{tgt}|{working}"
    ck = hashlib.sha256(cache_sig.encode("utf-8")).hexdigest()
    hit = _cache_get(ck)
    if hit is not None:
        cached_out = hit[0]
        for token, original in protected_persian.items():
            cached_out = cached_out.replace(token, original)
        return cached_out, f"{hit[1]} (cache)"

    if mode == "online":
        out, used = _builtin_online_segment(working, src, tgt, proxy, provider=proto)
    elif proto == "rest":
        out, used = _offline_rest_segment(working, src, tgt, url)
    else:
        out, used = _offline_openai_segment(working, src, tgt, url, model)

    if tgt == "en":
        for item in glossary:
            en_term = item.get("en", "").strip()
            if en_term:
                out = out.replace(f"`{en_term}`", en_term)

    _cache_put(ck, out, used)
    for token, original in protected_persian.items():
        out = out.replace(token, original)
    return out, used


def split_markdown_into_blocks(markdown_text: str) -> list[dict]:
    """Splits Markdown into ordered blocks: `prose` ({en, fa}), `code` (untouched once), `hr`."""
    if not markdown_text or not markdown_text.strip():
        return []

    raw_parts = FENCE_RE.split(markdown_text.strip())
    blocks: list[dict] = []

    for idx, part in enumerate(raw_parts):
        if not part.strip():
            continue
        if idx % 2 == 1:
            blocks.append({"type": "code", "raw": part.strip()})
            continue

        paras = re.split(r"\n\s*\n", part.strip())
        for p in paras:
            ps = p.strip()
            if not ps:
                continue
            if re.match(r"^([-*_])\1\1+$", ps):
                blocks.append({"type": "hr", "raw": "---"})
            else:
                blocks.append({"type": "prose", "en": ps, "fa": ""})

    return blocks


def translate_prose(
    text: str,
    target_lang: str,
    tr_cfg: dict,
    glossary: list[dict],
) -> dict:
    if not text or not text.strip():
        return {"translation": "", "blocks": [], "engine": "noop", "elapsed_ms": 0.0}

    if tr_cfg.get("enabled", True) is False:
        return {"translation": "", "blocks": split_markdown_into_blocks(text), "engine": "proxy-only", "elapsed_ms": 0.0}

    detection_text = FENCE_RE.sub("", text)
    fa_chars = len(PERSIAN_RE.findall(detection_text))
    latin_chars = len(LATIN_RE.findall(detection_text))
    has_fa = fa_chars > 0
    has_latin = latin_chars > 0
    if not target_lang or target_lang == "auto":
        # Persian-dominant prose is an input prompt (translate to EN); English-dominant
        # prose with a Persian name/quote is model output (translate to FA, preserve FA spans).
        tgt = "en" if has_fa and (not has_latin or fa_chars >= latin_chars * 0.18) else ("fa" if has_latin else "en")
    else:
        tgt = target_lang.lower()
    # Explicit output direction wins over naive script detection; mixed EN+FA model output
    # is translated as English while Persian names/phrases are protected as tokens.
    src = "en" if tgt == "fa" else "fa"
    if tgt == "fa" and has_fa and not has_latin:
        return {
            "translation": text,
            "blocks": [{"type": "prose", "en": "", "fa": text}] if not FENCE_RE.search(text) else split_markdown_into_blocks(text),
            "engine": "already-target-language",
            "elapsed_ms": 0.0,
        }
    t0 = time.perf_counter()

    if tgt == "fa":
        blocks = split_markdown_into_blocks(text)
        prose_indices = [i for i, b in enumerate(blocks) if b["type"] == "prose"]
        used_engine = "online"

        if prose_indices:
            try:
                if len(prose_indices) == 1:
                    fa_txt, used_engine = _translate_one_prose_chunk(
                        blocks[prose_indices[0]]["en"], src, "fa", tr_cfg, glossary
                    )
                    blocks[prose_indices[0]]["fa"] = fa_txt
                else:
                    sep = "\n\n[[977]]\n\n"
                    joined_en = sep.join(blocks[i]["en"] for i in prose_indices)
                    joined_fa, used_engine = _translate_one_prose_chunk(
                        joined_en, src, "fa", tr_cfg, glossary
                    )
                    fa_parts = re.split(r"\[\s*\[\s*[9۹٩][7۷٧][7۷٧]\s*\]\s*\]", joined_fa)
                    if len(fa_parts) == len(prose_indices):
                        for idx_pos, bi in enumerate(prose_indices):
                            blocks[bi]["fa"] = fa_parts[idx_pos].strip()
                    else:
                        for bi in prose_indices:
                            fa_p, used_engine = _translate_one_prose_chunk(
                                blocks[bi]["en"], src, "fa", tr_cfg, glossary
                            )
                            blocks[bi]["fa"] = fa_p
            except Exception as exc:
                return {
                    "translation": "",
                    "blocks": blocks,
                    "engine": "error",
                    "error": str(exc),
                    "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
                }

        fa_assembled = [
            b["raw"] if b["type"] in ("code", "hr") else (b["fa"] or b["en"])
            for b in blocks
        ]
        return {
            "translation": "\n\n".join(fa_assembled),
            "blocks": blocks,
            "engine": used_engine,
            "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
        }

    parts = FENCE_RE.split(text)
    out_parts: list[str] = []
    used_engine = "online"
    try:
        for idx, part in enumerate(parts):
            if idx % 2 == 1 or not part.strip():
                out_parts.append(part)
                continue
            tr_seg, used_engine = _translate_one_prose_chunk(part, src, tgt, tr_cfg, glossary)
            out_parts.append(tr_seg)
    except Exception as exc:
        return {
            "translation": "",
            "blocks": [],
            "engine": "error",
            "error": str(exc),
            "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
        }

    final_en = "".join(out_parts)
    return {
        "translation": final_en,
        "savings": estimate_persian_token_savings(text, final_en),
        "engine": used_engine,
        "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    }


def probe_translator_health(tr_cfg: dict) -> bool:
    if tr_cfg.get("enabled", True) is False:
        return True
    mode, proto, url, _ = _resolve_mode(tr_cfg)
    if mode == "online":
        return True
    clean = url.rstrip("/")
    if proto == "openai":
        if clean.endswith("/v1"):
            clean = clean[:-3]
        probe_url = f"{clean}/v1/models"
    else:
        probe_url = f"{clean}/health"
    try:
        with LOOPBACK_OPENER.open(probe_url, timeout=1.0) as r:
            return r.status < 500
    except Exception:
        return False
