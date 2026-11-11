import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

from backend.agents import BridgeHub
from backend.store import DataStore


class LiveRouteTraceTests(unittest.TestCase):
    def test_active_route_exposes_only_safe_route_metadata_and_clears(self):
        with TemporaryDirectory() as temp_dir:
            hub = BridgeHub(DataStore(Path(temp_dir) / ".data"), 18080)
            hub.broadcast_state = Mock()

            hub.wire_request_started("omp-2", {
                "route_mode": "local",
                "provider": "local",
                "model": "MiniCPM-2B",
                "api_key": "must-never-be-copied",
            })
            self.assertEqual(set(hub.active_routes["omp-2"]), {
                "agent_id", "started_at", "status", "route_mode", "provider", "model"
            })
            self.assertEqual(hub.active_routes["omp-2"]["model"], "MiniCPM-2B")

            hub.update_wire_route("omp-2", route_mode="online-fallback", provider="OpenRouter", model="model-x")
            self.assertEqual(hub.active_routes["omp-2"]["route_mode"], "online-fallback")
            self.assertEqual(hub.active_routes["omp-2"]["provider"], "OpenRouter")

            hub.wire_request_completed("omp-2")
            self.assertNotIn("omp-2", hub.active_routes)

    def test_failed_route_is_removed_and_agent_returns_idle(self):
        with TemporaryDirectory() as temp_dir:
            hub = BridgeHub(DataStore(Path(temp_dir) / ".data"), 18080)
            hub.broadcast_state = Mock()
            hub.wire_request_started("pi-3", {"route_mode": "online", "provider": "OpenRouter", "model": "m"})
            hub.wire_request_failed("pi-3")
            self.assertNotIn("pi-3", hub.active_routes)
            self.assertEqual(hub.agent_activity["pi-3"]["status"], "IDLE")


if __name__ == "__main__":
    unittest.main()
