"""End-to-end proxy smoke using a deterministic local OpenAI-compatible model stub.

This validates bridge plumbing, not model quality; real llama-server testing is separate.
"""
import json
import sqlite3
import threading
from contextlib import closing
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.agents import BridgeHub
from backend.http_server import run_http_server
from backend.store import DataStore


class LocalModelStub(BaseHTTPRequestHandler):
    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        json.loads(self.rfile.read(size))
        body = json.dumps({
            "model": "local-stub",
            "choices": [{"message": {"role": "assistant", "content": "Stub model reply"}}],
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
                self.assertGreaterEqual(request_count, 1)
        finally:
            if server:
                server.shutdown()
                server.server_close()
            if hub:
                hub.shutdown()
            upstream.shutdown()
            upstream.server_close()


if __name__ == "__main__":
    unittest.main()
