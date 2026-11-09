#!/usr/bin/env python3
"""Multi-Agent Session Tree, Passive Streaming /v1 Extractor, and PTY/RPC Dispatch."""

from __future__ import annotations

import json
import os
import queue
import re
import shlex
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from .engine import estimate_kv_mb_for_tokens, probe_upstream_passive
from .store import DataStore
from .translator import (
    estimate_persian_token_savings,
    probe_translator_health,
    split_markdown_into_blocks,
    translate_prose,
)

THINK_TAG_RE = re.compile(r"<think>([\s\S]*?)</think>", re.IGNORECASE)


class BridgeHub:
    """Listens between Agent and Model, translates paragraph-by-paragraph, and tracks KV cache."""

    def __init__(self, store: DataStore, bridge_port: int) -> None:
        self.store = store
        self.bridge_port = bridge_port
        self.config = self.store.load_config()
        self.glossary = self.store.load_glossary()

        if self.config.get("retention", {}).get("auto_prune_on_boot", True):
            self.store.prune_expired()

        self._lock = threading.Lock()
        self._sse_clients: list[queue.Queue] = []
        self._inspector_ring: list[dict] = []

        self.sessions_by_agent: dict[str, dict[str, dict]] = {}
        self.active_agent: str = "pi"
        self.active_session_by_agent: dict[str, str] = {}

        self.pi_proc: subprocess.Popen | None = None
        self.pi_session_bound: str | None = None
        self.sandbox_worker_seen_ts: float = 0.0
        self.pty_wrapper_seen_ts: float = 0.0
        self.pending_fa_draft: dict | None = None  # Pairs Web FA draft with PTY-injected prompt!
        self.pending_saved_tokens: int = 0

        self.session_state: str = "IDLE"
        self.current_turn: dict | None = None

        self.usage_window_hours: int = 24
        self.usage_model_filter: str = "all"
        self.usage_agent_filter: str = "all"

        self._load_all_sessions()

    def _agent_sess_dir(self, agent_id: str) -> Path:
        safe = re.sub(r"[^a-zA-Z0-9_.-]", "-", agent_id) or "agent"
        p = self.store.sessions_dir / safe
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _ensure_agent_bucket(self, agent_id: str) -> None:
        if agent_id not in self.sessions_by_agent:
            self.sessions_by_agent[agent_id] = {}
        if not self.sessions_by_agent[agent_id]:
            s = self._make_session_obj(agent_id, f"{agent_id} · #1")
            self.sessions_by_agent[agent_id][s["id"]] = s
            self._persist_session(s)
        if agent_id not in self.active_session_by_agent:
            latest = max(
                self.sessions_by_agent[agent_id].values(),
                key=lambda x: x.get("updated_at", 0),
            )
            self.active_session_by_agent[agent_id] = latest["id"]

    def _load_all_sessions(self) -> None:
        for sub in sorted(self.store.sessions_dir.iterdir()):
            if not sub.is_dir() or sub.name in ("pi-native", "native-jsonl"):
                continue
            aid = sub.name
            self.sessions_by_agent.setdefault(aid, {})
            for p in sorted(sub.glob("*.json")):
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                    data["agent_id"] = aid
                    # Backfill blocks if older session turn lacked blocks
                    for t in data.get("turns", []):
                        if "blocks" not in t and t.get("reply_en"):
                            blks = split_markdown_into_blocks(t["reply_en"])
                            if t.get("reply_fa") and len(blks) == 1 and blks[0]["type"] == "prose":
                                blks[0]["fa"] = t["reply_fa"]
                            t["blocks"] = blks
                    self.sessions_by_agent[aid][data["id"]] = data
                except Exception:
                    pass
            if self.sessions_by_agent[aid]:
                latest = max(
                    self.sessions_by_agent[aid].values(),
                    key=lambda x: x.get("updated_at", 0),
                )
                self.active_session_by_agent[aid] = latest["id"]

        self._ensure_agent_bucket("pi")
        if self.active_agent not in self.sessions_by_agent:
            self.active_agent = "pi"

    def _make_session_obj(self, agent_id: str, title: str) -> dict:
        sid = time.strftime("%m%d-%H%M-") + uuid.uuid4().hex[:4]
        now = time.time()
        return {
            "id": sid,
            "agent_id": agent_id,
            "title": title,
            "created_at": now,
            "updated_at": now,
            "turns": [],
        }

    def _persist_session(self, sess: dict) -> None:
        sess["updated_at"] = time.time()
        aid = sess.get("agent_id", "pi")
        p = self._agent_sess_dir(aid) / f"{sess['id']}.json"
        p.write_text(json.dumps(sess, ensure_ascii=False, indent=2), encoding="utf-8")

    def create_session(self, agent_id: str | None = None, title: str | None = None) -> dict:
        aid = agent_id or self.active_agent
        self._ensure_agent_bucket(aid)
        idx = len(self.sessions_by_agent[aid]) + 1
        sess = self._make_session_obj(aid, title or f"{aid} · #{idx}")
        self.sessions_by_agent[aid][sess["id"]] = sess
        self.active_agent = aid
        self.active_session_by_agent[aid] = sess["id"]
        self._persist_session(sess)

        if aid == "pi" and self.pi_proc and self.pi_proc.poll() is None and self.pi_proc.stdin:
            try:
                self.pi_proc.stdin.write((json.dumps({"type": "new_session"}) + "\n").encode("utf-8"))
                self.pi_proc.stdin.flush()
                self.pi_session_bound = sess["id"]
            except OSError:
                pass

        self.broadcast_state()
        return sess

    def select_agent_session(self, agent_id: str, session_id: str | None = None) -> dict | None:
        self._ensure_agent_bucket(agent_id)
        self.active_agent = agent_id
        if session_id and session_id in self.sessions_by_agent[agent_id]:
            self.active_session_by_agent[agent_id] = session_id
        sid = self.active_session_by_agent[agent_id]
        self.broadcast_state()
        return self.sessions_by_agent[agent_id].get(sid)

    def delete_session(self, agent_id: str, session_id: str) -> bool:
        bucket = self.sessions_by_agent.get(agent_id, {})
        if session_id not in bucket:
            return False
        del bucket[session_id]
        f = self._agent_sess_dir(agent_id) / f"{session_id}.json"
        if f.exists():
            f.unlink()
        self._ensure_agent_bucket(agent_id)
        if self.active_session_by_agent.get(agent_id) == session_id:
            self.active_session_by_agent[agent_id] = next(iter(self.sessions_by_agent[agent_id].keys()))
        self.broadcast_state()
        return True

    def subscribe_sse(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=256)
        with self._lock:
            self._sse_clients.append(q)
        return q

    def unsubscribe_sse(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._sse_clients:
                self._sse_clients.remove(q)

    def emit_event(self, kind: str, payload: dict) -> None:
        msg = json.dumps({"kind": kind, **payload}, ensure_ascii=False)
        with self._lock:
            dead = []
            for q in self._sse_clients:
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    dead.append(q)
            for q in dead:
                self._sse_clients.remove(q)

    def push_inspector(self, item: dict) -> None:
        with self._lock:
            self._inspector_ring.append(item)
            if len(self._inspector_ring) > 40:
                self._inspector_ring = self._inspector_ring[-40:]

    def consume_pending_saved_tokens(self) -> int:
        val = self.pending_saved_tokens
        self.pending_saved_tokens = 0
        return val

    def _translate_turn_blocks(self, turn: dict) -> None:
        raw_en = turn.get("reply_en", "").strip()
        if not raw_en:
            turn["blocks"] = []
            return
        if not self.config["translation"].get("enabled", True):
            turn["blocks"] = split_markdown_into_blocks(raw_en)
            turn["tr_engine"] = "proxy-only"
            return

        tr_res = translate_prose(raw_en, "fa", self.config["translation"], self.glossary)
        turn["reply_fa"] = tr_res.get("translation", "")
        turn["blocks"] = tr_res.get("blocks") or split_markdown_into_blocks(raw_en)
        turn["tr_engine"] = tr_res.get("engine", "")

    # ---- Full Passive /v1 Extractor (Works with real standalone `pi` TUI in Terminal!) ----
    def record_passive_wire_turn(
        self,
        *,
        agent_name: str,
        model_name: str,
        messages: list[dict],
        raw_reply: str,
        reasoning_text: str,
        tool_calls: list[dict],
        metrics: dict,
        kv_status: str,
        elapsed_s: float,
    ) -> None:
        if agent_name == "pi" and self.current_turn is not None:
            self.current_turn["model"] = model_name
            self.current_turn["kv_status"] = kv_status
            return

        # Extract latest user prompt and any tool results present in messages
        last_user_txt = ""
        tool_outputs_by_id: dict[str, str] = {}
        for m in messages:
            role = m.get("role")
            c = m.get("content", "")
            if isinstance(c, list):
                c_str = "\n".join(
                    x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text"
                )
            else:
                c_str = str(c or "")
            if role == "user" and c_str.strip():
                last_user_txt = c_str.strip()
            elif role == "tool":
                tcid = m.get("tool_call_id", "")
                if tcid:
                    tool_outputs_by_id[tcid] = c_str

        clean_reply = raw_reply
        extracted_think = reasoning_text or ""
        m_th = THINK_TAG_RE.search(clean_reply)
        if m_th:
            extracted_think = (extracted_think + "\n" + m_th.group(1)).strip()
            clean_reply = THINK_TAG_RE.sub("", clean_reply).strip()

        if not clean_reply.strip() and not tool_calls and not extracted_think.strip():
            return

        self._ensure_agent_bucket(agent_name)
        self.active_agent = agent_name
        sid = self.active_session_by_agent[agent_name]
        sess = self.sessions_by_agent[agent_name][sid]

        # Check if this /v1 call is a multi-step continuation of the last turn (e.g., after tool execution!)
        existing_turn = sess["turns"][-1] if sess["turns"] else None
        is_continuation = (
            existing_turn is not None
            and existing_turn.get("source") in ("tap", "pty")
            and last_user_txt
            and existing_turn.get("prompt_sent", "").strip() == last_user_txt
        )

        if is_continuation and existing_turn is not None:
            # Attach tool outputs from messages onto previous tool calls
            for tl in existing_turn.get("tools", []):
                if tl["id"] in tool_outputs_by_id and not tl.get("output"):
                    tl["output"] = tool_outputs_by_id[tl["id"]]
                    tl["status"] = "done"
            for new_tc in tool_calls:
                existing_turn["tools"].append(new_tc)
            if extracted_think:
                existing_turn["thinking"] = (
                    (existing_turn.get("thinking", "") + "\n" + extracted_think).strip()
                )
            if clean_reply.strip():
                existing_turn["reply_en"] = (
                    (existing_turn.get("reply_en", "") + "\n\n" + clean_reply).strip()
                    if existing_turn.get("reply_en")
                    else clean_reply
                )
                self._translate_turn_blocks(existing_turn)

            em = existing_turn.setdefault("metrics", {"uncached_in": 0, "cached_in": 0, "out_tok": 0, "tg_tps": 0.0})
            em["uncached_in"] += metrics.get("uncached_in", 0)
            em["cached_in"] += metrics.get("cached_in", 0)
            em["out_tok"] += metrics.get("out_tok", 0)
            if metrics.get("tg_tps"):
                em["tg_tps"] = metrics["tg_tps"]
            existing_turn["kv_status"] = kv_status
            existing_turn["elapsed_s"] = round(existing_turn.get("elapsed_s", 0.0) + elapsed_s, 1)
            self._persist_session(sess)
            self.emit_event("turn_complete", {"turn": existing_turn})
            return

        # Check if user submitted Persian draft via PTY injection seconds ago
        user_display = last_user_txt
        src_label = "tap"
        saved_tok = 0
        if self.pending_fa_draft and (time.time() - self.pending_fa_draft["ts"] < 30.0):
            if self.pending_fa_draft["en"].strip() in last_user_txt:
                user_display = self.pending_fa_draft["fa"]
                saved_tok = self.pending_fa_draft["saved"]
                src_label = "pty"
                self.pending_fa_draft = None

        if len(sess["turns"]) == 0 and user_display.strip():
            sess["title"] = user_display.strip().replace("\n", " ")[:28]

        turn = {
            "id": uuid.uuid4().hex[:8],
            "session_id": sid,
            "agent": agent_name,
            "model": model_name,
            "source": src_label,
            "ts": time.strftime("%H:%M:%S"),
            "started_ts": time.time() - elapsed_s,
            "user_raw": user_display,
            "prompt_sent": last_user_txt,
            "saved_fa_tokens": saved_tok,
            "kv_status": kv_status,
            "thinking": extracted_think,
            "tools": tool_calls,
            "reply_en": clean_reply,
            "reply_fa": "",
            "blocks": [],
            "tr_engine": "",
            "status": "done",
            "elapsed_s": round(elapsed_s, 1),
            "metrics": metrics,
        }
        self._translate_turn_blocks(turn)
        sess["turns"].append(turn)
        self._persist_session(sess)
        self.emit_event("turn_complete", {"turn": turn})

    # ---- RPC / Sandbox Worker / PTY Dispatch ----
    def _ensure_pi_sender(self, model_id: str) -> tuple[bool, str]:
        if self.pi_proc and self.pi_proc.poll() is None:
            return True, "running"

        raw_cmd = self.config["tap"]["pi_bin"].strip()
        cmd_parts = shlex.split(raw_cmd) if raw_cmd else ["pi"]
        exe = cmd_parts[0]
        if not (Path(exe).exists() or shutil.which(exe)):
            return (
                False,
                "عامل مستقیم به وب وصل نیست؛ داخل ترمینال سندباکس `python3 cli.py --wrap pi` را بزن تا ترمینال تعاملی واقعی pi باز شود و پیام‌ها مستقیم بدون کپی-پیست تایپ شوند (متن انگلیسی در کلیپ‌بوردت هم کپی شد).",
            )

        pi_dir = self.store.pi_agent_dir
        models_json = {
            "providers": {
                "local-tap": {
                    "baseUrl": f"http://127.0.0.1:{self.bridge_port}/v1",
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
                            "contextWindow": 16384,
                            "maxTokens": 2048,
                            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                        }
                    ],
                }
            }
        }
        (pi_dir / "models.json").write_text(json.dumps(models_json, indent=2), encoding="utf-8")
        (pi_dir / "settings.json").write_text(
            json.dumps({"defaultProvider": "local-tap", "defaultModel": model_id}, indent=2),
            encoding="utf-8",
        )

        workdir = Path(self.config["tap"]["workdir"]).expanduser()
        workdir.mkdir(parents=True, exist_ok=True)
        pi_sess_dir = self.store.sessions_dir / "pi-native"
        pi_sess_dir.mkdir(parents=True, exist_ok=True)

        env = os.environ.copy()
        env["PI_CODING_AGENT_DIR"] = str(pi_dir)
        env["PI_OFFLINE"] = "1"
        node_dir = "/var/tmp/lab/node/bin"
        if Path(node_dir).exists() and node_dir not in env.get("PATH", ""):
            env["PATH"] = f"{node_dir}:{env.get('PATH', '')}"

        self.pi_proc = subprocess.Popen(
            [*cmd_parts, "--mode", "rpc", "--session-dir", str(pi_sess_dir)],
            cwd=str(workdir),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        self.pi_session_bound = self.active_session_by_agent.get("pi")
        threading.Thread(target=self._read_pi_stdout, daemon=True).start()
        return True, "spawned"

    def ingest_pi_rpc_event(self, ev: dict, last_push_ref: list[float]) -> None:
        etype = ev.get("type", "")
        turn = self.current_turn

        if etype == "agent_start":
            self.session_state = "THINKING"
            self.broadcast_state()

        elif etype == "message_update" and turn is not None:
            ae = ev.get("assistantMessageEvent", {})
            atype = ae.get("type", "")
            if atype == "thinking_delta":
                self.session_state = "THINKING"
                delta = ae.get("delta", "")
                turn["thinking"] += delta
                self.emit_event("stream_delta", {"field": "thinking", "delta": delta})
            elif atype == "text_delta":
                self.session_state = "STREAMING"
                delta = ae.get("delta", "")
                turn["reply_en"] += delta
                self.emit_event("stream_delta", {"field": "reply_en", "delta": delta})
            now = time.monotonic()
            if now - last_push_ref[0] > 0.28:
                last_push_ref[0] = now
                self.broadcast_state()

        elif etype == "tool_execution_start" and turn is not None:
            self.session_state = "TOOL_EXEC"
            turn["tools"].append(
                {
                    "id": ev.get("toolCallId", uuid.uuid4().hex[:6]),
                    "name": ev.get("toolName", "tool"),
                    "args": ev.get("args", {}),
                    "output": "",
                    "status": "running",
                    "is_error": False,
                    "started_at": time.time(),
                    "duration_ms": 0,
                }
            )
            self.broadcast_state()

        elif etype == "tool_execution_end" and turn is not None:
            tc_id = ev.get("toolCallId")
            res = ev.get("result", {})
            txts = [c.get("text", "") for c in res.get("content", []) if isinstance(c, dict)]
            for tc in turn["tools"]:
                if tc["id"] == tc_id:
                    tc["output"] = "\n".join(txts)
                    tc["is_error"] = bool(ev.get("isError", False))
                    tc["status"] = "error" if tc["is_error"] else "done"
                    tc["duration_ms"] = int((time.time() - tc.get("started_at", time.time())) * 1000)
                    break
            self.session_state = "STREAMING"
            self.broadcast_state()

        elif etype == "agent_end":
            if turn is not None:
                if not turn["reply_en"].strip():
                    for m in reversed(ev.get("messages", [])):
                        if m.get("role") == "assistant":
                            c = m.get("content", "")
                            if isinstance(c, list):
                                turn["reply_en"] = "".join(
                                    blk.get("text", "") for blk in c if blk.get("type") == "text"
                                )
                            elif isinstance(c, str):
                                turn["reply_en"] = c
                            break

                turn["elapsed_s"] = round(time.time() - turn["started_ts"], 1)
                if turn["reply_en"].strip():
                    self.session_state = "TRANSLATING_OUT"
                    self.broadcast_state()
                    self._translate_turn_blocks(turn)

                turn["status"] = "done"
                sess = self.sessions_by_agent.get(turn["agent"], {}).get(turn["session_id"])
                if sess:
                    self._persist_session(sess)
                self.emit_event("turn_complete", {"turn": turn})

            self.current_turn = None
            self.session_state = "IDLE"
            self.broadcast_state()

    def _read_pi_stdout(self) -> None:
        proc = self.pi_proc
        if not proc or not proc.stdout:
            return
        last_push_ref = [0.0]
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            self.ingest_pi_rpc_event(ev, last_push_ref)

    def submit_prompt(
        self,
        user_raw: str,
        prompt_sent: str,
        source: str = "web",
        agent_id: str | None = None,
    ) -> dict:
        savings = estimate_persian_token_savings(user_raw, prompt_sent)
        self.pending_saved_tokens = savings["saved"]

        # Priority 1: Live Transparent PTY Wrapper (`cli.py --wrap pi` running real TUI in terminal!)
        if (time.time() - self.pty_wrapper_seen_ts) < 25.0:
            self.pending_fa_draft = {
                "fa": user_raw,
                "en": prompt_sent,
                "saved": savings["saved"],
                "ts": time.time(),
            }
            self.emit_event("pty_inject", {"message": prompt_sent})
            return {"dispatched": "pty", "saved_tokens": savings["saved"]}

        aid = agent_id or self.active_agent
        self._ensure_agent_bucket(aid)
        self.active_agent = aid
        sid = self.active_session_by_agent[aid]
        sess = self.sessions_by_agent[aid][sid]

        up = probe_upstream_passive(self.config["tap"]["upstream_url"])
        model_id = up["detected_model"] if up["online"] else "local-model"

        worker_alive = (time.time() - self.sandbox_worker_seen_ts) < 25.0
        if not worker_alive:
            ok, msg = self._ensure_pi_sender(model_id)
            if not ok or not self.pi_proc or not self.pi_proc.stdin:
                raise RuntimeError(msg)

            if self.pi_session_bound != sid:
                self.pi_proc.stdin.write((json.dumps({"type": "new_session"}) + "\n").encode("utf-8"))
                self.pi_proc.stdin.flush()
                self.pi_session_bound = sid

        if len(sess["turns"]) == 0:
            short = user_raw.strip().replace("\n", " ")[:28]
            if short:
                sess["title"] = short

        turn = {
            "id": uuid.uuid4().hex[:8],
            "session_id": sid,
            "agent": aid,
            "model": model_id,
            "source": source,
            "ts": time.strftime("%H:%M:%S"),
            "started_ts": time.time(),
            "user_raw": user_raw,
            "prompt_sent": prompt_sent,
            "saved_fa_tokens": savings["saved"],
            "kv_status": "warm",
            "thinking": "",
            "tools": [],
            "reply_en": "",
            "reply_fa": "",
            "blocks": [],
            "tr_engine": "",
            "status": "streaming",
            "elapsed_s": 0.0,
            "metrics": {"uncached_in": 0, "cached_in": 0, "out_tok": 0, "tg_tps": 0.0},
        }
        sess["turns"].append(turn)
        self.current_turn = turn
        self._persist_session(sess)

        is_busy = self.session_state in ("THINKING", "TOOL_EXEC", "STREAMING")
        cmd: dict = {"id": f"req-{turn['id']}", "type": "prompt", "message": prompt_sent}
        if is_busy:
            cmd["streamingBehavior"] = "followUp"

        self.emit_event("turn_started", {"turn": turn})
        if worker_alive:
            self.session_state = "THINKING"
            self.emit_event(
                "worker_prompt",
                {"turn_id": turn["id"], "message": prompt_sent, "model": model_id},
            )
        else:
            self.pi_proc.stdin.write((json.dumps(cmd, ensure_ascii=False) + "\n").encode("utf-8"))
            self.pi_proc.stdin.flush()
        self.broadcast_state()
        return turn

    def abort_agent(self) -> None:
        if self.pi_proc and self.pi_proc.poll() is None and self.pi_proc.stdin:
            self.pi_proc.stdin.write((json.dumps({"type": "abort"}) + "\n").encode("utf-8"))
            self.pi_proc.stdin.flush()
        self.session_state = "IDLE"
        self.broadcast_state()

    def build_state_snapshot(self) -> dict:
        up = probe_upstream_passive(self.config["tap"]["upstream_url"])
        tr_ok = probe_translator_health(self.config["translation"])
        usage = self.store.query_usage(
            self.config["pricing"]["active_profile"],
            self.usage_window_hours,
            self.usage_model_filter,
            self.usage_agent_filter,
        )

        for mrow in usage.get("by_model", []):
            mrow["est_kv_mb_q8"] = estimate_kv_mb_for_tokens(
                mrow["model"], mrow.get("peak_ctx", 0), "q8_0"
            )

        agent_tree = []
        for aid, bucket in sorted(self.sessions_by_agent.items()):
            s_list = sorted(bucket.values(), key=lambda s: s.get("updated_at", 0), reverse=True)
            agent_tree.append(
                {
                    "id": aid,
                    "label": aid,
                    "active_session_id": self.active_session_by_agent.get(aid),
                    "sessions": [
                        {
                            "id": s["id"],
                            "title": s["title"],
                            "turn_count": len(s.get("turns", [])),
                        }
                        for s in s_list
                    ],
                }
            )

        self._ensure_agent_bucket(self.active_agent)
        act_sid = self.active_session_by_agent[self.active_agent]
        active_sess = self.sessions_by_agent[self.active_agent][act_sid]

        with self._lock:
            insp = list(self._inspector_ring)

        pty_live = (time.time() - self.pty_wrapper_seen_ts) < 25.0
        worker_live = (time.time() - self.sandbox_worker_seen_ts) < 25.0

        return {
            "config": self.config,
            "glossary": self.glossary,
            "session_state": self.session_state,
            "pty_connected": pty_live,
            "worker_connected": worker_live,
            "active_agent": self.active_agent,
            "active_session": active_sess,
            "agent_tree": agent_tree,
            "upstream": up,
            "translator_online": tr_ok,
            "bridge_port": self.bridge_port,
            "usage": usage,
            "inspector": insp,
            "storage": self.store.data_dir_stats(),
        }

    def broadcast_state(self) -> None:
        self.emit_event("state", {"state": self.build_state_snapshot()})
