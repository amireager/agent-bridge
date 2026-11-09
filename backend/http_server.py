#!/usr/bin/env python3
"""HTTP/SSE Router, Clean Ctrl+C Daemon Server, and Streaming /v1 Tap."""

from __future__ import annotations

import json
import mimetypes
import queue
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .agents import BridgeHub
from .translator import LOOPBACK_OPENER, test_translator_connection, translate_prose

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

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
            if path == "/api/state":
                return self._send_json(hub.build_state_snapshot())
            if path == "/api/events":
                return self._handle_sse()
            if path.startswith("/v1/"):
                return self._proxy_v1_get(path)
            self._send_json({"error": f"Unknown route: {path}"}, 404)

        def do_POST(self) -> None:
            path = urlparse(self.path).path

            if path == "/api/translate":
                body = self._read_json()
                tr_cfg = {**hub.config["translation"], "enabled": True}
                engine_mode = body.get("engine_mode")
                if engine_mode in hub.tested_translator_configs:
                    tr_cfg.update(hub.tested_translator_configs[engine_mode])
                if engine_mode == "online":
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
                    res = hub.submit_prompt(user_raw=user_raw or prompt_sent, prompt_sent=prompt_sent)
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

            if path == "/api/mirror/delete":
                body = self._read_json()
                ok = hub.delete_mirror(body.get("agent_id", ""))
                return self._send_json({"ok": ok})

            if path == "/api/lab/new":
                body = self._read_json()
                s = hub.create_lab_session(body.get("title"))
                return self._send_json({"ok": True, "session": s})

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
            upstream = hub.config["tap"]["upstream_url"].rstrip("/") + path
            try:
                with LOOPBACK_OPENER.open(upstream, timeout=10) as r:
                    data = r.read()
                    self.send_response(r.status)
                    self.send_header("Content-Type", r.headers.get("Content-Type", "application/json"))
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as exc:
                self._send_json({"error": f"Upstream unreachable: {exc}"}, 502)

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

            upstream_url = hub.config["tap"]["upstream_url"].rstrip("/") + path
            req = urllib.request.Request(
                upstream_url,
                data=forward_bytes,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            t0 = time.perf_counter()
            hub.wire_request_started(agent_name)
            try:
                resp = LOOPBACK_OPENER.open(req, timeout=300)
            except urllib.error.HTTPError as err:
                hub.wire_request_failed(agent_name)
                eb = err.read()
                self.send_response(err.code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(eb)))
                self.end_headers()
                self.wfile.write(eb)
                return
            except Exception as exc:
                hub.wire_request_failed(agent_name)
                self._send_json({"error": str(exc)}, 502)
                return

            timings: dict = {}
            usage_obj: dict = {}
            model_used = str(payload.get("model", "unknown-model"))
            acc_content: list[str] = []
            acc_reasoning: list[str] = []
            stream_tool_map: dict[int, dict] = {}
            acc_tools: list[dict] = []

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
                                for ch in chunk.get("choices", []):
                                    d = ch.get("delta", {})
                                    if d.get("content"):
                                        acc_content.append(d["content"])
                                    if d.get("reasoning_content"):
                                        acc_reasoning.append(d["reasoning_content"])
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
            cached_in = int(
                timings.get("cache_n")
                or (usage_obj.get("prompt_tokens_details") or {}).get("cached_tokens")
                or 0
            )
            if "prompt_n" in timings:
                uncached_in = int(timings["prompt_n"])
            else:
                uncached_in = max(0, int(usage_obj.get("prompt_tokens", 0)) - cached_in)

            out_tok = int(timings.get("predicted_n") or usage_obj.get("completion_tokens") or 0)
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
                prompt_ms=p_ms,
                decode_ms=d_ms,
                prompt_tps=p_tps,
                decode_tps=d_tps,
                shadow_cost_usd=cost_usd,
                preview=preview_txt.strip().replace("\n", " ")[:150],
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
