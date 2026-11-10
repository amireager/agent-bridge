# agent-bridge

Smooth, zero-dependency local `/v1` KV-cache hunter proxy, **paragraph-interleaved** Persian $\leftrightarrow$ English prose translator (browser-extension style), and terminal companion for multiple interactive agent CLIs.

## Key Capabilities

1. **Immersive Paragraph-by-Paragraph Bilingual View (Zero Duplicate Code Blocks)**:
   - Fenced code blocks (` ``` `) are rendered **once** untouched with syntax highlighting.
   - Switch instantly between **Interleaved (`EN + FA` paragraph-by-paragraph)**, **Full-Page Clean Persian (`FA + Code`)**, or **Pure English (`Proxy-Only`)**.
2. **Pro KV-Cache Hunter & Categorized Token Ledger (Works With or Without Translation)**:
   - Toggle **Pure Proxy Mode** (`ترجمه خاموش`) anytime to use `agent-bridge` purely as a zero-overhead mid-path `/v1` KV-cache hunter (`Cached KV %`, `Uncached Input`, `Output`, `pp/tg` speeds, `KV FLUSH!` drop detector, and `O(1)` multiplication estimate of Persian-vs-English token savings).
3. **Real Interactive Agent TUIs in Terminal + Web Extraction**:
   - Launch supported agents through `python3 cli.py --wrap <agent>` (for example `pi`, `omp`, `hermes`, or `codewhale`). Supported adapters route inference through the selected Bridge model; other OpenAI-compatible CLIs receive the standard endpoint environment variables.
   - Prompts sent from the Web UI are typed into that terminal's real PTY and submitted with Enter; the agent remains in its own TUI and the Mirror records its actual model requests, streaming replies, reasoning, and tool calls.
   - Open the same command twice to get independent, automatically named channels (`pi`, `pi-2`, `omp`, `omp-2`, ...). A new launch gets a new mirror/history; `--name` is an optional override.
4. **Built-in Online + Standard API Offline Translation & Strict `./.data/` Isolation**:
   - Built-in online translator (`0` extra servers) + offline OpenAI (`/v1/chat/completions`) & REST (`/translate`) APIs; all state isolated inside `./.data/`.

## Code map and tests

See [the module map](docs/module-map-fa.md) for the responsibility of each source file and where to make changes. Run regression tests with:

```bash
python3 -m unittest discover -s tests -v
```

## Quick Start (NixOS Host + Sandboxed `pi`)

```bash
# Terminal 1 (Host `dev ai` shell): Start your base model on Vulkan1 GPU
llama-server -m ~/models/qwen3.5-4b-claude-3xmerge-heretic-q4_k_m.gguf \
  --device Vulkan1 -ngl 99 --jinja --metrics -ctk q8_0 -ctv q8_0 -c 32768 --port 8080

# Terminal 2 (Normal Host): Start Agent Bridge UI & /v1 Proxy
python3 bridge.py --host 127.0.0.1 --port 18080 --upstream http://127.0.0.1:8080

# Terminal 3 (inside the target project folder):
# Start the real interactive TUI and connect Web UI Send + live /v1 Mirror.
python3 /path/to/agent-bridge/cli.py --wrap pi

# Open the same command in another terminal; it is named pi-2 automatically.
# Other supported examples: --wrap omp, --wrap hermes, --wrap codewhale
```
