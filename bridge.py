#!/usr/bin/env python3
"""
Agent Bridge — Modular Bespoke Cockpit Entrypoint.
All runtime configs, sessions, and SQLite telemetry stay strictly inside ./.data/.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from backend.agents import BridgeHub
from backend.http_server import run_http_server
from backend.store import DataStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Agent Bridge Modular Server")
    parser.add_argument("--host", default="0.0.0.0")
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

    print(
        f"\n[agent-bridge] listening on http://{args.host}:{args.port}/\n"
        f"[agent-bridge] cli attach  : python3 cli.py --url http://127.0.0.1:{args.port}\n"
        f"[agent-bridge] isolated db : {store.data_dir}\n",
        flush=True,
    )
    run_http_server(hub, args.host, args.port)


if __name__ == "__main__":
    main()
