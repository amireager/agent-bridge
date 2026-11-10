import json
import os
import pty
import select
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cli


class AgentAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = {
            "upstream": {"detected_model": "sample-model", "server_ctx": 65536},
            "storage": {"data_dir": str(self.root)},
        }
        self.get_json = lambda base, path: self.state if path == "/api/state" else {}
        self.patch = patch.object(cli, "get_json", side_effect=self.get_json)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_omp_runtime_uses_per_run_openai_provider_and_never_copies_credentials(self):
        env, runtime, command = cli._prepare_agent_runtime(
            "http://127.0.0.1:18080", "omp-2", ["omp"], "omp"
        )
        try:
            agent_dir = Path(env["PI_CODING_AGENT_DIR"])
            models = json.loads((agent_dir / "models.yml").read_text())
            settings = json.loads((agent_dir / "config.yml").read_text())
            route = models["providers"]["agent-bridge"]
            self.assertEqual(route["baseUrl"], "http://127.0.0.1:18080/v1")
            self.assertEqual(route["apiKey"], "agent:omp-2")
            self.assertEqual(route["models"][0]["id"], "sample-model")
            self.assertEqual(settings["modelRoles"]["default"], "agent-bridge/sample-model")
            self.assertEqual(settings["setupVersion"], 3)
            self.assertFalse(settings["startup"]["setupWizard"])
            self.assertFalse(settings["update"]["auto"])
            self.assertEqual(command, ["omp", "--model", "agent-bridge/sample-model"])
            self.assertTrue(str(runtime).startswith(str(self.root / "pty-runtime")))
        finally:
            import shutil
            shutil.rmtree(runtime, ignore_errors=True)

    def test_hermes_gets_isolated_custom_endpoint_configuration(self):
        env, runtime, command = cli._prepare_agent_runtime(
            "http://127.0.0.1:18080", "hermes-2", ["hermes"], "hermes"
        )
        try:
            config_path = Path(env["HERMES_HOME"]) / "config.yaml"
            config = json.loads(config_path.read_text())
            self.assertEqual(config["model"]["provider"], "custom")
            self.assertEqual(config["model"]["base_url"], "http://127.0.0.1:18080/v1")
            self.assertEqual(config["model"]["api_key"], "agent:hermes-2")
            self.assertIn("--tui", command)
        finally:
            import shutil
            shutil.rmtree(runtime, ignore_errors=True)

    def test_codewhale_routes_to_bridge_and_seeds_api_key_via_stdin(self):
        completed = SimpleNamespace(returncode=0, stdout="saved")
        with patch.object(cli.subprocess, "run", return_value=completed) as run:
            env, runtime, command = cli._prepare_agent_runtime(
                "http://127.0.0.1:18080", "codewhale-2", ["codewhale"], "codewhale"
            )
        try:
            self.assertEqual(env["CODEWHALE_TELEMETRY"], "0")
            self.assertEqual(env["CODEWHALE_HOME"], str(runtime / "codewhale-home"))
            self.assertIn("http://127.0.0.1:18080/v1", command)
            self.assertNotIn("--api-key", command)
            self.assertNotIn("agent:codewhale-2", command)
            self.assertEqual(command[command.index("--model") + 1], "sample-model")
            self.assertIn("--config", command)
            self.assertIn("false", command)
            auth_args, auth_kwargs = run.call_args.args[0], run.call_args.kwargs
            self.assertIn("--api-key-stdin", auth_args)
            self.assertNotIn("agent:codewhale-2", auth_args)
            self.assertEqual(auth_kwargs["input"], "agent:codewhale-2")
            self.assertEqual(auth_kwargs["env"]["CODEWHALE_TELEMETRY"], "0")
        finally:
            import shutil
            shutil.rmtree(runtime, ignore_errors=True)

    def test_letta_setup_is_isolated_and_uses_bridge_model(self):
        completed = SimpleNamespace(returncode=0, stdout="connected")
        with patch.object(cli.subprocess, "run", return_value=completed) as run:
            env, runtime, command = cli._prepare_agent_runtime(
                "http://127.0.0.1:18080", "letta-2", ["letta"], "letta"
            )
        try:
            self.assertEqual(env["LETTA_CONFIG_DIR"], str(runtime / "letta-config"))
            self.assertEqual(run.call_args.args[0][1:4], ["--backend", "local", "connect"])
            self.assertIn("agent:letta-2", run.call_args.args[0])
            self.assertEqual(command[:3], ["letta", "--backend", "local"])
            self.assertIn("openai-compatible/sample-model", command)
        finally:
            import shutil
            shutil.rmtree(runtime, ignore_errors=True)

    def test_dsh_uses_per_run_patch_and_unique_session_root(self):
        home = self.root / "agent-runtimes" / "dsh-home"
        (home / "profiles" / "tui").mkdir(parents=True)
        env, runtime, command = cli._prepare_agent_runtime(
            "http://127.0.0.1:18080", "dsh-2", ["dsh"], "dsh"
        )
        try:
            self.assertEqual(env["DSH_HOME"], str(home))
            self.assertTrue(Path(env["DSH_TUI_SESSION_ROOT"]).is_relative_to(runtime))
            patch_path = Path(command[command.index("--patch") + 1])
            patch = json.loads(patch_path.read_text())
            self.assertEqual(patch[0]["config"]["providers"]["agent-bridge"]["apiKeyEnv"], "DSH_AGENT_BRIDGE_KEY")
            self.assertEqual(patch[1]["config"]["model"], "sample-model")
        finally:
            import shutil
            shutil.rmtree(runtime, ignore_errors=True)

    def test_hermes_sidecar_shutdown_is_scoped_to_the_isolated_cli(self):
        with patch.object(cli.subprocess, "run") as run:
            cli._stop_hermes_gateway("hermes", {"HERMES_HOME": "/tmp/bridge-hermes-run"})
        self.assertEqual(run.call_args.args[0], ["hermes", "gateway", "stop"])
        self.assertEqual(run.call_args.kwargs["env"]["HERMES_HOME"], "/tmp/bridge-hermes-run")
        self.assertEqual(run.call_args.kwargs["stdin"], cli.subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs["timeout"], 15)

    def test_generic_and_forge_adapters_export_bridge_endpoint_without_saving_key(self):
        for adapter, binary, key_name in (("generic", "custom-agent", "OPENAI_BASE_URL"),
                                           ("forge", "forge", "OPENAI_URL")):
            env, runtime, command = cli._prepare_agent_runtime(
                "http://127.0.0.1:18080", f"{adapter}-1", [binary], adapter
            )
            try:
                self.assertEqual(env[key_name], "http://127.0.0.1:18080/v1")
                self.assertEqual(env["OPENAI_API_KEY"], f"agent:{adapter}-1")
                self.assertEqual(command, [binary])
            finally:
                import shutil
                shutil.rmtree(runtime, ignore_errors=True)


class PtyInputTests(unittest.TestCase):
    def test_single_line_is_typed_then_entered_into_child_tty(self):
        master, slave = pty.openpty()
        pid = os.fork()
        if pid == 0:
            os.close(master)
            os.dup2(slave, 0)
            os.dup2(slave, 1)
            os.dup2(slave, 2)
            if slave > 2:
                os.close(slave)
            os.execlp("python3", "python3", "-c", "import sys; print('RECEIVED:' + sys.stdin.readline().strip())")
        os.close(slave)
        try:
            time.sleep(0.05)
            cli._inject_pty_prompt(master, "hello from UI")
            output = bytearray()
            deadline = time.monotonic() + 2
            while b"RECEIVED:hello from UI" not in output and time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], 0.1)
                if ready:
                    try:
                        output.extend(os.read(master, 4096))
                    except OSError:
                        break
            self.assertIn(b"RECEIVED:hello from UI", output)
        finally:
            try:
                os.close(master)
            except OSError:
                pass
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass

    def test_single_line_text_and_enter_are_separate_pty_events(self):
        self.assertEqual(cli._pty_prompt_chunks("hello"), (b"hello", b"\r"))

    def test_multiline_prompt_uses_bracketed_paste_then_enter(self):
        chunks = cli._pty_prompt_chunks("first line\nsecond line")
        self.assertEqual(chunks, (b"\x1b[200~first line\nsecond line\x1b[201~", b"\r"))

    def test_empty_prompt_does_not_press_enter(self):
        self.assertEqual(cli._pty_prompt_chunks("  \n  "), ())


if __name__ == "__main__":
    unittest.main()
