import unittest
from unittest.mock import patch

from backend.agents import BridgeHub, _wire_assistant_anchor


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

    def test_assistant_anchor_is_stable_and_tool_sensitive(self):
        self.assertEqual(_wire_assistant_anchor("answer", []), _wire_assistant_anchor("answer", []))
        a = _wire_assistant_anchor("", [{"id": "1", "function": {"name": "read", "arguments": "{}"}}])
        b = _wire_assistant_anchor("", [{"id": "2", "function": {"name": "read", "arguments": "{}"}}])
        self.assertNotEqual(a, b)

    def test_fresh_pty_does_not_reuse_retained_history_name(self):
        self.hub.mirrors = {"pi": {"turns": [{"id": "old"}]}}
        self.hub.pty_heartbeats = {}
        self.hub.agent_activity = {}
        self.hub._persist_mirror = lambda mirror: None
        self.hub.broadcast_state = lambda: None
        name = self.hub.register_pty("pi")
        self.assertEqual(name, "pi-2")
        self.assertEqual(self.hub.mirrors["pi"]["turns"][0]["id"], "old")


if __name__ == "__main__":
    unittest.main()
