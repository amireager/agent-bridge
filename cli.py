#!/usr/bin/env python3
"""
Transparent Interactive PTY Wrapper (`cli.py --wrap pi`) for Agent Bridge:
1) Fixes `~/.pi/agent/models.json` bypass: clones your existing `pi` config/auth into a
   clean runtime dir while guaranteeing `baseUrl` routes through `http://127.0.0.1:18080/v1`!
2) Multi-Terminal Auto-Naming: open 2 or 3 terminals (`pi`, `pi-2`, `pi-3`) and each gets
   its own independent live mirror channel + KV slot automatically!
3) Clean `Ctrl+C` Exit: single `Ctrl+C` interrupts active generation inside `pi`; pressing
   `Ctrl+C` twice within 1.4s (or `SIGTERM`/`SIGHUP`) kills the entire child process group,
   restores terminal state, unregisters from Web UI, and exits 0 with ZERO tracebacks!
"""

from __future__ import annotations

import argparse
import errno
import fcntl
import json
import os
import pty
import select
import shlex
import shutil
import signal
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
    with LOOPBACK_OPENER.open(req, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))


def get_json(base: str, path: str) -> dict:
    with LOOPBACK_OPENER.open(base + path, timeout=6) as r:
        return json.loads(r.read().decode("utf-8"))


def _build_routed_pi_env(base: str, agent_id: str) -> tuple[dict[str, str], Path]:
    """Clones user ~/.pi/agent settings if present and forces baseUrl -> :18080/v1."""
    env = os.environ.copy()
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(k, None)

    try:
        st = get_json(base, "/api/state")
        model_id = st.get("upstream", {}).get("detected_model") or "local-model"
        srv_ctx = int(st.get("upstream", {}).get("server_ctx") or 32768)
    except Exception:
        model_id = "local-model"
        srv_ctx = 32768
    if model_id == "listening...":
        model_id = "local-model"

    try:
        data_root = Path(get_json(base, "/api/state").get("storage", {}).get("data_dir", ""))
    except Exception:
        data_root = Path(__file__).resolve().parent / ".data"
    runtime_root = data_root / "pty-runtime"
    runtime_root.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(tempfile.mkdtemp(prefix=f"{agent_id}-", dir=runtime_root))
    user_pi_dir = Path(env.get("PI_CODING_AGENT_DIR") or (Path.home() / ".pi/agent"))

    # Copy user extensions / sessions / prompts / keybindings if they exist so user keeps their customizations
    if user_pi_dir.is_dir():
        for item in user_pi_dir.iterdir():
            if item.name in ("models.json", "settings.json"):
                continue
            dst = tmp_dir / item.name
            try:
                if item.is_dir():
                    os.symlink(item, dst)
                elif item.is_file():
                    shutil.copy2(item, dst)
            except OSError:
                pass

    models_json = {
        "providers": {
            "agent-bridge": {
                "baseUrl": f"{base}/v1",
                "api": "openai-completions",
                "apiKey": f"agent:{agent_id}",
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
                        "contextWindow": max(16384, srv_ctx),
                        "maxTokens": 4096,
                        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                    }
                ],
            }
        }
    }

    settings_data: dict = {}
    if (user_pi_dir / "settings.json").is_file():
        try:
            settings_data = json.loads((user_pi_dir / "settings.json").read_text(encoding="utf-8"))
        except Exception:
            settings_data = {}
    settings_data["defaultProvider"] = "agent-bridge"
    settings_data["defaultModel"] = model_id

    (tmp_dir / "models.json").write_text(json.dumps(models_json, indent=2), encoding="utf-8")
    (tmp_dir / "settings.json").write_text(json.dumps(settings_data, indent=2), encoding="utf-8")

    env["PI_CODING_AGENT_DIR"] = str(tmp_dir)
    env["OPENAI_BASE_URL"] = f"{base}/v1"
    env["OPENAI_API_KEY"] = f"agent:{agent_id}"
    env["PI_OFFLINE"] = "1"
    return env, tmp_dir


def _kill_child_group(pid: int) -> None:
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            return
        except OSError:
            try:
                os.kill(pid, sig)
            except OSError:
                return
        for _ in range(8):
            try:
                wpid, _ = os.waitpid(pid, os.WNOHANG)
                if wpid == pid:
                    return
            except ChildProcessError:
                return
            time.sleep(0.04)


def run_transparent_pty_wrap(base: str, wrap_cmd: str, explicit_name: str = "") -> int:
    cmd_list = shlex.split(wrap_cmd)
    desired_base = Path(cmd_list[0]).name if cmd_list else "pi"

    try:
        reg = post_json(base, "/api/pty/register", {"desired": desired_base, "explicit": explicit_name})
        agent_id = reg.get("agent_id", explicit_name or desired_base)
    except Exception:
        agent_id = explicit_name or desired_base

    child_env, tmp_dir = _build_routed_pi_env(base, agent_id)
    print(
        f"[agent-bridge] Linked as '{agent_id}' -> {base}/v1  (Press Ctrl+C twice quickly to force-quit)\r",
        flush=True,
    )

    pid, master_fd = pty.fork()
    if pid == 0:
        try:
            os.execvpe(cmd_list[0], cmd_list, child_env)
        except Exception as exc:
            sys.stderr.write(f"Failed to launch {cmd_list[0]}: {exc}\n")
        os._exit(1)

    def sync_winsize(*_args) -> None:
        try:
            if sys.stdin.isatty():
                packed = fcntl.ioctl(sys.stdin.fileno(), termios.TIOCGWINSZ, b"\x00" * 8)
                fcntl.ioctl(master_fd, termios.TIOCSWINSZ, packed)
        except OSError:
            pass

    sync_winsize()
    signal.signal(signal.SIGWINCH, sync_winsize)

    alive = True

    def _force_terminate(*_args) -> None:
        nonlocal alive
        alive = False
        _kill_child_group(pid)

    signal.signal(signal.SIGTERM, _force_terminate)
    signal.signal(signal.SIGHUP, _force_terminate)

    def heartbeat_loop() -> None:
        while alive:
            try:
                post_json(base, "/api/pty/heartbeat", {"agent_id": agent_id})
            except Exception:
                pass
            time.sleep(7.0)

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
                        if ev.get("kind") == "pty_inject" and ev.get("agent_id") == agent_id:
                            msg = ev.get("message", "").strip()
                            if msg:
                                if "\n" in msg:
                                    os.write(master_fd, f"\x1b[200~{msg}\x1b[201~".encode("utf-8"))
                                    time.sleep(0.06)
                                    os.write(master_fd, b"\r")
                                else:
                                    os.write(master_fd, (msg + "\r").encode("utf-8"))
                        elif ev.get("kind") == "pty_abort" and ev.get("agent_id") == agent_id:
                            os.write(master_fd, b"\x03")
            except Exception:
                time.sleep(1.8)

    threading.Thread(target=heartbeat_loop, daemon=True).start()
    threading.Thread(target=sse_inject_loop, daemon=True).start()

    old_tty = None
    is_tty = sys.stdin.isatty()
    if is_tty:
        old_tty = termios.tcgetattr(sys.stdin.fileno())
        tty.setraw(sys.stdin.fileno())

    last_ctrl_c_ts = 0.0

    try:
        while alive:
            try:
                rlist, _, _ = select.select([sys.stdin.fileno(), master_fd], [], [], 0.3)
            except InterruptedError:
                continue
            except (ValueError, OSError):
                break

            if sys.stdin.fileno() in rlist:
                try:
                    data = os.read(sys.stdin.fileno(), 4096)
                except OSError:
                    break
                if not data:
                    break
                # Double Ctrl+C within 1.4s -> immediate clean exit & kill child process group!
                if b"\x03" in data:
                    now = time.monotonic()
                    if (now - last_ctrl_c_ts) < 1.4:
                        alive = False
                        _kill_child_group(pid)
                        break
                    last_ctrl_c_ts = now
                try:
                    os.write(master_fd, data)
                except OSError:
                    break

            if master_fd in rlist:
                try:
                    out = os.read(master_fd, 8192)
                    if not out:
                        break
                    os.write(sys.stdout.fileno(), out)
                except OSError as e:
                    if e.errno in (errno.EIO, errno.EBADF):
                        break
                    break
    except KeyboardInterrupt:
        pass
    finally:
        alive = False
        if old_tty is not None:
            try:
                termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, old_tty)
            except OSError:
                pass
        _kill_child_group(pid)
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            post_json(base, "/api/pty/unregister", {"agent_id": agent_id})
        except Exception:
            pass
        shutil.rmtree(tmp_dir, ignore_errors=True)
        sys.stdout.write(f"\r\n[agent-bridge] '{agent_id}' closed cleanly.\r\n")
        sys.stdout.flush()
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Transparent PTY Wrapper (`--wrap pi`) for Agent Bridge")
    ap.add_argument("--url", default="http://127.0.0.1:18080", help="Agent Bridge URL")
    ap.add_argument("--wrap", default="pi", help="Interactive TUI command to wrap (default: 'pi')")
    ap.add_argument("--name", default="", help="Optional custom channel name (auto-assigns pi, pi-2, ... if omitted)")
    args = ap.parse_args()
    try:
        sys.exit(run_transparent_pty_wrap(args.url.rstrip("/"), args.wrap, args.name.strip()))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
