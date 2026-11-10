import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.agents import BridgeHub
from backend.store import DataStore


class HistoryArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.store = DataStore(Path(self.temp.name) / ".data")
        self.hub = BridgeHub(self.store, 0)

    def tearDown(self):
        self.hub.shutdown()
        self.temp.cleanup()

    def test_lab_close_archives_without_deleting_and_select_restores(self):
        sess = self.hub.create_lab_session("Keep this Lab")
        sid = sess["id"]
        sess["turns"].append({"id": "turn-1", "user_raw": "test", "reply_en": "answer"})
        self.hub._persist_lab_session(sess)
        file_path = self.store.sessions_dir / "lab" / f"{sid}.json"

        self.assertTrue(self.hub.archive_lab_session(sid))
        self.assertTrue(file_path.exists())
        state = self.hub.build_state_snapshot()
        self.assertEqual(state["lab_sessions"], [])
        self.assertEqual(state["lab_history"][0]["id"], sid)
        self.assertEqual(len(state["lab_history"][0:]), 1)

        self.hub.select_view("lab", sid)
        state = self.hub.build_state_snapshot()
        self.assertEqual(state["lab_history"], [])
        self.assertEqual(state["lab_sessions"][0]["id"], sid)
        self.assertFalse(self.hub.lab_sessions[sid].get("archived", False))

    def test_message_estimates_keep_user_input_and_model_output_separate(self):
        sess = self.hub.create_lab_session("Estimates")
        sess["turns"].append({
            "id": "estimate-turn", "agent": f"lab-{sess['id'][-4:]}", "model": "test-model",
            "ts_epoch": time.time(), "user_raw": "سلام", "prompt_sent": "Hello",
            "reply_en": "Hello there", "reply_fa": "سلام دوست من",
            "token_estimates": {
                "input_source_tokens": 4, "input_sent_tokens": 2, "input_saved_tokens": 2,
                "input_delta_tokens": 2, "model_output_text_tokens": 3,
                "persian_display_tokens": 6, "model_output_reported_tokens": 4,
            },
            "metrics": {"out_tok": 4},
        })
        state = self.hub.build_state_snapshot()
        estimates = state["usage"]["message_estimates"]
        self.assertEqual(estimates["user_messages"], 1)
        self.assertEqual(estimates["input_source_tokens"], 4)
        self.assertEqual(estimates["input_sent_tokens"], 2)
        self.assertEqual(estimates["input_saved_tokens"], 2)
        self.assertEqual(estimates["assistant_messages"], 1)
        self.assertEqual(estimates["model_output_text_tokens"], 3)
        self.assertEqual(estimates["persian_display_tokens"], 6)
        self.assertEqual(estimates["output_translation_delta_tokens"], 3)

    def test_live_mirror_can_be_hidden_without_stopping_pty_and_restored(self):
        agent_id = self.hub.register_pty("pi")
        self.hub.mirrors[agent_id]["turns"].append({"id": "turn-2", "user_raw": "hello"})
        self.hub._persist_mirror(self.hub.mirrors[agent_id])

        self.assertTrue(self.hub.archive_mirror(agent_id))
        self.assertIn(agent_id, self.hub.pty_heartbeats)
        self.assertEqual(self.hub.delete_mirror(agent_id), False)
        state = self.hub.build_state_snapshot()
        self.assertNotIn(agent_id, [item["agent_id"] for item in state["mirrors"]])
        archived = next(item for item in state["mirror_history"] if item["agent_id"] == agent_id)
        self.assertTrue(archived["pty_live"])
        self.assertTrue(archived["archived"])

        self.hub.select_view("mirror", agent_id)
        state = self.hub.build_state_snapshot()
        self.assertIn(agent_id, [item["agent_id"] for item in state["mirrors"]])
        self.assertFalse(self.hub.mirrors[agent_id].get("archived", False))


if __name__ == "__main__":
    unittest.main()
