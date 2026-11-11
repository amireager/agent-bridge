"""End-to-end proxy smoke using a deterministic local OpenAI-compatible model stub.

This validates bridge plumbing, not model quality; real llama-server testing is separate.
"""
import json
import os
import sqlite3
import threading
from contextlib import closing
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from backend.agents import BridgeHub
from backend.http_server import _write_wire_trace, run_http_server
from backend.store import DataStore


class LocalModelStub(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/v1/models":
            body = json.dumps({"data": [{"id": "local-stub", "name": "Local Stub"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        json.loads(self.rfile.read(size))
        body = json.dumps({
            "model": "local-stub",
            "choices": [{"message": {"role": "assistant", "content": "Stub model reply"}}],
            "timings": {"prompt_n": 0, "cache_n": 0, "predicted_n": 0},
            "usage": {"prompt_tokens": 12, "completion_tokens": 4},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class HttpProxyIntegrationTests(unittest.TestCase):
    def test_local_model_request_reaches_client_mirror_and_telemetry(self):
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), LocalModelStub)
        upstream_thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        upstream_thread.start()
        server = None
        hub = None
        try:
            with TemporaryDirectory() as temp_dir:
                store = DataStore(Path(temp_dir) / ".data")
                hub = BridgeHub(store, 0)
                hub.config["tap"]["upstream_url"] = f"http://127.0.0.1:{upstream.server_port}"
                hub.config["translation"]["enabled"] = False
                server = run_http_server(hub, "127.0.0.1", 0)
                threading.Thread(target=server.serve_forever, daemon=True).start()

                payload = {"model": "select", "messages": [{"role": "user", "content": "hello"}]}
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_address[1]}/v1/chat/completions",
                    data=json.dumps(payload).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    result = json.loads(response.read())
                deadline = time.time() + 3
                while time.time() < deadline and "pi" not in hub.mirrors:
                    time.sleep(0.01)

                self.assertEqual(result["choices"][0]["message"]["content"], "Stub model reply")
                self.assertEqual(hub.mirrors["pi"]["turns"][0]["reply_en"], "Stub model reply")
                with closing(sqlite3.connect(store.db_path)) as conn:
                    request_count = conn.execute("SELECT COUNT(*) FROM llm_requests").fetchone()[0]
                    token_row = conn.execute(
                        "SELECT uncached_input, cached_input, output_tokens, input_count_reported, cache_count_reported, output_count_reported FROM llm_requests ORDER BY id DESC LIMIT 1"
                    ).fetchone()
                self.assertGreaterEqual(request_count, 1)
                self.assertEqual(token_row, (12, 0, 4, 1, 1, 1))

                with urllib.request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/api/models/local", timeout=5) as response:
                    catalog = json.loads(response.read())
                self.assertEqual(catalog["models"][0]["id"], "local-stub")

                model_test = {"mode": "local", "model": "local-stub"}
                test_req = urllib.request.Request(f"http://127.0.0.1:{server.server_address[1]}/api/models/test", data=json.dumps(model_test).encode(), headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(test_req, timeout=5) as response:
                    model_result = json.loads(response.read())
                self.assertTrue(model_result["ok"], model_result)
                self.assertEqual(model_result["sample"], "Stub model reply")

                temp_account = {"provider": "custom-openai", "label": "test", "base_url": f"http://127.0.0.1:{upstream.server_port}/v1", "api_key": "test-secret"}
                connection_req = urllib.request.Request(f"http://127.0.0.1:{server.server_address[1]}/api/models/connection-test", data=json.dumps({"account": temp_account}).encode(), headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(connection_req, timeout=5) as response:
                    connection_result = json.loads(response.read())
                self.assertTrue(connection_result["ok"], connection_result)
                self.assertEqual(connection_result["count"], 1)
                self.assertNotIn("test-secret", json.dumps(connection_result))

                account_payload = {"account": temp_account}
                account_req = urllib.request.Request(f"http://127.0.0.1:{server.server_address[1]}/api/models/account/save", data=json.dumps(account_payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(account_req, timeout=5) as response:
                    saved = json.loads(response.read())
                self.assertNotIn("test-secret", json.dumps(saved))
                account_id = saved["saved"]["id"]
                hub.config["models"].update({"default_mode": "online", "active_account_id": account_id, "online_model": "remote-stub"})
                online_req = urllib.request.Request(f"http://127.0.0.1:{server.server_address[1]}/v1/chat/completions", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(online_req, timeout=5) as response:
                    online_result = json.loads(response.read())
                self.assertEqual(online_result["choices"][0]["message"]["content"], "Stub model reply")
                deadline = time.time() + 3
                while time.time() < deadline:
                    with closing(sqlite3.connect(store.db_path)) as conn:
                        if conn.execute("SELECT COUNT(*) FROM llm_requests").fetchone()[0] >= 2:
                            break
                    time.sleep(0.01)
                with closing(sqlite3.connect(store.db_path)) as conn:
                    self.assertGreaterEqual(conn.execute("SELECT COUNT(*) FROM llm_requests").fetchone()[0], 2)
                delete_req = urllib.request.Request(f"http://127.0.0.1:{server.server_address[1]}/api/models/account/delete", data=json.dumps({"id": account_id}).encode(), headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(delete_req, timeout=5) as response:
                    deleted = json.loads(response.read())
                self.assertTrue(deleted["ok"])
                self.assertFalse(any(item["id"] == account_id for item in hub.model_vault.accounts))
        finally:
            if server:
                server.shutdown()
                server.server_close()
            if hub:
                hub.shutdown()
            upstream.shutdown()
            upstream.server_close()

    def test_streaming_tool_progress_is_broadcast_before_upstream_finishes(self):
        class StreamingToolStub(BaseHTTPRequestHandler):
            def do_POST(self):
                size = int(self.headers.get("Content-Length", "0"))
                json.loads(self.rfile.read(size))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                chunks = [
                    {"choices": [{"index": 0, "delta": {"tool_calls": [{
                        "index": 0, "id": "call-stream-1", "type": "function",
                        "function": {"name": "mystery_search", "arguments": "{"},
                    }]}, "finish_reason": None}]},
                    {"choices": [{"index": 0, "delta": {"tool_calls": [{
                        "index": 0, "function": {"arguments": "}"},
                    }]}, "finish_reason": "tool_calls"}]},
                ]
                for chunk in chunks:
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                    self.wfile.flush()
                    time.sleep(0.35)
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                self.server.response_finished_at = time.monotonic()

            def log_message(self, *_args):
                pass

        upstream = ThreadingHTTPServer(("127.0.0.1", 0), StreamingToolStub)
        upstream.response_finished_at = None
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        server = None
        hub = None
        try:
            with TemporaryDirectory() as temp_dir:
                hub = BridgeHub(DataStore(Path(temp_dir) / ".data"), 0)
                hub.config["tap"]["upstream_url"] = f"http://127.0.0.1:{upstream.server_port}"
                hub.config["translation"]["enabled"] = False
                hub.mirrors["omp-stream"] = hub._new_mirror_obj("omp-stream")
                events = []
                emit = hub.emit_event

                def capture(kind, payload):
                    events.append((kind, payload, time.monotonic()))
                    emit(kind, payload)

                hub.emit_event = capture
                server = run_http_server(hub, "127.0.0.1", 0)
                threading.Thread(target=server.serve_forever, daemon=True).start()
                payload = {
                    "model": "local-stub", "stream": True,
                    "messages": [{"role": "user", "content": "search local test"}],
                }
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_address[1]}/v1/chat/completions",
                    data=json.dumps(payload).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": "Bearer agent:omp-stream",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    body = response.read().decode()
                progress = next(
                    (item for item in events if item[0] == "wire_progress" and item[1].get("turn")),
                    None,
                )
                self.assertIsNotNone(progress)
                self.assertIsNotNone(upstream.response_finished_at)
                self.assertLess(progress[2], upstream.response_finished_at)
                tool = progress[1]["turn"]["tools"][0]
                self.assertEqual(tool["name"], "mystery_search")
                self.assertEqual(tool["status"], "running")
                self.assertIn("mystery_search", body)
                self.assertTrue(any(kind == "wire_progress" and item.get("turn") is None
                                    for kind, item, _ in events))
        finally:
            if server:
                server.shutdown()
                server.server_close()
            if hub:
                hub.shutdown()
            upstream.shutdown()
            upstream.server_close()

    def test_opt_in_wire_trace_is_private_and_redacts_credentials(self):
        with TemporaryDirectory() as temp_dir:
            trace = Path(temp_dir) / "wire.jsonl"
            payload = {
                "model": "local-stub",
                "stream": True,
                "messages": [{"role": "user", "content": "trace sample"}],
            }
            headers = {
                "Authorization": "Bearer do-not-log-this-secret",
                "X-Session-ID": "omp-session-123",
                "User-Agent": "omp-test/1",
            }
            with patch.dict(os.environ, {"AGENT_BRIDGE_TRACE": str(trace)}):
                _write_wire_trace("request", "omp-2", payload, headers, trace_id="req-1")
            content = trace.read_text(encoding="utf-8")
            row = json.loads(content)
            self.assertEqual(row["agent_id"], "omp-2")
            self.assertEqual(row["headers"]["x-session-id"], "omp-session-123")
            self.assertEqual(row["headers"]["authorization"]["scheme"], "Bearer")
            self.assertNotIn("do-not-log-this-secret", content)
            self.assertEqual(row["request"]["messages"][0]["content_preview"], "trace sample")
            self.assertEqual(trace.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
