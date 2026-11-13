#!/usr/bin/env python3
"""HTTP/SSE Router, Clean Ctrl+C Daemon Server, and Streaming /v1 Tap."""

from __future__ import annotations

import copy
import json
import mimetypes
import os
import queue
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .agents import BridgeHub, _safe_request_trace
from .model_accounts import PROVIDERS, discover_models, test_model
from .translator import LOOPBACK_OPENER, test_translator_connection, translate_prose

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


def _write_wire_trace(event: str, agent_id: str, payload: dict, headers=None, **extra) -> None:
    """Opt-in, redacted protocol trace for local diagnosis; never records API key values."""
    target = os.environ.get("AGENT_BRIDGE_TRACE", "").strip()
    if not target:
        return
    safe_headers = {}
    if headers is not None:
        for key, value in headers.items():
            low = key.lower()
            if low == "user-agent" or low == "x-agent-name" or any(
                marker in low for marker in ("session", "request-id", "thread", "conversation", "trace")
            ):
                safe_headers[low] = str(value)[:300]
        auth = headers.get("Authorization", "")
        if auth:
            safe_headers["authorization"] = {
                "present": True,
                "scheme": auth.split(None, 1)[0] if auth.split() else "",
                "agent_tag": auth.split("agent:", 1)[1].split()[0] if "agent:" in auth else "",
            }
    message_rows = []
    for message in payload.get("messages", []) if isinstance(payload.get("messages"), list) else []:
        content = message.get("content", "") if isinstance(message, dict) else ""
        if isinstance(content, str):
            preview = content[:180]
            content_chars = len(content)
        elif isinstance(content, list):
            texts = [str(part.get("text", "")) for part in content if isinstance(part, dict) and part.get("type") == "text"]
            preview = " ".join(texts)[:180]
            content_chars = sum(map(len, texts))
        else:
            preview, content_chars = "", 0
        calls = []
        for call in message.get("tool_calls", []) if isinstance(message, dict) else []:
            function = call.get("function", {}) if isinstance(call, dict) else {}
            calls.append({"id": call.get("id", ""), "name": function.get("name", "")})
        message_rows.append({
            "role": message.get("role", "") if isinstance(message, dict) else "",
            "content_chars": content_chars,
            "content_preview": preview,
            "tool_calls": calls,
            "tool_call_id": message.get("tool_call_id", "") if isinstance(message, dict) else "",
        })
    safe_payload = {
        "model": payload.get("model", ""),
        "stream": bool(payload.get("stream", False)),
        "payload_keys": sorted(str(key) for key in payload.keys()),
        "messages": message_rows,
    }
    row = {"ts": time.time(), "event": event, "agent_id": agent_id, "headers": safe_headers,
           "request": safe_payload, **extra}
    try:
        path = Path(target).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        try:
            os.write(fd, (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8"))
        finally:
            os.close(fd)
    except OSError:
        pass


def _wire_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(item.get("text", "")) for item in content
                        if isinstance(item, dict) and item.get("type") == "text")
    return ""


def _wire_progress_turn(hub: BridgeHub, agent_id: str, model: str, messages: list[dict],
                        content: str, reasoning: str, tool_map: dict[int, dict], stream_id: str) -> dict | None:
    """Build an ephemeral, unpersisted turn for the chat UI while an SSE reply is in flight."""
    last_user = ""
    outputs = {}
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role == "user":
            last_user = _wire_text(message.get("content", "")).strip()
        elif role == "tool" and message.get("tool_call_id"):
            outputs[str(message["tool_call_id"])] = _wire_text(message.get("content", ""))
    internal = last_user.lstrip()
    if internal.startswith("<title-request>") or (
        internal.startswith("<system-reminder>") and "Ephemeral side-channel turn;" in internal[:180]
    ):
        return None

    streamed_tools = []
    for idx in sorted(tool_map):
        item = tool_map[idx]
        try:
            args = json.loads(item["args_raw"]) if item.get("args_raw") else {}
        except (TypeError, ValueError):
            args = item.get("args_raw", "")
        tool_id = item.get("id") or f"tc-{idx}"
        output = outputs.get(tool_id, "")
        streamed_tools.append({
            "id": tool_id, "name": item.get("name") or "tool", "args": args,
            "output": output, "status": "done" if output else "running", "is_error": False,
        })

    return {
        "id": stream_id, "agent": agent_id, "model": model, "source": "tty",
        "ts": time.strftime("%H:%M:%S"), "ts_epoch": time.time(),
        "user_raw": last_user, "prompt_sent": last_user, "saved_fa_tokens": 0,
        "kv_status": "cold", "thinking": reasoning, "thinking_fa": "", "think_blocks": [],
        "steps": [{
            "index": 1, "thinking": reasoning, "tools": copy.deepcopy(streamed_tools),
            "reply_en": content, "status": "streaming",
            "request_trace": _safe_request_trace(messages, model),
        }],
        "tools": streamed_tools, "reply_en": content, "reply_fa": "", "blocks": [],
        "tr_engine": "streaming", "status": "streaming", "elapsed_s": 0.0,
        "metrics": {"uncached_in": 0, "cached_in": 0, "out_tok": 0, "tg_tps": 0.0},
    }


MIME_OVERRIDES = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
}


class DaemonThreadingHTTPServer(ThreadingHTTPServer):
    """Daemonized worker threads + reuse_address so Ctrl+C exits in <10ms without tracebacks."""

    daemon_threads = True
    allow_reuse_address = True


def make_handler(hub: BridgeHub):
    class BridgeHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args) -> None:
            return

        def _send_json(self, obj: dict | list, status: int = 200) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict:
            n = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(n) if n > 0 else b"{}"
            return json.loads(raw.decode("utf-8") or "{}")

        def _serve_static(self, rel_path: str) -> None:
            safe_target = (FRONTEND_DIR / rel_path.lstrip("/")).resolve()
            if not str(safe_target).startswith(str(FRONTEND_DIR.resolve())) or not safe_target.is_file():
                self._send_json({"error": f"Static file not found: {rel_path}"}, 404)
                return
            data = safe_target.read_bytes()
            ctype = MIME_OVERRIDES.get(safe_target.suffix.lower()) or (
                mimetypes.guess_type(str(safe_target))[0] or "application/octet-stream"
            )
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Agent-Name")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.end_headers()

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path in ("/", "/index.html"):
                return self._serve_static("index.html")
            if path.startswith("/static/"):
                return self._serve_static(path[len("/static/"):])
            if path == "/api/models/providers":
                return self._send_json({"providers": PROVIDERS, **hub.model_vault.public_state()})
            if path == "/api/models/local":
                base = hub.config["tap"]["upstream_url"].rstrip("/")
                try:
                    req = urllib.request.Request(base + "/v1/models", headers={"Accept": "application/json"})
                    with LOOPBACK_OPENER.open(req, timeout=3) as response:
                        payload = json.loads(response.read().decode("utf-8"))
                    raw_models = payload.get("data", payload.get("models", []))
                    models = [{"id": x.get("id") or x.get("name", ""), "name": x.get("name") or x.get("id", ""), "status": "loaded"}
                              for x in raw_models if isinstance(x, dict) and (x.get("id") or x.get("name"))]
                    # llama.cpp router may expose its registered/inactive models separately from OpenAI's loaded list.
                    try:
                        with LOOPBACK_OPENER.open(base + "/models", timeout=3) as response:
                            router_payload = json.loads(response.read().decode("utf-8"))
                        for item in router_payload.get("models", []):
                            model_id = item.get("model_alias") or item.get("model") or item.get("id") or item.get("name", "")
                            if model_id and not any(x["id"] == model_id for x in models):
                                models.append({"id": model_id, "name": item.get("name") or model_id, "status": item.get("status", "available")})
                    except Exception:
                        pass
                    return self._send_json({"models": models, "upstream": base})
                except Exception as exc:
                    return self._send_json({"error": str(exc), "models": [], "upstream": base}, 502)
            if path == "/api/models/catalog":
                if hub.model_vault.locked:
                    return self._send_json({"error": "خزانه قفل است؛ ابتدا بازش کن."}, 423)
                query = urllib.parse.parse_qs(urlparse(self.path).query)
                account_id = (query.get("account_id") or [""])[0]
                account = next((x for x in hub.model_vault.accounts if x.get("id") == account_id), None)
                if not account:
                    return self._send_json({"error": "حساب پیدا نشد."}, 404)
                try:
                    return self._send_json({"models": discover_models(account)})
                except Exception as exc:
                    return self._send_json({"error": str(exc)}, 502)
            if path == "/api/state":
                return self._send_json(hub.build_state_snapshot())
            if path == "/api/events":
                return self._handle_sse()
            if path.startswith("/v1/"):
                return self._proxy_v1_get(path)
            self._send_json({"error": f"Unknown route: {path}"}, 404)

        def do_POST(self) -> None:
            path = urlparse(self.path).path

            if path.startswith("/api/models/"):
                body = self._read_json()
                vault = hub.model_vault
                saved_account = None
                try:
                    if path == "/api/models/unlock":
                        vault.unlock(str(body.get("passphrase", "")))
                    elif path == "/api/models/lock":
                        vault.lock()
                    elif path == "/api/models/encryption":
                        if body.get("enabled"):
                            if body.get("passphrase") != body.get("confirm"):
                                raise ValueError("رمز و تکرار آن یکسان نیستند.")
                            vault.enable_encryption(str(body.get("passphrase", "")))
                        else:
                            vault.disable_encryption(str(body.get("passphrase", "")))
                            hub.config.setdefault("models", {})["account_encryption"] = False
                            hub.store.save_config(hub.config)
                    elif path == "/api/models/connection-test":
                        account = dict(body.get("account") or {})
                        account_id = str(account.get("id") or body.get("account_id") or "")
                        if account_id and not str(account.get("api_key", "")):
                            if vault.locked:
                                raise PermissionError("خزانه قفل است؛ برای تست حساب ذخیره‌شده ابتدا بازش کن.")
                            stored = next((x for x in vault.accounts if x.get("id") == account_id), None)
                            if not stored:
                                raise ValueError("حساب ذخیره‌شده پیدا نشد.")
                            account = {**stored, **{k: v for k, v in account.items() if v not in (None, "")}}
                        if account.get("provider") not in PROVIDERS:
                            raise ValueError("ارائه‌دهنده را انتخاب کن.")
                        if not account.get("api_key"):
                            raise ValueError("API key را وارد کن یا یک حساب ذخیره‌شده انتخاب کن.")
                        try:
                            models = discover_models(account)
                            return self._send_json({"ok": True, "models": models, "count": len(models)})
                        except Exception as exc:
                            message = str(exc)
                            if "HTTP 401" in message:
                                hint = "کلید نامعتبر، منقضی یا لغو شده است."
                            elif "HTTP 403" in message:
                                hint = "دسترسی این کلید رد شد. سطح دسترسی Models را بررسی کن؛ مدل‌های Free در OpenCode Console فقط داخل خود OpenCode قابل استفاده‌اند و از Bridge پاسخ 403 می‌دهند."
                            elif "HTTP 402" in message:
                                hint = "اعتبار یا بودجهٔ workspace کافی نیست."
                            else:
                                hint = "آدرس API، پروکسی و اتصال شبکه را بررسی کن."
                            return self._send_json({"ok": False, "error": message, "hint": hint})
                    elif path == "/api/models/test":
                        mode = body.get("mode", "local")
                        model_id = str(body.get("model", ""))
                        if not model_id:
                            raise ValueError("ابتدا یک مدل انتخاب کن.")
                        if mode == "local":
                            account = {"provider": "custom-openai", "base_url": hub.config["tap"]["upstream_url"], "api_key": "", "proxy": ""}
                        else:
                            if vault.locked:
                                raise PermissionError("خزانهٔ کلیدها قفل است.")
                            account = next((x for x in vault.accounts if x.get("id") == body.get("account_id")), None)
                            if not account:
                                raise ValueError("حساب پیدا نشد.")
                        return self._send_json(test_model(account, model_id))
                    elif path == "/api/models/account/save":
                        saved_account = vault.save_account(body.get("account", {}))
                    elif path == "/api/models/account/delete":
                        deleted_id = str(body.get("id", ""))
                        vault.delete_account(deleted_id)
                        if hub.config.get("models", {}).get("active_account_id") == deleted_id:
                            hub.config["models"]["active_account_id"] = ""
                            hub.store.save_config(hub.config)
                    else:
                        return self._send_json({"error": f"Unknown route: {path}"}, 404)
                    if path == "/api/models/encryption":
                        hub.config.setdefault("models", {})["account_encryption"] = vault.encryption_enabled
                        hub.store.save_config(hub.config)
                    hub.broadcast_state()
                    return self._send_json({"ok": True, "saved": saved_account, **vault.public_state()})
                except Exception as exc:
                    return self._send_json({"error": str(exc)}, 400)

            if path == "/api/translate":

                body = self._read_json()
                tr_cfg = {**hub.config["translation"], "enabled": True}
                engine_mode = body.get("engine_mode")
                if engine_mode in hub.tested_translator_configs:
                    tr_cfg.update(hub.tested_translator_configs[engine_mode])
                if engine_mode in ("online", "builtin-online"):
                    tr_cfg["engine"] = "builtin-online"
                elif engine_mode in ("online-google", "online-google-gtx", "online-mymemory"):
                    tr_cfg["engine"] = engine_mode
                elif engine_mode == "offline":
                    tr_cfg["engine"] = "custom-offline"
                for key in ("proxy", "offline_protocol", "offline_url", "offline_model"):
                    if key in body:
                        tr_cfg[key] = body[key]
                res = translate_prose(body.get("text", ""), body.get("to", "en"), tr_cfg, hub.glossary)
                return self._send_json(res)

            if path == "/api/translate/ping":
                body = self._read_json()
                merged_cfg = {**hub.config["translation"], **body}
                result = test_translator_connection(merged_cfg)
                hub.mark_translator_tested(merged_cfg, result)
                if result.get("ok"):
                    hub.broadcast_state()
                return self._send_json(result)

            if path == "/api/prompt":
                body = self._read_json()
                user_raw = body.get("user_raw", "")
                prompt_sent = body.get("prompt_sent", "")
                allow_persian = bool(body.get("allow_persian", False))
                translation_used = body.get("translation_used") if isinstance(body.get("translation_used"), bool) else None

                has_fa = any("\u0600" <= ch <= "\u06ff" for ch in prompt_sent)
                if has_fa and not allow_persian:
                    return self._send_json(
                        {
                            "ok": False,
                            "code": "PERSIAN_DETECTED",
                            "error": "در متن ارسالی عبارت فارسی وجود دارد؛ اصلاحش کن یا تیک تایید را بزن.",
                        },
                        400,
                    )
                try:
                    res = hub.submit_prompt(user_raw=user_raw or prompt_sent, prompt_sent=prompt_sent, translation_used=translation_used)
                    return self._send_json({"ok": True, "result": res})
                except Exception as exc:
                    return self._send_json({"ok": False, "error": str(exc)}, 500)

            if path == "/api/turn/translate":
                body = self._read_json()
                ok = hub.retranslate_turn(body.get("turn_id", ""), body.get("scope", "all"), int(body.get("step_index", -1)))
                return self._send_json({"ok": ok})

            if path == "/api/abort":
                hub.abort_active()
                return self._send_json({"ok": True})

            # PTY Registration & Heartbeat
            if path == "/api/pty/register":
                body = self._read_json()
                aid = hub.register_pty(
                    desired_base=body.get("desired", "pi"),
                    explicit_name=body.get("explicit", ""),
                )
                return self._send_json({"ok": True, "agent_id": aid})

            if path == "/api/pty/heartbeat":
                body = self._read_json()
                hub.heartbeat_pty(body.get("agent_id", "pi"))
                return self._send_json({"ok": True})

            if path == "/api/pty/unregister":
                body = self._read_json()
                hub.unregister_pty(body.get("agent_id", "pi"))
                return self._send_json({"ok": True})

            # View & Lab Session Endpoints
            if path == "/api/view/select":
                body = self._read_json()
                hub.select_view(body.get("kind", "mirror"), body.get("id", "pi"))
                return self._send_json({"ok": True})

            if path == "/api/mirror/clear":
                body = self._read_json()
                hub.clear_mirror_view(body.get("agent_id", hub.view_id))
                return self._send_json({"ok": True})

            if path == "/api/mirror/archive":
                body = self._read_json()
                ok = hub.archive_mirror(body.get("agent_id", ""))
                return self._send_json({"ok": ok})

            if path == "/api/mirror/delete":
                body = self._read_json()
                ok = hub.delete_mirror(body.get("agent_id", ""))
                return self._send_json({"ok": ok})

            if path == "/api/lab/new":
                body = self._read_json()
                s = hub.create_lab_session(body.get("title"))
                return self._send_json({"ok": True, "session": s})

            if path == "/api/lab/archive":
                body = self._read_json()
                ok = hub.archive_lab_session(body.get("session_id", ""))
                return self._send_json({"ok": ok})

            if path == "/api/lab/delete":
                body = self._read_json()
                ok = hub.delete_lab_session(body.get("session_id", ""))
                return self._send_json({"ok": ok})

            if path == "/api/lab/rename":
                body = self._read_json()
                ok = hub.rename_lab_session(body.get("session_id", ""), body.get("title", ""))
                return self._send_json({"ok": ok})

            if path == "/api/lab/delete-all":
                for sid in list(hub.lab_sessions):
                    hub.delete_lab_session(sid)
                return self._send_json({"ok": True})

            if path == "/api/usage/filter":
                body = self._read_json()
                if "hours" in body:
                    hub.usage_window_hours = int(body["hours"])
                if "model" in body:
                    hub.usage_model_filter = str(body["model"])
                if "agent" in body:
                    hub.usage_agent_filter = str(body["agent"])
                hub.broadcast_state()
                return self._send_json({"ok": True})

            if path == "/api/config":
                body = self._read_json()
                hub.config = hub.store._deep_merge(hub.config, body)
                hub.store.save_config(hub.config)
                hub.broadcast_state()
                return self._send_json({"ok": True, "config": hub.config})

            if path == "/api/glossary":
                body = self._read_json()
                items = body.get("glossary", [])
                if isinstance(items, list):
                    hub.glossary = items
                    hub.store.save_glossary(items)
                hub.broadcast_state()
                return self._send_json({"ok": True, "glossary": hub.glossary})

            if path == "/api/cleanup/preview":
                body = self._read_json()
                days = max(0, min(3650, int(body.get("days", 7))))
                scopes = [x for x in body.get("scopes", []) if x in ("telemetry", "lab", "mirrors", "xray")]
                return self._send_json(hub.cleanup_preview(days, scopes))

            if path == "/api/cleanup/run":
                body = self._read_json()
                days = max(0, min(3650, int(body.get("days", 7))))
                scopes = [x for x in body.get("scopes", []) if x in ("telemetry", "lab", "mirrors", "xray")]
                return self._send_json({"ok": True, **hub.run_cleanup(days, scopes)})

            if path == "/api/retention/prune":
                body = self._read_json()
                days = body.get("days")
                if days is not None:
                    hub.config["retention"]["days"] = int(days)
                    hub.store.save_config(hub.config)
                res = hub.store.prune_expired(hub.config["retention"]["days"])
                hub.broadcast_state()
                return self._send_json({"ok": True, **res})

            if path == "/api/telemetry/clear":
                result = hub.clear_observed_history()
                return self._send_json({"ok": True, **result})

            if path in ("/v1/chat/completions", "/v1/completions"):
                return self._handle_v1_tap(path)

            self._send_json({"error": f"Unknown POST route: {path}"}, 404)

        def _handle_sse(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            q = hub.subscribe_sse()
            try:
                init_msg = json.dumps(
                    {"kind": "state", "state": hub.build_state_snapshot()}, ensure_ascii=False
                )
                self.wfile.write(f"data: {init_msg}\n\n".encode("utf-8"))
                self.wfile.flush()
                while not hub.shutting_down:
                    try:
                        payload = q.get(timeout=12.0)
                        if payload is None or hub.shutting_down:
                            break
                        self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        if hub.shutting_down:
                            break
                        self.wfile.write(b": heartbeat\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                hub.unsubscribe_sse(q)

        def _proxy_v1_get(self, path: str) -> None:
            models_cfg = hub.config.get("models", {})
            opener = LOOPBACK_OPENER
            try:
                if models_cfg.get("default_mode") == "online":
                    account, _ = self._selected_online_account()
                    base = str(account.get("base_url", "")).rstrip("/")
                    if path == "/v1/models":
                        upstream = account.get("models_url") or PROVIDERS.get(account.get("provider"), {}).get("models_url") or (base + "/models" if base.endswith("/v1") else base + "/v1/models")
                    else:
                        upstream = base + path[3:] if path.startswith("/v1/") and base.endswith("/v1") else base + path
                    headers = {"Authorization": f"Bearer {account['api_key']}"} if account.get("api_key") else {}
                    req = urllib.request.Request(upstream, headers=headers)
                    proxy = str(account.get("proxy", "")).strip()
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy})) if proxy else urllib.request.build_opener()
                else:
                    upstream = hub.config["tap"]["upstream_url"].rstrip("/") + path
                    req = urllib.request.Request(upstream)
                with opener.open(req, timeout=10) as r:
                    data = r.read()
                    self.send_response(r.status)
                    self.send_header("Content-Type", r.headers.get("Content-Type", "application/json"))
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as exc:
                self._send_json({"error": f"Upstream unreachable: {exc}"}, 502)

        def _selected_online_account(self) -> tuple[dict, str]:
            models_cfg = hub.config.get("models", {})
            if hub.model_vault.locked:
                raise PermissionError("خزانهٔ API قفل است؛ برای آنلاین‌رفتن بازش کن.")
            account_id = models_cfg.get("active_account_id", "")
            account = next((x for x in hub.model_vault.accounts if x.get("id") == account_id and x.get("enabled", True)), None)
            if not account:
                raise RuntimeError("حساب آنلاین پیش‌فرضی انتخاب نشده است.")
            provider = PROVIDERS.get(account.get("provider"), {})
            if provider.get("format") != "openai":
                raise RuntimeError("این endpoint در حال حاضر با /v1 سازگار نیست؛ برای generation از OpenAI-compatible استفاده کن.")
            model = models_cfg.get("online_model", "")
            if not model:
                raise RuntimeError("مدل آنلاین پیش‌فرضی انتخاب نشده است.")
            return account, model

        def _make_remote_request(self, payload: dict, path: str) -> tuple[urllib.request.Request, urllib.request.OpenerDirector, str, str]:
            account, model = self._selected_online_account()
            base = str(account.get("base_url", "")).rstrip("/")
            if path.startswith("/v1/") and base.endswith("/v1"):
                endpoint = base + path[3:]
            else:
                endpoint = base + path
            remote_payload = dict(payload)
            remote_payload["model"] = model
            headers = {"Content-Type": "application/json"}
            if account.get("api_key"):
                headers["Authorization"] = f"Bearer {account['api_key']}"
            req = urllib.request.Request(endpoint, data=json.dumps(remote_payload, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")
            proxy = str(account.get("proxy", "")).strip()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy})) if proxy else urllib.request.build_opener()
            provider_key = str(account.get("provider", ""))
            provider_name = str(PROVIDERS.get(provider_key, {}).get("name") or provider_key or "online provider")
            return req, opener, model, provider_name

        def _detect_agent_tag(self, payload: dict) -> str:
            x_ag = self.headers.get("X-Agent-Name", "").strip()
            if x_ag:
                return x_ag
            auth = self.headers.get("Authorization", "")
            if "agent:" in auth:
                return auth.split("agent:", 1)[1].strip().split()[0]
            m = str(payload.get("model", ""))
            if m.startswith("agent:"):
                return m.split("agent:", 1)[1]
            return "pi"

        def _handle_v1_tap(self, path: str) -> None:
            n = int(self.headers.get("Content-Length", "0"))
            raw_req = self.rfile.read(n)
            try:
                payload = json.loads(raw_req.decode("utf-8"))
            except Exception:
                payload = {}

            agent_name = self._detect_agent_tag(payload)
            trace_id = uuid.uuid4().hex
            _write_wire_trace("request", agent_name, payload, self.headers, trace_id=trace_id)
            is_stream = bool(payload.get("stream", False))
            if is_stream:
                payload.setdefault("stream_options", {})["include_usage"] = True

            forward_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            msgs = payload.get("messages", [])
            preview_txt = ""
            sys_chars = 0
            for m in msgs:
                if m.get("role") == "system":
                    sys_chars += len(str(m.get("content", "")))
                if m.get("role") == "user":
                    c = m.get("content", "")
                    if isinstance(c, list):
                        preview_txt = " ".join(
                            x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text"
                        )
                    else:
                        preview_txt = str(c)

            last_user_text = ""
            for message in reversed(msgs):
                if isinstance(message, dict) and message.get("role") == "user":
                    content = message.get("content", "")
                    if isinstance(content, list):
                        last_user_text = " ".join(str(item.get("text", "")) for item in content if isinstance(item, dict) and item.get("type") == "text").strip()
                    else:
                        last_user_text = str(content).strip()
                    if last_user_text:
                        break
            pending_translation = hub.pending_fa_by_agent.get(agent_name)
            translation_status = "unknown"
            if (
                pending_translation
                and time.time() - float(pending_translation.get("ts", 0)) < 45.0
                and str(pending_translation.get("en", "")).strip()[:40]
                and str(pending_translation.get("en", "")).strip()[:40] in last_user_text
            ):
                candidate_status = pending_translation.get("translation_status", "unknown")
                translation_status = candidate_status if candidate_status in {"used", "bypassed", "unknown"} else "unknown"

            models_cfg = hub.config.get("models", {})
            remote_active = models_cfg.get("default_mode", "local") == "online"
            remote_model = ""
            route_provider = "local"
            route_mode = "online" if remote_active else "local"
            route_started = time.perf_counter()
            if remote_active:
                try:
                    req, request_opener, remote_model, route_provider = self._make_remote_request(payload, path)
                    payload["model"] = remote_model
                except Exception as exc:
                    hub.store.record_route_failure(
                        agent=agent_name, session_id=agent_name, route_mode="online",
                        provider="", model=str(models_cfg.get("online_model") or ""),
                        error_kind="configuration", latency_ms=int((time.perf_counter() - route_started) * 1000),
                        translation_status=translation_status,
                    )
                    hub.wire_request_failed(agent_name)
                    self._send_json({"error": str(exc)}, 503)
                    return
            else:
                local_default = models_cfg.get("default_model", "")
                if local_default:
                    payload["model"] = local_default
                forward_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                upstream_url = hub.config["tap"]["upstream_url"].rstrip("/") + path
                req = urllib.request.Request(upstream_url, data=forward_bytes, headers={"Content-Type": "application/json"}, method="POST")
                request_opener = LOOPBACK_OPENER
            route_model = str(payload.get("model") or models_cfg.get("default_model") or "").strip()
            t0 = time.perf_counter()
            hub.wire_request_started(agent_name, {
                "route_mode": route_mode,
                "provider": route_provider,
                "model": route_model,
                "translation_status": translation_status,
            })
            try:
                resp = request_opener.open(req, timeout=300)
            except (urllib.error.HTTPError, Exception) as err:
                # Online fallback is explicit opt-in; never send local prompts to a provider silently.
                if not remote_active and models_cfg.get("online_fallback"):
                    fallback_provider = ""
                    fallback_model = ""
                    try:
                        req, request_opener, fallback_model, fallback_provider = self._make_remote_request(payload, path)
                        remote_model, route_provider = fallback_model, fallback_provider
                        hub.update_wire_route(agent_name, route_mode="online-fallback", provider=route_provider, model=remote_model)
                        resp = request_opener.open(req, timeout=300)
                        remote_active = True
                        route_mode = "online-fallback"
                        payload["model"] = remote_model
                    except Exception as fallback_error:
                        hub.store.record_route_failure(
                            agent=agent_name, session_id=agent_name, route_mode="online-fallback",
                            provider=fallback_provider, model=fallback_model,
                            error_kind="fallback", http_status=int(getattr(fallback_error, "code", 0) or 0),
                            latency_ms=int((time.perf_counter() - route_started) * 1000),
                            translation_status=translation_status,
                        )
                        hub.wire_request_failed(agent_name)
                        self._send_json({"error": f"Local model failed ({err}); online fallback failed ({fallback_error})"}, 502)
                        return
                else:
                    hub.store.record_route_failure(
                        agent=agent_name, session_id=agent_name, route_mode=route_mode,
                        provider=route_provider, model=route_model,
                        error_kind="upstream-http" if isinstance(err, urllib.error.HTTPError) else "connection",
                        http_status=int(getattr(err, "code", 0) or 0),
                        latency_ms=int((time.perf_counter() - route_started) * 1000),
                        translation_status=translation_status,
                    )
                    hub.wire_request_failed(agent_name)
                    if isinstance(err, urllib.error.HTTPError):
                        eb = err.read()
                        self.send_response(err.code)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(eb)))
                        self.end_headers()
                        self.wfile.write(eb)
                    else:
                        self._send_json({"error": str(err)}, 502)
                    return

            timings: dict = {}
            usage_obj: dict = {}
            model_used = str(payload.get("model", "unknown-model"))
            acc_content: list[str] = []
            acc_reasoning: list[str] = []
            stream_tool_map: dict[int, dict] = {}
            acc_tools: list[dict] = []
            stream_id = uuid.uuid4().hex
            last_progress_emit = 0.0
            stream_progress_sent = False

            if is_stream:
                self.send_response(resp.status)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    for raw_line in resp:
                        self.wfile.write(raw_line)
                        self.wfile.flush()
                        ls = raw_line.decode("utf-8", errors="replace").strip()
                        if ls.startswith("data:") and ls[5:].strip() != "[DONE]":
                            try:
                                chunk = json.loads(ls[5:].strip())
                                if chunk.get("model"):
                                    model_used = chunk["model"]
                                if chunk.get("timings"):
                                    timings = chunk["timings"]
                                if chunk.get("usage"):
                                    usage_obj = chunk["usage"]
                                progress_dirty = False
                                for ch in chunk.get("choices", []):
                                    d = ch.get("delta", {})
                                    if d.get("content"):
                                        acc_content.append(d["content"])
                                        progress_dirty = True
                                    if d.get("reasoning_content"):
                                        acc_reasoning.append(d["reasoning_content"])
                                        progress_dirty = True
                                    for tcd in d.get("tool_calls", []) or []:
                                        idx = int(tcd.get("index", 0))
                                        entry = stream_tool_map.setdefault(
                                            idx, {"id": "", "name": "", "args_raw": ""}
                                        )
                                        if tcd.get("id"):
                                            entry["id"] = tcd["id"]
                                        fn = tcd.get("function", {})
                                        if fn.get("name"):
                                            entry["name"] += fn["name"]
                                        if fn.get("arguments"):
                                            entry["args_raw"] += fn["arguments"]
                                        progress_dirty = True
                                now = time.monotonic()
                                if progress_dirty and (not stream_progress_sent or now - last_progress_emit >= 0.12):
                                    progress_turn = _wire_progress_turn(
                                        hub, agent_name, model_used, msgs, "".join(acc_content),
                                        "".join(acc_reasoning), stream_tool_map, stream_id,
                                    )
                                    if progress_turn is not None:
                                        hub.emit_event("wire_progress", {
                                            "agent_id": agent_name, "stream_id": stream_id,
                                            "turn": progress_turn,
                                        })
                                        stream_progress_sent = True
                                        last_progress_emit = now
                            except Exception:
                                pass
                except (BrokenPipeError, ConnectionResetError, OSError):
                    pass
                finally:
                    resp.close()

                for idx in sorted(stream_tool_map.keys()):
                    it = stream_tool_map[idx]
                    try:
                        parsed_args = json.loads(it["args_raw"]) if it["args_raw"] else {}
                    except Exception:
                        parsed_args = it["args_raw"]
                    acc_tools.append(
                        {
                            "id": it["id"] or f"tc-{idx}",
                            "name": it["name"] or "tool",
                            "args": parsed_args,
                            "output": "",
                            "status": "running",
                            "is_error": False,
                        }
                    )
            else:
                body_bytes = resp.read()
                resp.close()
                try:
                    parsed = json.loads(body_bytes.decode("utf-8"))
                    model_used = parsed.get("model", model_used)
                    timings = parsed.get("timings", {})
                    usage_obj = parsed.get("usage", {})
                    for ch in parsed.get("choices", []):
                        msg_obj = ch.get("message", {})
                        if msg_obj.get("content"):
                            acc_content.append(str(msg_obj["content"]))
                        if msg_obj.get("reasoning_content"):
                            acc_reasoning.append(str(msg_obj["reasoning_content"]))
                        for tc in msg_obj.get("tool_calls", []) or []:
                            fn = tc.get("function", {})
                            raw_a = fn.get("arguments", {})
                            try:
                                parsed_a = json.loads(raw_a) if isinstance(raw_a, str) else raw_a
                            except Exception:
                                parsed_a = raw_a
                            acc_tools.append(
                                {
                                    "id": tc.get("id", "tc"),
                                    "name": fn.get("name", "tool"),
                                    "args": parsed_a,
                                    "output": "",
                                    "status": "running",
                                    "is_error": False,
                                }
                            )
                except Exception:
                    pass
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body_bytes)))
                self.end_headers()
                self.wfile.write(body_bytes)

            elapsed_s = time.perf_counter() - t0
            prompt_details = usage_obj.get("prompt_tokens_details") or {}
            cache_count_reported = "cache_n" in timings or "cached_tokens" in prompt_details
            cached_value = timings.get("cache_n", 0)
            if not cached_value and "cached_tokens" in prompt_details:
                cached_value = prompt_details.get("cached_tokens", 0)
            try:
                cached_in = max(0, int(cached_value or 0))
            except (TypeError, ValueError):
                cached_in = 0

            input_count_reported = "prompt_n" in timings or "prompt_tokens" in usage_obj
            if "prompt_n" in timings:
                try:
                    timing_prompt = max(0, int(timings["prompt_n"] or 0))
                    provider_prompt = usage_obj.get("prompt_tokens")
                    if timing_prompt > 0 or provider_prompt is None:
                        uncached_in = timing_prompt
                    else:
                        # A zero timing field can mean unpopulated metadata. Prefer the
                        # provider total, subtracting only cached tokens explicitly reported.
                        uncached_in = max(0, int(provider_prompt or 0) - cached_in)
                except (TypeError, ValueError):
                    uncached_in = 0
            elif "prompt_tokens" in usage_obj:
                try:
                    uncached_in = max(0, int(usage_obj["prompt_tokens"] or 0) - cached_in)
                except (TypeError, ValueError):
                    uncached_in = 0
            else:
                uncached_in = 0

            output_count_reported = "predicted_n" in timings or "completion_tokens" in usage_obj
            out_value = timings.get("predicted_n", 0)
            if not out_value and "completion_tokens" in usage_obj:
                out_value = usage_obj.get("completion_tokens", 0)
            try:
                out_tok = max(0, int(out_value or 0))
            except (TypeError, ValueError):
                out_tok = 0
            p_ms = float(timings.get("prompt_ms", 0.0))
            d_ms = float(timings.get("predicted_ms", elapsed_s * 1000.0))
            p_tps = float(timings.get("prompt_per_second", 0.0))
            d_tps = float(timings.get("predicted_per_second", 0.0))

            clean_model = Path(model_used).name or model_used
            prof = hub.config["pricing"]["active_profile"]
            cost_usd = hub.store.compute_shadow_cost(uncached_in, cached_in, out_tok, prof)
            saved_fa = hub.consume_saved_tokens(agent_name)

            kv_status = hub.store.record_llm_request(
                agent=agent_name,
                session_id=agent_name,
                model=clean_model,
                uncached_input=uncached_in,
                cached_input=cached_in,
                output_tokens=out_tok,
                saved_fa_tokens=saved_fa,
                input_count_reported=input_count_reported,
                cache_count_reported=cache_count_reported,
                output_count_reported=output_count_reported,
                prompt_ms=p_ms,
                decode_ms=d_ms,
                prompt_tps=p_tps,
                decode_tps=d_tps,
                shadow_cost_usd=cost_usd,
                preview=preview_txt.strip().replace("\n", " ")[:150],
                provider=route_provider,
                route_mode=route_mode,
                latency_ms=int(elapsed_s * 1000),
                translation_status=translation_status,
            )

            turn_metrics = {
                "uncached_in": uncached_in,
                "cached_in": cached_in,
                "out_tok": out_tok,
                "pp_tps": round(p_tps, 1),
                "tg_tps": round(d_tps, 1),
            }

            hub.record_passive_wire_turn(
                agent_name=agent_name,
                model_name=clean_model,
                messages=msgs,
                raw_reply="".join(acc_content),
                reasoning_text="".join(acc_reasoning),
                tool_calls=acc_tools,
                metrics=turn_metrics,
                kv_status=kv_status,
                elapsed_s=elapsed_s,
            )
            if stream_progress_sent:
                hub.emit_event("wire_progress", {
                    "agent_id": agent_name, "stream_id": stream_id, "turn": None,
                })
            _write_wire_trace(
                "response", agent_name, payload, self.headers, trace_id=trace_id,
                elapsed_ms=round(elapsed_s * 1000, 1),
                reply_chars=sum(len(x) for x in acc_content),
                reasoning_chars=sum(len(x) for x in acc_reasoning),
                tool_calls=[{"id": t.get("id"), "name": t.get("name"), "args": t.get("args")} for t in acc_tools],
            )

            hub.wire_request_completed(agent_name)
            hub.push_inspector(
                {
                    "ts": time.strftime("%H:%M:%S"),
                    "agent": agent_name,
                    "model": clean_model,
                    "kv_status": kv_status,
                    "system_chars": sys_chars,
                    "message_count": len(msgs),
                    "uncached_in": uncached_in,
                    "cached_in": cached_in,
                    "out_tok": out_tok,
                    "tg_tps": round(d_tps, 1),
                    "messages_tail": msgs[-4:],
                }
            )
            hub.broadcast_state()

    return BridgeHandler


def run_http_server(hub: BridgeHub, host: str, port: int) -> DaemonThreadingHTTPServer:
    return DaemonThreadingHTTPServer((host, port), make_handler(hub))
