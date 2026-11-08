#!/usr/bin/env python3
"""
Native Terminal Client (Zellij-style Shared Session Attach).
Run `./cli.py` in any real Linux terminal (foot / kitty / alacritty / zellij).
Both your real terminal AND the Web UI attach to the exact same live session!
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import urllib.request

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
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def sse_listener(base: str) -> None:
    try:
        with urllib.request.urlopen(base + "/api/events", timeout=3600) as resp:
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
                elif kind == "cli_log":
                    src = ev.get("source", "")
                    if src in ("tool", "tap"):
                        print(f"\n{DIM}  [{ev.get('ts')}] {src}: {ev.get('text')}{RESET}")
                elif kind == "turn_complete":
                    t = ev["turn"]
                    if t.get("reply_fa"):
                        print(f"\n{GREEN}[FA]{RESET} {t['reply_fa']}")
                    sys.stdout.write(f"\n{AMBER}ab>{RESET} ")
                    sys.stdout.flush()
    except Exception as exc:
        print(f"\n{DIM}[disconnected: {exc}]{RESET}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Attach real terminal to live Agent Bridge session")
    ap.add_argument("--url", default="http://127.0.0.1:18080")
    ap.add_argument("--once", default=None, help="Send one prompt from CLI and exit")
    args = ap.parse_args()

    base = args.url.rstrip("/")
    if args.once:
        res = post_json(base, "/api/prompt", {"user_raw": args.once, "source": "cli"})
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    st = json.loads(urllib.request.urlopen(base + "/api/state", timeout=5).read().decode("utf-8"))
    print(
        f"{GREEN}=== Agent Bridge Live Terminal Attach ==={RESET}\n"
        f"Connected : {base}  |  Agent: {st['active_agent']}  |  Session: {st['active_session']['title']}\n"
        f"{DIM}Commands  : /new (new session), /abort (stop generation), /quit (detach){RESET}\n"
    )
    threading.Thread(target=sse_listener, args=(base,), daemon=True).start()

    while True:
        try:
            line = input(f"{AMBER}ab>{RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nDetached (session remains live).")
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
        post_json(base, "/api/prompt", {"user_raw": line, "source": "cli"})


if __name__ == "__main__":
    main()
