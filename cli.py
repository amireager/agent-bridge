#!/usr/bin/env python3
"""
Transparent Interactive PTY Wrapper (`--wrap pi`) + Sandbox RPC Worker (`--pi-worker`).

Recommended Usage Inside Your Sandbox (`box` / `dev agent`):
    python3 /path/to/agent-bridge/cli.py --wrap pi

What `--wrap pi` does:
  1) Opens the 100% REAL, full-color interactive `pi` TUI right in your terminal
     (all slash commands, menus, diffs, and keyboard shortcuts work natively!).
  2) Automatically routes `pi`'s LLM requests through `http://127.0.0.1:18080/v1`
     so `agent-bridge` extracts every reply, tool call, KV-cache stat, and
     paragraph-by-paragraph Persian translation onto the Web UI automatically!
  3) Listens for verified English prompts from the Web UI and types them straight
     into your open `pi` TUI (with Bracketed Paste for multi-line prompts) without copy-pasting!
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import pty
import select
import shlex
import signal
import subprocess
import sys
import tempfile
import termios
import threading
import time
import tty
import urllib.request
from pathlib import Path

LOOPBACK_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post_json(base: str, path: str, obj: dict) -> dict:
    req = urllib.request.Request(
        base + path,
        data=json.dumps(obj).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with LOOPBACK_OPENER.open(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def get_json(base: str, path: str) -> dict:
    with LOOPBACK_OPENER.open(base + path, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def _prepare_pi_bridge_env(base: str, force_isolated: bool = False) -> dict[str, str]:
    env = os.environ.copy()
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(k, None)

    try:
        st = get_json(base, "/api/state")
        model_id = st.get("upstream", {}).get("detected_model") or "local-model"
    except Exception:
        model_id = "local-model"
    if model_id == "listening...":
        model_id = "local-model"

    if force_isolated or ("PI_CODING_AGENT_DIR" not in env and not (Path.home() / ".pi/agent/models.json").exists()):
        tmp_dir = Path(tempfile.mkdtemp(prefix="ab-pty-pi-"))
        models_json = {
            "providers": {
                "agent-bridge": {
                    "baseUrl": f"{base}/v1",
                    "api": "openai-completions",
                    "apiKey": "agent:pi",
                    "compat": {
                        "supportsDeveloperRole": False,
                        "supportsReasoningEffort": False,
                        "maxTokensField": "max_tokens",
                    },
                    "models": [
                        {
                            "id": model_id,
                            "name": model_id,
                            "reasoning": True,
                            "input": ["text"],
                            "contextWindow": 32768,
                            "maxTokens": 2048,
                            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                        }
                    ],
                }
            }
        }
        (tmp_dir / "models.json").write_text(json.dumps(models_json, indent=2), encoding="utf-8")
        (tmp_dir / "settings.json").write_text(
            json.dumps({"defaultProvider": "agent-bridge", "defaultModel": model_id}, indent=2),
            encoding="utf-8",
        )
        env["PI_CODING_AGENT_DIR"] = str(tmp_dir)

    env["OPENAI_BASE_URL"] = f"{base}/v1"
    env.setdefault("OPENAI_API_KEY", "agent:pi")
    env["PI_OFFLINE"] = "1"
    return env


def run_transparent_pty_wrap(base: str, wrap_cmd: str) -> int:
    """Spawns the real interactive TUI in a Linux PTY + injects Web UI prompts seamlessly."""
    cmd_list = shlex.split(wrap_cmd)
    child_env = _prepare_pi_bridge_env(base, force_isolated=False)

    pid, master_fd = pty.fork()
    if pid == 0:
        os.execvpe(cmd_list[0], cmd_list, child_env)
        os._exit(1)

    def sync_winsize(*_args) -> None:
        try:
            packed = fcntl.ioctl(sys.stdin.fileno(), termios.TIOCGWINSZ, b"\x00" * 8)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, packed)
        except OSError:
            pass

    sync_winsize()
    signal.signal(signal.SIGWINCH, sync_winsize)

    alive = True

    def heartbeat_loop() -> None:
        while alive:
            try:
                post_json(base, "/api/pty/heartbeat", {})
            except Exception:
                pass
            time.sleep(8.0)

    def sse_inject_loop() -> None:
        while alive:
            try:
                with LOOPBACK_OPENER.open(base + "/api/events", timeout=86400) as resp:
                    for raw in resp:
                        if not alive:
                            break
                        ls = raw.decode("utf-8", errors="replace").strip()
                        if not ls.startswith("data:"):
                            continue
                        ev = json.loads(ls[5:].strip())
                        if ev.get("kind") == "pty_inject":
                            msg = ev.get("message", "").strip()
                            if msg:
                                if "\n" in msg:
                                    os.write(master_fd, f"\x1b[200~{msg}\x1b[201~".encode("utf-8"))
                                    time.sleep(0.06)
                                    os.write(master_fd, b"\r")
                                else:
                                    os.write(master_fd, (msg + "\r").encode("utf-8"))
                        elif ev.get("kind") == "pty_abort":
                            os.write(master_fd, b"\x03")
            except Exception:
                time.sleep(2.0)

    threading.Thread(target=heartbeat_loop, daemon=True).start()
    threading.Thread(target=sse_inject_loop, daemon=True).start()

    old_tty = None
    if sys.stdin.isatty():
        old_tty = termios.tcgetattr(sys.stdin.fileno())
        tty.setraw(sys.stdin.fileno())

    try:
        while True:
            rlist, _, _ = select.select([sys.stdin.fileno(), master_fd], [], [], 0.5)
            if sys.stdin.fileno() in rlist:
                data = os.read(sys.stdin.fileno(), 4096)
                if not data:
                    break
                os.write(master_fd, data)
            if master_fd in rlist:
                try:
                    out = os.read(master_fd, 8192)
                    if not out:
                        break
                    os.write(sys.stdout.fileno(), out)
                except OSError:
                    break
    finally:
        alive = False
        if old_tty is not None:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, old_tty)
        try:
            os.close(master_fd)
        except OSError:
            pass
        _, status = os.waitpid(pid, 0)
        return os.waitstatus_to_exitcode(status)


def run_headless_pi_worker(base: str, pi_cmd: str = "pi") -> int:
    """Headless RPC worker mode (kept for backward compatibility)."""
    env = _prepare_pi_bridge_env(base, force_isolated=True)
    sess_dir = Path(env["PI_CODING_AGENT_DIR"]) / "sessions"
    sess_dir.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [*shlex.split(pi_cmd), "--mode", "rpc", "--session-dir", str(sess_dir)],
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        bufsize=0,
    )
    print(f"[agent-bridge] Headless pi RPC worker connected to {base} (cwd={os.getcwd()})", flush=True)

    def read_stdout() -> None:
        assert proc.stdout is not None
        for raw in iter(proc.stdout.readline, b""):
            ln = raw.decode("utf-8", errors="replace").strip()
            if ln.startswith("{"):
                try:
                    post_json(base, "/api/worker/rpc-event", json.loads(ln))
                except Exception:
                    pass

    def hb_loop() -> None:
        while proc.poll() is None:
            try:
                post_json(base, "/api/worker/heartbeat", {})
            except Exception:
                pass
            time.sleep(8.0)

    threading.Thread(target=read_stdout, daemon=True).start()
    threading.Thread(target=hb_loop, daemon=True).start()

    while proc.poll() is None:
        try:
            with LOOPBACK_OPENER.open(base + "/api/events", timeout=86400) as resp:
                for raw in resp:
                    ls = raw.decode("utf-8", errors="replace").strip()
                    if not ls.startswith("data:") or not proc.stdin:
                        continue
                    ev = json.loads(ls[5:].strip())
                    if ev.get("kind") == "worker_prompt":
                        cmd = {"type": "prompt", "message": ev.get("message", "")}
                        proc.stdin.write((json.dumps(cmd, ensure_ascii=False) + "\n").encode("utf-8"))
                        proc.stdin.flush()
                    elif ev.get("kind") == "worker_abort":
                        proc.stdin.write(b'{"type":"abort"}\n')
                        proc.stdin.flush()
        except KeyboardInterrupt:
            proc.terminate()
            break
        except Exception:
            time.sleep(2.0)
    return proc.returncode or 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Transparent PTY Wrapper (`--wrap pi`) & Sandbox Bridge")
    ap.add_argument("--url", default="http://127.0.0.1:18080", help="Agent Bridge URL")
    ap.add_argument(
        "--wrap",
        default="pi",
        help="Interactive TUI command to run inside PTY (default: 'pi')",
    )
    ap.add_argument(
        "--pi-worker",
        action="store_true",
        help="Run headless `pi --mode rpc` worker instead of interactive TUI",
    )
    args = ap.parse_args()
    base = args.url.rstrip("/")
    if args.pi_worker:
        sys.exit(run_headless_pi_worker(base, args.wrap))
    sys.exit(run_transparent_pty_wrap(base, args.wrap))


if __name__ == "__main__":
    main()
