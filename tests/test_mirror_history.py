import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from backend.agents import BridgeHub, _safe_request_trace, _wire_assistant_anchor
from backend.store import DataStore


class MirrorHistoryTests(unittest.TestCase):
    def setUp(self):
        self.hub = object.__new__(BridgeHub)

    def test_imports_prior_messages_without_translating(self):
        messages = [
            {"role": "user", "content": "سؤال فارسی"},
            {"role": "assistant", "content": "Prior answer"},
            {"role": "user", "content": "Current prompt"},
        ]
        turns = self.hub._seed_untranslated_history(messages[:2], "pi-1")
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0]["user_raw"], "سؤال فارسی")
        self.assertEqual(turns[0]["reply_en"], "Prior answer")
        self.assertEqual(turns[0]["tr_engine"], "history-untranslated")
        self.assertEqual(turns[0]["reply_fa"], "")

    def test_tool_call_arguments_and_output_are_retained(self):
        messages = [
            {"role": "user", "content": "inspect"},
            {"role": "assistant", "content": "", "tool_calls": [{
                "id": "call-1", "function": {"name": "read", "arguments": '{"path":"README.md"}'}}]},
            {"role": "tool", "tool_call_id": "call-1", "content": "file contents"},
            {"role": "assistant", "content": "Done"},
        ]
        turn = self.hub._seed_untranslated_history(messages, "pi-1")[0]
        self.assertEqual(turn["tools"][0]["args"], {"path": "README.md"})
        self.assertEqual(turn["tools"][0]["output"], "file contents")
        self.assertEqual(turn["tools"][0]["status"], "done")

    def test_request_trace_is_bounded_and_redacts_common_secrets(self):
        messages = [
            {"role": "system", "content": "api_key=supersecretvalue123"},
            {"role": "user", "content": "Bearer abcdefghijklmnopqrstuvwxyz123456"},
            {"role": "assistant", "content": "sk-abcdefghijklmnopqrstuvwxyz123456"},
        ]
        trace = _safe_request_trace(messages, "local-test")
        self.assertEqual(trace["model"], "local-test")
        self.assertEqual(trace["message_count"], 3)
        self.assertTrue(trace["redacted"])
        rendered = " ".join(row["text"] for row in trace["messages"])
        self.assertNotIn("supersecretvalue", rendered)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz123456", rendered)
        self.assertIn("[redacted]", rendered)

    def test_successive_model_calls_are_retained_as_ordered_steps(self):
        with TemporaryDirectory() as temp_dir:
            hub = BridgeHub(DataStore(Path(temp_dir) / ".data"), 0)
            hub.config["translation"]["enabled"] = False
            try:
                first = [
                    {"role": "system", "content": "Be concise."},
                    {"role": "user", "content": "Find one example."},
                ]
                hub.record_passive_wire_turn(
                    agent_name="pi-trace", model_name="local-model", messages=first,
                    raw_reply="Searching now.", reasoning_text="", tool_calls=[{
                        "id": "call-1", "name": "search", "args": {"query": "example"},
                        "output": "one result", "status": "done", "is_error": False,
                    }], metrics={"uncached_in": 2, "cached_in": 0, "out_tok": 5, "tg_tps": 3}, kv_status="cold", elapsed_s=0.12,
                )
                second = [
                    *first,
                    {"role": "assistant", "content": "Searching now."},
                    {"role": "tool", "tool_call_id": "call-1", "content": "one result"},
                ]
                hub.record_passive_wire_turn(
                    agent_name="pi-trace", model_name="local-model", messages=second,
                    raw_reply="Here is the result.", reasoning_text="", tool_calls=[],
                    metrics={"uncached_in": 3, "cached_in": 1, "out_tok": 8, "tg_tps": 4}, kv_status="warm", elapsed_s=0.2,
                )
                steps = hub.mirrors["pi-trace"]["turns"][0]["steps"]
                self.assertEqual([step["index"] for step in steps], [1, 2])
                self.assertEqual(steps[0]["request_trace"]["message_count"], 2)
                self.assertEqual(steps[1]["request_trace"]["message_count"], 4)
                self.assertEqual(steps[0]["elapsed_ms"], 120)
                self.assertEqual(steps[0]["request_trace"]["messages"][-1]["text"], "Find one example.")
            finally:
                hub.shutdown()

    def test_assistant_anchor_is_stable_and_tool_sensitive(self):
        self.assertEqual(_wire_assistant_anchor("answer", []), _wire_assistant_anchor("answer", []))
        a = _wire_assistant_anchor("", [{"id": "1", "function": {"name": "read", "arguments": "{}"}}])
        b = _wire_assistant_anchor("", [{"id": "2", "function": {"name": "read", "arguments": "{}"}}])
        self.assertNotEqual(a, b)

    def test_omp_internal_title_and_sidechannel_calls_do_not_split_mirror_history(self):
        with TemporaryDirectory() as temp_dir:
            hub = BridgeHub(DataStore(Path(temp_dir) / ".data"), 0)
            hub.config["translation"]["enabled"] = False
            try:
                first_user = "<system-reminder>context</system-reminder> Reply exactly: OK"
                first_messages = [
                    {"role": "system", "content": "You are concise."},
                    {"role": "user", "content": first_user},
                ]
                hub.record_passive_wire_turn(
                    agent_name="omp-1", model_name="local", messages=first_messages,
                    raw_reply="OK", reasoning_text="", tool_calls=[], metrics={},
                    kv_status="cold", elapsed_s=1.0,
                )
                second_messages = [
                    *first_messages,
                    {"role": "assistant", "content": "OK, with a rewritten anchor."},
                    {"role": "user", "content": "<system-reminder>\\nEphemeral side-channel turn; reuses current conversation context."},
                    {"role": "user", "content": "<title-request>name the session</title-request>"},
                ]
                hub.record_passive_wire_turn(
                    agent_name="omp-1", model_name="local", messages=second_messages,
                    raw_reply="<title emoji=\\\"🧪\\\" code=\\\"TEST\\\">Smoke test</title>",
                    reasoning_text="", tool_calls=[], metrics={}, kv_status="warm", elapsed_s=0.2,
                )
                self.assertEqual(list(hub.mirrors), ["omp-1"])
                self.assertEqual(len(hub.mirrors["omp-1"]["turns"]), 1)
                self.assertEqual(hub.mirrors["omp-1"]["turns"][0]["reply_en"], "OK")
            finally:
                hub.shutdown()

    def test_assistant_anchor_rewrite_does_not_archive_an_active_session(self):
        with TemporaryDirectory() as temp_dir:
            hub = BridgeHub(DataStore(Path(temp_dir) / ".data"), 0)
            hub.config["translation"]["enabled"] = False
            try:
                first_messages = [
                    {"role": "system", "content": "system"},
                    {"role": "user", "content": "first user prompt"},
                ]
                hub.record_passive_wire_turn(
                    agent_name="omp-2", model_name="local", messages=first_messages,
                    raw_reply="initial short reply", reasoning_text="", tool_calls=[], metrics={},
                    kv_status="cold", elapsed_s=0.1,
                )
                # A fresh short request in the same PTY may have a different first
                # user/assistant anchor but still belongs to this mirror channel.
                next_messages = [
                    {"role": "system", "content": "system"},
                    {"role": "user", "content": "second user prompt"},
                ]
                hub.record_passive_wire_turn(
                    agent_name="omp-2", model_name="local", messages=next_messages,
                    raw_reply="second reply", reasoning_text="", tool_calls=[], metrics={},
                    kv_status="warm", elapsed_s=0.1,
                )
                self.assertEqual(list(hub.mirrors), ["omp-2"])
                self.assertEqual(len(hub.mirrors["omp-2"]["turns"]), 2)
                self.assertEqual(hub.mirrors["omp-2"]["turns"][-1]["user_raw"], "second user prompt")
            finally:
                hub.shutdown()

    def test_live_mirror_snapshot_exposes_busy_activity_for_control_room(self):
        with TemporaryDirectory() as temp_dir:
            hub = BridgeHub(DataStore(Path(temp_dir) / ".data"), 0)
            try:
                hub.mirrors["omp"] = hub._new_mirror_obj("omp")
                hub.pty_heartbeats["omp"] = time.time()
                hub.agent_activity["omp"] = {"status": "GENERATING", "started_at": 1}
                with patch("backend.agents.probe_upstream_passive", return_value={"online": False, "available_models": []}):
                    with patch("backend.agents.probe_translator_health", return_value=True):
                        snapshot = hub.build_state_snapshot()
                item = next(mirror for mirror in snapshot["mirrors"] if mirror["agent_id"] == "omp")
                self.assertTrue(item["pty_live"])
                self.assertEqual(item["activity"], "GENERATING")
            finally:
                hub.shutdown()

    def test_fresh_pty_does_not_reuse_retained_history_name(self):
        self.hub.mirrors = {"pi": {"turns": [{"id": "old"}]}}
        self.hub.pty_heartbeats = {}
        self.hub.agent_activity = {}
        self.hub._persist_mirror = lambda mirror: None
        self.hub.broadcast_state = lambda: None
        name = self.hub.register_pty("pi")
        self.assertEqual(name, "pi-2")
        self.assertEqual(self.hub.mirrors["pi"]["turns"][0]["id"], "old")

    def test_duplicate_terminal_launches_are_named_automatically(self):
        self.hub.mirrors = {}
        self.hub.pty_heartbeats = {}
        self.hub.agent_activity = {}
        self.hub._persist_mirror = lambda mirror: None
        self.hub.broadcast_state = lambda: None
        first = self.hub.register_pty("pi")
        second = self.hub.register_pty("pi")
        self.assertEqual((first, second), ("pi", "pi-2"))
        self.assertEqual(self.hub.view_id, "pi-2")


if __name__ == "__main__":
    unittest.main()
