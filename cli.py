#!/usr/bin/env python3
"""
Interactive PTY wrapper for Agent Bridge:
1) Routes supported agent CLIs through the currently selected Bridge model.
2) Duplicate launches are auto-named (pi, pi-2; omp, omp-2, etc.) and receive fresh mirrors.
3) UI prompts are typed into the selected agent's real terminal session, followed by Enter.
4) Ctrl+C first interrupts the child; a second press within 1.4s force-closes that child only.
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


def _route_context(base: str) -> tuple[str, int, Path]:
    """Read the Bridge-selected model and its private runtime root without exposing secrets."""
    try:
        state = get_json(base, "/api/state")
    except Exception:
        state = {}
    upstream = state.get("upstream", {}) if isinstance(state, dict) else {}
    model_id = str(upstream.get("detected_model") or "local-model")
    if model_id == "listening...":
        model_id = "local-model"
    try:
        context = max(16384, int(upstream.get("server_ctx") or 32768))
    except (TypeError, ValueError):
        context = 32768
    data_dir = str(state.get("storage", {}).get("data_dir", "")) if isinstance(state, dict) else ""
    data_root = Path(data_dir) if data_dir else Path(__file__).resolve().parent / ".data"
    return model_id, context, data_root


def _new_runtime_dir(data_root: Path, agent_id: str) -> Path:
    runtime_root = data_root / "pty-runtime"
    runtime_root.mkdir(parents=True, exist_ok=True)
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in agent_id) or "agent"
    return Path(tempfile.mkdtemp(prefix=f"{safe}-", dir=runtime_root))


def _clean_child_env() -> dict[str, str]:
    env = os.environ.copy()
    # Agent inference must reach the local Bridge directly, never through ambient proxies.
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(key, None)
    return env


def _build_routed_omp_env(base: str, agent_id: str) -> tuple[dict[str, str], Path]:
    model_id, context, data_root = _route_context(base)
    tmp_dir = _new_runtime_dir(data_root, agent_id)
    agent_dir = tmp_dir / "omp-agent"
    agent_dir.mkdir(parents=True, exist_ok=True)

    # Preserve user-authored extensions/skills without copying credentials or saved sessions.
    user_agent_dir = Path.home() / ".omp" / "agent"
    for item_name in ("extensions", "skills", "prompts", "keybindings", "themes"):
        src = user_agent_dir / item_name
        dst = agent_dir / item_name
        if src.exists() and not dst.exists():
            try:
                os.symlink(src, dst, target_is_directory=src.is_dir())
            except OSError:
                pass

    provider = {
        "providers": {
            "agent-bridge": {
                "baseUrl": f"{base}/v1",
                "api": "openai-completions",
                "apiKey": f"agent:{agent_id}",
                "models": [{
                    "id": model_id,
                    "name": model_id,
                    "contextWindow": context,
                    "maxTokens": 4096,
                    "reasoning": True,
                    "input": ["text"],
                    "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                }],
            }
        }
    }
    (agent_dir / "models.yml").write_text(json.dumps(provider, ensure_ascii=False, indent=2), encoding="utf-8")
    (agent_dir / "config.yml").write_text(json.dumps({
        "setupVersion": 3,
        "startup": {"setupWizard": False},
        "update": {"auto": False},
        "modelRoles": {"default": f"agent-bridge/{model_id}"}
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    env = _clean_child_env()
    env["PI_CODING_AGENT_DIR"] = str(agent_dir)
    env["OPENAI_BASE_URL"] = f"{base}/v1"
    env["OPENAI_API_KEY"] = f"agent:{agent_id}"
    return env, tmp_dir


def _prepare_agent_runtime(base: str, agent_id: str, cmd_list: list[str], adapter: str = "auto") -> tuple[dict[str, str], Path, list[str]]:
    """Route supported terminal agents to Bridge while keeping their per-run state under .data."""
    if not cmd_list:
        raise ValueError("فرمان عامل خالی است.")
    detected = Path(cmd_list[0]).name.lower()
    aliases = {"pi-coding-agent": "pi", "codew": "codewhale", "hermes-agent": "hermes", "dsh-tui": "dsh"}
    detected = aliases.get(detected, detected)
    kind = detected if adapter in ("", "auto") else adapter.lower()
    if kind == "pi":
        env, tmp_dir = _build_routed_pi_env(base, agent_id)
        return env, tmp_dir, cmd_list
    if kind == "omp":
        env, tmp_dir = _build_routed_omp_env(base, agent_id)
        model_id = _route_context(base)[0]
        if "--model" not in cmd_list and not any(arg.startswith("--model=") for arg in cmd_list):
            cmd_list = [cmd_list[0], "--model", f"agent-bridge/{model_id}", *cmd_list[1:]]
        return env, tmp_dir, cmd_list

    model_id, context, data_root = _route_context(base)
    tmp_dir = _new_runtime_dir(data_root, agent_id)
    env = _clean_child_env()
    base_url = f"{base}/v1"
    api_key = f"agent:{agent_id}"

    if kind == "hermes":
        hermes_home = tmp_dir / "hermes-home"
        hermes_home.mkdir(parents=True, exist_ok=True)
        config = {"model": {"default": model_id, "provider": "custom", "base_url": base_url,
                             "api_key": api_key, "api_mode": "chat_completions"}}
        (hermes_home / "config.yaml").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        env["HERMES_HOME"] = str(hermes_home)
        env["OPENAI_BASE_URL"] = base_url
        env["OPENAI_API_KEY"] = api_key
        if "--tui" not in cmd_list:
            cmd_list = [*cmd_list, "--tui"]

    elif kind == "codewhale":
        env["OPENAI_BASE_URL"] = base_url
        env["OPENAI_API_KEY"] = api_key
        env["CODEWHALE_TELEMETRY"] = "0"
        codewhale_home = tmp_dir / "codewhale-home"
        codewhale_home.mkdir(parents=True, exist_ok=True)
        codewhale_config = codewhale_home / "config.toml"
        env["CODEWHALE_HOME"] = str(codewhale_home)
        # CodeWhale's --api-key flag exposes secrets in argv, and OPENAI_API_KEY alone is not
        # accepted by all CLI builds. Seed its isolated credential store through stdin instead.
        try:
            result = subprocess.run(
                [cmd_list[0], "--config", str(codewhale_config), "auth", "set",
                 "--provider", "openai", "--api-key-stdin"],
                env=env, input=api_key, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, timeout=30, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise RuntimeError(f"آماده‌سازی امنِ کلید موقت CodeWhale ناموفق بود: {exc}") from exc
        if result.returncode:
            detail = (result.stdout or "").strip()[-1000:]
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise RuntimeError(f"CodeWhale نتوانست credential موقت را از stdin ثبت کند.\n{detail}")
        injected = ["--config", str(codewhale_config), "--provider", "openai",
                    "--base-url", base_url, "--model", model_id, "--skip-onboarding",
                    "--fresh", "--telemetry", "false"]
        cmd_list = [cmd_list[0], *injected, *cmd_list[1:]]

    elif kind == "letta":
        config_root = tmp_dir / "letta-config"
        config_root.mkdir(parents=True, exist_ok=True)
        env["LETTA_CONFIG_DIR"] = str(config_root)
        env["OPENAI_BASE_URL"] = base_url
        env["OPENAI_API_KEY"] = api_key
        setup = [cmd_list[0], "--backend", "local", "connect", "openai-compatible",
                 "--base-url", base_url, "--api-key", api_key]
        try:
            result = subprocess.run(setup, env=env, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, timeout=60, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise RuntimeError(f"آماده‌سازی اتصال Letta به Bridge ناموفق بود: {exc}") from exc
        if result.returncode:
            detail = (result.stdout or "").strip()[-1200:]
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise RuntimeError(f"Letta نتوانست endpoint مدل Bridge را تأیید کند. سرور مدل را روشن کن و دوباره اجرا کن.\n{detail}")
        cmd_list = [cmd_list[0], "--backend", "local", "--new", "--model",
                    f"openai-compatible/{model_id}", *cmd_list[1:]]

    elif kind == "dsh":
        dsh_home = data_root / "agent-runtimes" / "dsh-home"
        profile_dir = dsh_home / "profiles" / "tui"
        if not profile_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise RuntimeError("برای DSH لازم است یک پروفایل TUI محلی نصب شود؛ dsh web به‌تنهایی ترمینال تعاملی نیست.")
        env["DSH_HOME"] = str(dsh_home)
        env["DSH_AGENT_BRIDGE_KEY"] = api_key
        env["DSH_TUI_SESSION_ROOT"] = str(tmp_dir / "dsh-sessions")
        patch = [{"id": "llm-pi-ai", "config": {"providers": {"agent-bridge": {
            "displayName": "Agent Bridge", "apiKeyEnv": "DSH_AGENT_BRIDGE_KEY",
            "baseURL": base_url, "api": "openai-completions",
            "models": [{"id": model_id, "name": model_id, "contextWindow": context,
                        "maxTokens": 4096, "reasoning": True, "input": ["text"]}],
        }}}}, {"id": "agent-default-model", "config": {"provider": "agent-bridge", "model": model_id}}]
        patch_path = tmp_dir / "dsh-provider-patch.yml"
        patch_path.write_text(json.dumps(patch, ensure_ascii=False, indent=2), encoding="utf-8")
        cmd_list = [cmd_list[0], "--profile", "tui", "--patch", str(patch_path), *cmd_list[1:]]

    elif kind == "forge":
        # Forge reads custom OpenAI-compatible routes from its provider setup; these env vars
        # keep inference local to Bridge and do not persist a provider key or modify forge.yaml.
        env["OPENAI_URL"] = base_url
        env["OPENAI_BASE_URL"] = base_url
        env["OPENAI_API_KEY"] = api_key
        env["OPENAI_MODEL"] = model_id

    else:
        # Generic OpenAI-compatible fallback for other interactive CLIs.
        env["OPENAI_BASE_URL"] = base_url
        env["OPENAI_API_KEY"] = api_key
        env["OPENAI_URL"] = base_url
        env["OPENAI_MODEL"] = model_id

    return env, tmp_dir, cmd_list


def _stop_hermes_gateway(command: str, env: dict[str, str]) -> None:
    """Stop the per-run Hermes sidecar before its isolated HERMES_HOME is removed."""
    try:
        subprocess.run(
            [command, "gateway", "stop"], env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def _pty_prompt_chunks(message: str) -> tuple[bytes, ...]:
    """Encode a UI prompt as terminal input followed by Enter (bracketed paste for multiline)."""
    message = str(message or "").strip()
    if not message:
        return ()
    if "\n" in message:
        return (f"\x1b[200~{message}\x1b[201~".encode("utf-8"), b"\r")
    # Separate text and Enter so TUI event loops that read in chunks see a real submission key.
    return (message.encode("utf-8"), b"\r")


def _inject_pty_prompt(master_fd: int, message: str) -> None:
    chunks = _pty_prompt_chunks(message)
    for index, chunk in enumerate(chunks):
        os.write(master_fd, chunk)
        if index == 0 and len(chunks) > 1:
            # Let the TUI process the text event and update its composer before Enter arrives.
            time.sleep(0.25)


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


def run_transparent_pty_wrap(base: str, wrap_cmd: str, explicit_name: str = "", adapter: str = "auto") -> int:
    cmd_list = shlex.split(wrap_cmd)
    if not cmd_list:
        raise ValueError("برای راه‌اندازی عامل، نام فرمان را بعد از --wrap بنویس.")
    detected = Path(cmd_list[0]).name.lower()
    aliases = {"pi-coding-agent": "pi", "codew": "codewhale", "hermes-agent": "hermes", "dsh-tui": "dsh"}
    detected = aliases.get(detected, detected)
    selected_adapter = detected if adapter in ("", "auto") else adapter.lower()
    supported = {"pi", "omp", "hermes", "codewhale", "letta", "dsh", "forge"}
    desired_base = selected_adapter if selected_adapter in supported else detected

    try:
        reg = post_json(base, "/api/pty/register", {"desired": desired_base, "explicit": explicit_name})
        agent_id = reg.get("agent_id", explicit_name or desired_base)
    except Exception:
        # Keep even offline wrapper launches distinct; registration will retry via heartbeat.
        agent_id = explicit_name or f"{desired_base}-{os.getpid()}"

    try:
        child_env, tmp_dir, cmd_list = _prepare_agent_runtime(base, agent_id, cmd_list, selected_adapter)
    except Exception:
        try:
            post_json(base, "/api/pty/unregister", {"agent_id": agent_id})
        except Exception:
            pass
        raise
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
                            _inject_pty_prompt(master_fd, ev.get("message", ""))
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
        if selected_adapter == "hermes":
            _stop_hermes_gateway(cmd_list[0], child_env)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        sys.stdout.write(f"\r\n[agent-bridge] '{agent_id}' closed cleanly.\r\n")
        sys.stdout.flush()
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Run an interactive agent TUI in a Bridge-linked PTY")
    ap.add_argument("--url", default="http://127.0.0.1:18080", help="Agent Bridge URL")
    ap.add_argument("--wrap", default="pi", help="Interactive agent command to wrap (for example: pi, omp, hermes)")
    ap.add_argument("--adapter", default="auto", choices=("auto", "pi", "omp", "hermes", "codewhale", "letta", "dsh", "forge", "generic"), help="Provider/config adapter; auto-detected from the command by default")
    ap.add_argument("--name", default="", help="Optional channel name; otherwise each new terminal is named automatically (pi, pi-2, ...) ")
    args = ap.parse_args()
    try:
        sys.exit(run_transparent_pty_wrap(args.url.rstrip("/"), args.wrap, args.name.strip(), args.adapter))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
