# agent-bridge

Lightweight, zero-dependency local wire listener (`/v1`), **built-in** prose-only Persian $\leftrightarrow$ English translator, Markdown workspace, and per-model/per-agent KV-cache & token ledger.

## Core Design Principles

1. **Built-in Online Translation + Standard API Offline Modes**:
   - **Built-in Online (`0` extra servers needed)**: Works immediately upon running `python3 bridge.py` (`Google Chrome` $\rightarrow$ `Google GTX` $\rightarrow$ `MyMemory` fallback, `SOCKS5H`/`HTTP` proxy support via `curl`, code/path/flag shield, and `SHA-256` LRU cache).
   - **API-Driven Offline Modes**: Connect either to any OpenAI-compatible translation model (`POST /v1/chat/completions`, e.g., `llama-server` running `hy-mt2-1.8b` or `qwen3.5-0.8b`) or a lightweight REST server (`POST /translate`, e.g., `Bergamot` `:18092` / `PLaMo` `:18093`).
2. **Do One Thing Well (Listener + Translator, Not Process Manager)**:
   - Sits transparently between your CLI coding agent (`pi` inside a Bubblewrap sandbox, `opencode`, etc.) and `llama-server` (`http://127.0.0.1:18080/v1` $\rightarrow$ `http://127.0.0.1:8080/v1`), bypassing system `HTTP_PROXY`/`ALL_PROXY` on loopback automatically.
3. **Two-Stage Verified Prompt Composer + Persian Guardrail**:
   - Write in Persian $\rightarrow$ preview & edit the translated English prompt $\rightarrow$ automatic guardrail blocks accidental untranslated Persian text unless explicitly confirmed via checkbox.
4. **Strict `./.data/` Isolation**:
   - Zero files written to `~` or `~/.config`. All SQLite telemetry (`WAL`), session logs, and settings stay inside `./.data/` with configurable retention (`1d` / `7d` / `30d` / `forever`).

## Quick Start (NixOS Host + Sandboxed `pi`)

```bash
# Terminal 1 (Host `dev ai` shell): Start your base model on Vulkan1 GPU
llama-server -m ~/models/qwen3.5-4b-claude-3xmerge-heretic-q4_k_m.gguf \
  --device Vulkan1 -ngl 99 --jinja --metrics -ctk q8_0 -ctv q8_0 -c 32768 --port 8080

# Terminal 2 (Normal Host — NO sandbox needed for agent-bridge):
python3 bridge.py --host 127.0.0.1 --port 18080 --upstream http://127.0.0.1:8080

# Terminal 3 (Inside your Sandbox `dev agent` / `box` on target project folder):
python3 /path/to/agent-bridge/cli.py --pi-worker
```
