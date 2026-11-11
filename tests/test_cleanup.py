import os
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

from backend.agents import BridgeHub
from backend.store import DataStore


class CleanupFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp.name) / ".data"
        self.store = DataStore(self.data_dir)
        self.hub = BridgeHub(self.store, 0)
        self.hub.broadcast_state = lambda: None

    def tearDown(self):
        self.temp.cleanup()

    def _old_file(self, path, days=45):
        old = time.time() - days * 86400
        os.utime(path, (old, old))

    def _request(self):
        self.store.record_llm_request(
            agent="tester", session_id="s1", model="local-test",
            uncached_input=20, cached_input=10, output_tokens=5,
            prompt_ms=1, decode_ms=1, prompt_tps=1, decode_tps=1,
            shadow_cost_usd=0, preview="test",
        )
        with closing(sqlite3.connect(self.store.db_path)) as conn:
            conn.execute("UPDATE llm_requests SET ts=?", (time.time() - 60 * 86400,))
            conn.commit()

    def _failed_request(self):
        self.store.record_route_failure(
            agent="tester", session_id="s1", route_mode="local", provider="local",
            model="local-test", error_kind="connection", http_status=502,
        )
        with closing(sqlite3.connect(self.store.db_path)) as conn:
            conn.execute("UPDATE route_failures SET ts=?", (time.time() - 60 * 86400,))
            conn.commit()

    def test_preview_groups_categories_and_protects_live_mirrors(self):
        lab = self.hub.create_lab_session("old lab")
        lab_path = self.data_dir / "sessions" / "lab" / f"{lab['id']}.json"
        self._old_file(lab_path)

        offline = self.hub._new_mirror_obj("offline")
        self.hub.mirrors["offline"] = offline
        self.hub._persist_mirror(offline)
        self._old_file(self.data_dir / "mirrors" / "offline.json")

        live = self.hub._new_mirror_obj("active-pty")
        self.hub.mirrors["active-pty"] = live
        self.hub._persist_mirror(live)
        self._old_file(self.data_dir / "mirrors" / "active-pty.json")
        self.hub.pty_heartbeats["active-pty"] = time.time()
        self.hub._inspector_ring = [{"frame": 1}, {"frame": 2}]
        self._request()
        self._failed_request()

        preview = self.hub.cleanup_preview(7, ["telemetry", "lab", "mirrors", "xray"])
        self.assertEqual(preview["categories"]["telemetry"]["items"], 2)
        self.assertEqual(preview["categories"]["lab"]["items"], 1)
        self.assertEqual(preview["categories"]["mirrors"]["items"], 1)
        self.assertEqual(preview["categories"]["xray"]["items"], 2)
        self.assertEqual(preview["total_items"], 6)
        self.assertNotIn("active-pty", [item["id"] for item in preview["files"]])

    def test_run_cleanup_reports_per_category_and_keeps_live_pty_history(self):
        lab = self.hub.create_lab_session("old lab")
        self._old_file(self.data_dir / "sessions" / "lab" / f"{lab['id']}.json")
        offline = self.hub._new_mirror_obj("offline")
        self.hub.mirrors["offline"] = offline
        self.hub._persist_mirror(offline)
        self._old_file(self.data_dir / "mirrors" / "offline.json")
        active = self.hub._new_mirror_obj("live")
        self.hub.mirrors["live"] = active
        self.hub._persist_mirror(active)
        self._old_file(self.data_dir / "mirrors" / "live.json")
        self.hub.pty_heartbeats["live"] = time.time()
        self.hub._inspector_ring = [{"frame": 1}]
        self._request()
        self._failed_request()

        result = self.hub.run_cleanup(7, ["telemetry", "lab", "mirrors", "xray"])
        self.assertEqual(result["deleted_by_scope"], {"telemetry": 2, "xray": 1, "lab": 1, "mirrors": 1})
        self.assertEqual(result["deleted_failures"], 1)
        self.assertFalse((self.data_dir / "sessions" / "lab" / f"{lab['id']}.json").exists())
        self.assertFalse((self.data_dir / "mirrors" / "offline.json").exists())
        self.assertTrue((self.data_dir / "mirrors" / "live.json").exists())
        self.assertEqual(len(self.hub._inspector_ring), 0)
        with closing(sqlite3.connect(self.store.db_path)) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM llm_requests").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM route_failures").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
