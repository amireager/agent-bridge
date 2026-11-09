#!/usr/bin/env python3
"""HTTP/SSE API router, static server, and streaming /v1 conversation & cache-hunter tap."""

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
from .translator import LOOPBACK_OPENER, translate_prose

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

MIME_OVERRIDES = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
}


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
                res = translate_prose(
                    body.get("text", ""),
                    body.get("to", "en"),
                    {**hub.config["translation"], "enabled": True},
                    hub.glossary,
                )
                return self._send_json(res)

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
                            "error": "در متن ارسالی عبارات فارسی وجود دارد؛ ابتدا اصلاح کنید یا تیک تایید را بزنید.",
                        },
                        400,
                    )
                try:
                    res = hub.submit_prompt(
                        user_raw=user_raw or prompt_sent,
                        prompt_sent=prompt_sent,
                        source=body.get("source", "web"),
                        agent_id=body.get("agent_id"),
                    )
                    return self._send_json({"ok": True, "result": res})
                except Exception as exc:
                    return self._send_json({"ok": False, "error": str(exc)}, 500)

            if path == "/api/turn/translate":
                body = self._read_json()
                tid = body.get("turn_id", "")
                sess = hub.sessions_by_agent[hub.active_agent][hub.active_session_by_agent[hub.active_agent]]
                for t in sess.get("turns", []):
                    if t["id"] == tid and t.get("reply_en"):
                        tr = translate_prose(
                            t["reply_en"],
                            "fa",
                            {**hub.config["translation"], "enabled": True},
                            hub.glossary,
                        )
                        t["reply_fa"] = tr.get("translation", "")
                        t["blocks"] = tr.get("blocks", [])
                        t["tr_engine"] = tr.get("engine", "")
                        hub._persist_session(sess)
                        hub.broadcast_state()
                        return self._send_json({"ok": True})
                return self._send_json({"ok": False, "error": "Turn not found"}, 404)

            if path == "/api/abort":
                hub.abort_agent()
                hub.emit_event("worker_abort", {})
                hub.emit_event("pty_abort", {})
                return self._send_json({"ok": True})

            if path == "/api/pty/heartbeat":
                hub.pty_wrapper_seen_ts = time.time()
                return self._send_json({"ok": True})

            if path == "/api/worker/heartbeat":
                hub.sandbox_worker_seen_ts = time.time()
                return self._send_json({"ok": True})

            if path == "/api/worker/rpc-event":
                hub.sandbox_worker_seen_ts = time.time()
                ev = self._read_json()
                hub.ingest_pi_rpc_event(ev, [0.0])
                return self._send_json({"ok": True})

            if path == "/api/session/new":
                body = self._read_json()
                s = hub.create_session(body.get("agent_id"), body.get("title"))
                return self._send_json({"ok": True, "session": s})

            if path == "/api/session/select":
                body = self._read_json()
                s = hub.select_agent_session(
                    body.get("agent_id", hub.active_agent),
                    body.get("session_id"),
                )
                return self._send_json({"ok": s is not None, "session": s})

            if path == "/api/session/delete":
                body = self._read_json()
                ok = hub.delete_session(
                    body.get("agent_id", hub.active_agent),
                    body.get("session_id", ""),
                )
                return self._send_json({"ok": ok})

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
                hub.store.clear_telemetry()
                hub.broadcast_state()
                return self._send_json({"ok": True})

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
                while True:
                    try:
                        payload = q.get(timeout=15.0)
                        self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
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
            """Transparent mid-path wire tap extracting streaming tools, thinking, replies & KV cache."""
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
            try:
                resp = LOOPBACK_OPENER.open(req, timeout=300)
            except urllib.error.HTTPError as err:
                eb = err.read()
                self.send_response(err.code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(eb)))
                self.end_headers()
                self.wfile.write(eb)
                return
            except Exception as exc:
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
                except (BrokenPipeError, ConnectionResetError):
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
                            "status": "done",
                            "is_error": False,
                            "duration_ms": 0,
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
                                    "status": "done",
                                    "is_error": False,
                                    "duration_ms": 0,
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
            saved_fa = hub.consume_pending_saved_tokens()

            act_sid = hub.active_session_by_agent.get(agent_name, "default")
            kv_status = hub.store.record_llm_request(
                agent=agent_name,
                session_id=act_sid,
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
            if agent_name == "pi" and hub.current_turn is not None:
                m = hub.current_turn["metrics"]
                m["uncached_in"] += uncached_in
                m["cached_in"] += cached_in
                m["out_tok"] += out_tok
                if d_tps > 0:
                    m["tg_tps"] = round(d_tps, 1)

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


def run_http_server(hub: BridgeHub, host: str, port: int) -> None:
    srv = ThreadingHTTPServer((host, port), make_handler(hub))
    srv.serve_forever()
