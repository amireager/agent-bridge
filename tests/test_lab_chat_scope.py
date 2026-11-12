import unittest

from backend.agents import BridgeHub


class LabChatScopeTests(unittest.TestCase):
    def test_lightweight_chat_exposes_no_system_or_filesystem_tools(self):
        hub = object.__new__(BridgeHub)
        self.assertEqual(hub._lab_tools_schema(), [])
        for name in ("list_files", "read_file", "write_file", "bash", "exec"):
            output, is_error = hub._exec_lab_tool(name, {})
            self.assertTrue(is_error)
            self.assertIn("not enabled", output.lower())


if __name__ == "__main__":
    unittest.main()
