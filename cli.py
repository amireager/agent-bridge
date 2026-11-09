#!/usr/bin/env python3
"""
Native Terminal & Sandbox Worker Client (Zellij-style Shared Session).
Modes:
  1. Interactive CLI attach : python3 cli.py
  2. Sandbox Pi Worker      : python3 cli.py --pi-worker
     (Run this INSIDE your Bubblewrap `box` / `dev agent` sandbox where `pi` lives!
      `agent-bridge` stays safely outside on the host, while `pi` runs inside the sandbox!)
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

LOOPBACK_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

DIM = "\033[2m"
GREEN = "\033[32m"
CYAN = "\033[36m"
AMBER = "\033[33m"
RESET = "\033[0m"


def post_json(base: str, path: str, obj: dict) -> dict:
    req = urllib.request.Request(
        base + path,
        data=json.dumps(obj).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with LOOPBACK_OPENER.open(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def get_json(base: str, path: str) -> dict:
    with LOOPBACK_OPENER.open(base + path, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def run_sandbox_pi_worker(base: str, pi_cmd: str) -> None:
    """Runs INSIDE the sandbox where `pi` is installed, bridged over localhost to host UI."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="ab-pi-worker-"))
    sess_dir = tmp_dir / "sessions"
    sess_dir.mkdir(parents=True, exist_ok=True)

    st = get_json(base, "/api/state")
    model_id = st.get("upstream", {}).get("detected_model") or "local-model"
    if model_id == "listening...":
        model_id = "local-model"

    models_json = {
        "providers": {
            "bridge-tap": {
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
        json.dumps({"defaultProvider": "bridge-tap", "defaultModel": model_id}, indent=2),
        encoding="utf-8",
    )

    env = os.environ.copy()
    env["PI_CODING_AGENT_DIR"] = str(tmp_dir)
    env["PI_OFFLINE"] = "1"
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(k, None)

    proc = subprocess.Popen(
        [pi_cmd, "--mode", "rpc", "--session-dir", str(sess_dir)],
        cwd=os.getcwd(),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    print(
        f"{GREEN}=== Sandbox Pi Worker Connected ==={RESET}\n"
        f"Bridge UI : {base}\n"
        f"SandboxWD : {os.getcwd()}\n"
        f"Model     : {model_id}\n"
        f"{DIM}Ready! Send prompts from Web UI or attach another terminal.{RESET}\n"
    )

    def forward_stdout() -> None:
        assert proc.stdout is not None
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
                if ev.get("type") == "message_update":
                    ae = ev.get("assistantMessageEvent", {})
                    if ae.get("type") == "text_delta":
                        sys.stdout.write(ae.get("delta", ""))
                        sys.stdout.flush()
                elif ev.get("type") == "agent_end":
                    print(f"\n{GREEN}[done]{RESET}")
                post_json(base, "/api/worker/rpc-event", ev)
            except Exception:
                pass

    def heartbeat_loop() -> None:
        while proc.poll() is None:
            try:
                post_json(base, "/api/worker/heartbeat", {})
            except Exception:
                pass
            time.sleep(8.0)

    threading.Thread(target=forward_stdout, daemon=True).start()
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    try:
        with LOOPBACK_OPENER.open(base + "/api/events", timeout=86400) as resp:
            for raw in resp:
                ls = raw.decode("utf-8", errors="replace").strip()
                if not ls.startswith("data:"):
                    continue
                ev = json.loads(ls[5:].strip())
                if ev.get("kind") == "worker_prompt" and proc.stdin:
                    msg = ev.get("message", "")
                    print(f"\n{CYAN}[WEB -> SANDBOX pi]{RESET} {msg}")
                    cmd = {"id": f"req-{ev.get('turn_id','1')}", "type": "prompt", "message": msg}
                    proc.stdin.write((json.dumps(cmd, ensure_ascii=False) + "\n").encode("utf-8"))
                    proc.stdin.flush()
                elif ev.get("kind") == "worker_abort" and proc.stdin:
                    proc.stdin.write(b'{"type":"abort"}\n')
                    proc.stdin.flush()
    except KeyboardInterrupt:
        print("\nStopping sandbox worker...")
    finally:
        proc.terminate()


def sse_listener(base: str) -> None:
    try:
        with LOOPBACK_OPENER.open(base + "/api/events", timeout=3600) as resp:
            for raw in resp:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                ev = json.loads(line[5:].strip())
                kind = ev.get("kind")
                if kind == "turn_started":
                    t = ev["turn"]
                    print(f"\n{CYAN}[{t['source'].upper()} -> {t['agent']}]{RESET} {t['prompt_sent']}")
                elif kind == "stream_delta":
                    if ev.get("field") == "reply_en":
                        sys.stdout.write(ev.get("delta", ""))
                        sys.stdout.flush()
                elif kind == "turn_complete":
                    t = ev["turn"]
                    if t.get("reply_fa"):
                        print(f"\n{GREEN}[FA]{RESET} {t['reply_fa']}")
                    sys.stdout.write(f"\n{AMBER}ab>{RESET} ")
                    sys.stdout.flush()
    except Exception as exc:
        print(f"\n{DIM}[disconnected: {exc}]{RESET}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Agent Bridge CLI Attach & Sandbox Worker")
    ap.add_argument("--url", default="http://127.0.0.1:18080")
    ap.add_argument("--pi-worker", action="store_true", help="Run inside sandbox to bridge `pi` to host Web UI")
    ap.add_argument("--pi-bin", default="pi", help="pi binary name inside sandbox")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    if args.pi_worker:
        return run_sandbox_pi_worker(base, args.pi_bin)

    st = get_json(base, "/api/state")
    print(
        f"{GREEN}=== Agent Bridge Live Terminal Attach ==={RESET}\n"
        f"Connected : {base}  |  Agent: {st['active_agent']}  |  Session: {st['active_session']['title']}\n"
        f"{DIM}Commands  : /new (new session), /abort (stop), /quit (detach){RESET}\n"
    )
    threading.Thread(target=sse_listener, args=(base,), daemon=True).start()

    while True:
        try:
            line = input(f"{AMBER}ab>{RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nDetached.")
            break
        if not line:
            continue
        if line == "/quit":
            break
        if line == "/abort":
            post_json(base, "/api/abort", {})
            continue
        if line == "/new":
            post_json(base, "/api/session/new", {})
            continue
        tr = post_json(base, "/api/translate", {"text": line, "to": "en"})
        sent = tr.get("translation") or line
        post_json(base, "/api/prompt", {"user_raw": line, "prompt_sent": sent, "allow_persian": True, "source": "cli"})


if __name__ == "__main__":
    main()
