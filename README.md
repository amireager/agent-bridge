# agent-bridge

Lightweight, zero-dependency local wire listener (`/v1`), prose-only Persian $\leftrightarrow$ English translator, Markdown workspace, and per-model/per-agent KV-cache & token ledger.

## Core Design Principles

1. **Do One Thing Well (Listener + Translator, Not Process Manager)**:
   - Sits transparently between any CLI coding agent (`pi`, `opencode`, custom agents) and your local `llama-server` (`http://127.0.0.1:18080/v1` $\rightarrow$ `http://127.0.0.1:8080/v1`).
   - Never mutates agent sampling/context parameters and never touches code blocks during translation.
2. **Two-Stage Verified Prompt Composer + Persian Guardrail**:
   - Write in Persian $\rightarrow$ preview & edit the translated English prompt $\rightarrow$ automatic guardrail blocks accidental untranslated Persian text unless explicitly confirmed via checkbox (e.g., intentional Persian folder names).
3. **Pro Markdown & Dismissable English**:
   - Full offline CommonMark/GFM rendering (tables, lists, headings, syntax-highlighted code blocks with 1-click Copy).
   - Hide original English globally or per-message to keep the workspace clean.
4. **Strict `./.data/` Isolation**:
   - Zero files written to `~` or `~/.config`. All SQLite telemetry (`WAL`), session logs, and settings stay inside `./.data/` with configurable retention (`1d` / `7d` / `30d` / `forever`).

## Quick Start

```bash
# 1. Start translation server (e.g., online shielded :18091, bergamot :18092, or plamo :18093)
python3 ../translate-kit/server-online.py --port 18091

# 2. Start agent-bridge
python3 bridge.py --host 127.0.0.1 --port 18080 --upstream http://127.0.0.1:8080

# 3. Point your CLI agent at http://127.0.0.1:18080/v1 (or attach native CLI client)
python3 cli.py --url http://127.0.0.1:18080
```

## Architecture

```text
agent-bridge/
├── bridge.py                  # Server entrypoint
├── cli.py                     # Native terminal client synced with Web UI (Zellij-style)
├── backend/
│   ├── store.py               # ./.data/ isolation, SQLite WAL ledger, retention pruning
│   ├── engine.py              # Passive upstream /metrics & KV volume estimator
│   ├── agents.py              # Multi-agent session tree & passive /v1 turn recorder
│   ├── translator.py          # Prose-only translation with fenced/inline code shield
│   └── http_server.py         # HTTP/SSE API + transparent /v1 wire tap
└── frontend/
    ├── index.html
    ├── styles/                # Hacker Dark monochrome CSS tokens + Markdown typography
    ├── core/                  # State router, offline GFM Markdown renderer, SVG icons
    └── pages/
        ├── chat/              # Chat HUD, collapsible Think/Tool traces, Guardrail composer
        ├── usage/             # Per-model & per-agent KV cache / token / cost analytics
        └── settings/          # Translation, HUD, /v1 tap, and retention settings
```
