#!/usr/bin/env python3
"""Backward-compatible launcher forwarding to bridge.py (isolating all state inside ./.data/)."""
from bridge import main

if __name__ == "__main__":
    main()
