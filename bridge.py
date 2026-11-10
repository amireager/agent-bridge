#!/usr/bin/env python3
"""
Agent Bridge — Modular Bilingual Wire Tap, KV-Cache Hunter & Direct Model/Agent Lab.
Clean SIGINT/SIGTERM handling: Ctrl+C closes all SSE sockets and exits 0 with zero tracebacks.
"""

from __future__ import annotations

import argparse
import signal
import sys
from pathlib import Path

from backend.agents import BridgeHub
from backend.http_server import run_http_server
from backend.store import DataStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Agent Bridge Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument("--upstream", default=None, help="Override llama-server URL")
    parser.add_argument(
        "--data-dir",
        default=str(Path(__file__).resolve().parent / ".data"),
        help="Isolated persistence directory (defaults to ./.data)",
    )
    args = parser.parse_args()

    store = DataStore(Path(args.data_dir))
    hub = BridgeHub(store, bridge_port=args.port)
    if args.upstream:
        hub.config["tap"]["upstream_url"] = args.upstream
        store.save_config(hub.config)

    srv = run_http_server(hub, args.host, args.port)

    def _clean_exit(_sig=None, _frame=None) -> None:
        if hub.shutting_down:
            return
        hub.shutdown()
        try:
            srv.server_close()
        except Exception:
            pass
        print("\n[agent-bridge] stopped cleanly (0 orphan processes).", flush=True)
        os._exit(0)

    import os
    signal.signal(signal.SIGINT, _clean_exit)
    signal.signal(signal.SIGTERM, _clean_exit)

    print(
        f"\n[agent-bridge] UI & Proxy  : http://{args.host}:{args.port}/\n"
        f"[agent-bridge] TTY Wrapper : python3 cli.py --wrap <agent> (e.g. pi, omp, hermes, codewhale; Ctrl+C x2 exits cleanly)\n"
        f"[agent-bridge] Isolated DB : {store.data_dir}\n",
        flush=True,
    )
    try:
        srv.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        _clean_exit()


if __name__ == "__main__":
    main()
