#!/usr/bin/env python3
"""
Dual-Channel Hub:
1) Wire-Driven Live Terminal Mirrors (`pi`, `pi-2`, `hermes`, ...) — zero fake web sessions;
   100% synchronized with whatever session is active in each open terminal!
2) Built-in Direct Model & Tool Lab (`lab`) — web-native multi-turn model/translation/KV-slot
   tester & extensible local tool workbench (foundation for `agent-team`).
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import threading
import time
import urllib.request
import uuid
from pathlib import Path

from .engine import estimate_kv_mb_for_tokens, probe_upstream_passive
from .store import DataStore
from .translator import (
    LOOPBACK_OPENER,
    estimate_persian_token_savings,
    probe_translator_health,
    split_markdown_into_blocks,
    translate_prose,
)

THINK_TAG_RE = re.compile(r"<think>([\s\S]*?)</think>", re.IGNORECASE)


def _extract_msg_text(content) -> str:
    if isinstance(content, list):
        return "\n".join(
            str(x.get("text", ""))
            for x in content
            if isinstance(x, dict) and x.get("type") == "text"
        )
    return str(content or "")


class BridgeHub:
    def __init__(self, store: DataStore, bridge_port: int) -> None:
        self.store = store
        self.bridge_port = bridge_port
        self.config = self.store.load_config()
        self.glossary = self.store.load_glossary()
        self.shutting_down = False

        if self.config.get("retention", {}).get("auto_prune_on_boot", True):
            self.store.prune_expired()

        self._lock = threading.Lock()
        self._sse_clients: list[queue.Queue] = []
        self._inspector_ring: list[dict] = []
        # Translator endpoints are remembered only for this process after an explicit successful health/translation test.
        self.tested_translators: list[dict] = []

        # 1. Live Terminal Mirrors (keyed by agent_id: 'pi', 'pi-2', 'hermes', ...)
        self.mirrors: dict[str, dict] = {}
        self.pty_heartbeats: dict[str, float] = {}
        self.pending_fa_by_agent: dict[str, dict] = {}
        self.pending_saved_by_agent: dict[str, int] = {}

        # 2. Built-in Direct Model & Tool Lab sessions
        self.lab_sessions: dict[str, dict] = {}
        self.lab_abort_flag = False
        # Lab tools are jailed to a dedicated project workspace, never the Bridge repo/root.
        self.lab_workspace = (self.store.data_dir.parent / "agent-team").resolve()
        self.lab_workspace.mkdir(parents=True, exist_ok=True)
        workspace_readme = self.lab_workspace / "README.md"
        if not workspace_readme.exists():
            workspace_readme.write_text(
                "# agent-team workspace\n\nA separate sandbox for gradually built local agents. Lab file tools are restricted here.\n",
                encoding="utf-8",
            )

        # Active view target: ("mirror", "pi") or ("lab", "<session_id>")
        self.view_kind: str = "mirror"
        self.view_id: str = ""
        self.session_state: str = "IDLE"

        self.usage_window_hours: int = 24
        self.usage_model_filter: str = "all"
        self.usage_agent_filter: str = "all"

        self._load_state()

    def shutdown(self) -> None:
        """Wakes all SSE streams and stops cleanly on Ctrl+C with zero tracebacks."""
        self.shutting_down = True
        self.lab_abort_flag = True
        with self._lock:
            for q in self._sse_clients:
                try:
                    q.put_nowait(None)
                except queue.Full:
                    pass
            self._sse_clients.clear()

    def _load_state(self) -> None:
        for p in sorted(self.store.mirrors_dir.glob("*.json")):
            try:
                m = json.loads(p.read_text(encoding="utf-8"))
                if m.get("agent_id"):
                    self.mirrors[m["agent_id"]] = m
            except Exception:
                pass

        lab_dir = self.store.sessions_dir / "lab"
        lab_dir.mkdir(parents=True, exist_ok=True)
        for p in sorted(lab_dir.glob("*.json")):
            try:
                s = json.loads(p.read_text(encoding="utf-8"))
                if s.get("id"):
                    self.lab_sessions[s["id"]] = s
            except Exception:
                pass


    def _new_mirror_obj(self, agent_id: str) -> dict:
        return {
            "agent_id": agent_id,
            "title": "در انتظار اولین پیام ترمینال...",
            "conv_fp": "",
            "updated_at": time.time(),
            "turns": [],
        }

    def _persist_mirror(self, mirror: dict) -> None:
        mirror["updated_at"] = time.time()
        safe = re.sub(r"[^a-zA-Z0-9_.-]", "-", mirror["agent_id"]) or "agent"
        p = self.store.mirrors_dir / f"{safe}.json"
        p.write_text(json.dumps(mirror, ensure_ascii=False, indent=2), encoding="utf-8")

    def _make_lab_session(self, title: str) -> dict:
        sid = time.strftime("%m%d-%H%M-") + uuid.uuid4().hex[:4]
        now = time.time()
        return {
            "id": sid,
            "title": title,
            "created_at": now,
            "updated_at": now,
            "turns": [],
        }

    def _persist_lab_session(self, sess: dict) -> None:
        sess["updated_at"] = time.time()
        lab_dir = self.store.sessions_dir / "lab"
        lab_dir.mkdir(parents=True, exist_ok=True)
        (lab_dir / f"{sess['id']}.json").write_text(
            json.dumps(sess, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # ---- PTY Multi-Terminal Registration ----
    def register_pty(self, desired_base: str = "pi", explicit_name: str = "") -> str:
        now = time.time()
        base = re.sub(r"[^a-zA-Z0-9_.-]", "-", explicit_name or desired_base) or "pi"
        # Every live PTY gets an exclusive channel lease. Even duplicate explicit names
        # are suffixed so one terminal can never unregister another terminal's heartbeat.
        chosen = base
        if (now - self.pty_heartbeats.get(chosen, 0.0)) <= 25.0:
            idx = 2
            while (now - self.pty_heartbeats.get(f"{base}-{idx}", 0.0)) <= 25.0:
                idx += 1
            chosen = f"{base}-{idx}"

        self.pty_heartbeats[chosen] = now
        if chosen not in self.mirrors:
            self.mirrors[chosen] = self._new_mirror_obj(chosen)
            self._persist_mirror(self.mirrors[chosen])
        self.view_kind = "mirror"
        self.view_id = chosen
        self.broadcast_state()
        return chosen

    def heartbeat_pty(self, agent_id: str) -> None:
        self.pty_heartbeats[agent_id] = time.time()
        if agent_id not in self.mirrors:
            self.mirrors[agent_id] = self._new_mirror_obj(agent_id)

    def unregister_pty(self, agent_id: str) -> None:
        self.pty_heartbeats.pop(agent_id, None)
        self.broadcast_state()

    def delete_mirror(self, agent_id: str) -> bool:
        """Explicitly remove an offline terminal history; active channels cannot be deleted."""
        if time.time() - self.pty_heartbeats.get(agent_id, 0.0) <= 25.0:
            return False
        self.mirrors.pop(agent_id, None)
        safe = re.sub(r"[^a-zA-Z0-9_.-]", "-", agent_id) or "agent"
        try:
            (self.store.mirrors_dir / f"{safe}.json").unlink(missing_ok=True)
        except OSError:
            pass
        self.broadcast_state()
        return True

    def rename_lab_session(self, session_id: str, title: str) -> bool:
        sess = self.lab_sessions.get(session_id)
        clean = " ".join(str(title or "").split())[:64]
        if not sess or not clean:
            return False
        sess["title"] = clean
        self._persist_lab_session(sess)
        self.broadcast_state()
        return True

    # ---- View & Lab Session Controls ----
    def select_view(self, kind: str, target_id: str) -> None:
        if kind == "mirror":
            if target_id not in self.mirrors:
                self.mirrors[target_id] = self._new_mirror_obj(target_id)
            self.view_kind = "mirror"
            self.view_id = target_id
        elif kind == "lab" and target_id in self.lab_sessions:
            self.view_kind = "lab"
            self.view_id = target_id
        self.broadcast_state()

    def clear_mirror_view(self, agent_id: str) -> None:
        if agent_id in self.mirrors:
            self.mirrors[agent_id] = self._new_mirror_obj(agent_id)
            self._persist_mirror(self.mirrors[agent_id])
            self.broadcast_state()

    def cleanup_preview(self, days: int, scopes: list[str]) -> dict:
        cutoff = 0.0 if int(days) <= 0 else time.time() - int(days) * 86400.0
        items = []
        base = self.store.data_dir
        for scope, folder in (("lab", self.store.sessions_dir / "lab"), ("mirrors", self.store.mirrors_dir)):
            if scope not in scopes:
                continue
            for path in folder.glob("*.json"):
                if scope == "mirrors":
                    try:
                        doc = json.loads(path.read_text(encoding="utf-8"))
                        aid = str(doc.get("agent_id", path.stem))
                        if time.time() - self.pty_heartbeats.get(aid, 0.0) <= 25.0:
                            continue
                    except Exception:
                        pass
                try:
                    if cutoff == 0 or path.stat().st_mtime < cutoff:
                        items.append({"scope": scope, "path": str(path.relative_to(base)), "bytes": path.stat().st_size})
                except OSError:
                    pass
        req_count = 0
        if "telemetry" in scopes:
            with self.store._db_lock:
                import sqlite3
                with sqlite3.connect(self.store.db_path) as conn:
                    req_count = int(conn.execute("SELECT COUNT(*) FROM llm_requests WHERE ts < ?", (cutoff or time.time()+1,)).fetchone()[0])
        return {"days": int(days), "scopes": scopes, "telemetry_requests": req_count, "files": items, "file_count": len(items), "bytes": sum(x["bytes"] for x in items)}

    def run_cleanup(self, days: int, scopes: list[str]) -> dict:
        preview = self.cleanup_preview(days, scopes)
        cutoff = 0.0 if int(days) <= 0 else time.time() - int(days) * 86400.0
        deleted_requests = 0
        db_size_before = self.store.db_path.stat().st_size if self.store.db_path.exists() else 0
        if "telemetry" in scopes:
            with self.store._db_lock:
                import sqlite3
                with sqlite3.connect(self.store.db_path) as conn:
                    cur = conn.execute("DELETE FROM llm_requests WHERE ts < ?", (cutoff or time.time()+1,))
                    deleted_requests = cur.rowcount or 0
                    conn.commit()
                    conn.execute("VACUUM;")
        db_size_after = self.store.db_path.stat().st_size if self.store.db_path.exists() else 0
        freed_db_bytes = max(0, db_size_before - db_size_after) if "telemetry" in scopes else 0
        deleted_files = 0
        freed_file_bytes = 0
        deleted_lab_ids = []
        live_ids = {aid for aid, ts in self.pty_heartbeats.items() if time.time()-ts <= 25.0}
        for item in preview["files"]:
            path = self.store.data_dir / item["path"]
            try:
                if item["scope"] == "lab":
                    sid = path.stem
                    self.lab_sessions.pop(sid, None)
                    deleted_lab_ids.append(sid)
                elif item["scope"] == "mirrors":
                    aid = path.stem
                    if aid in live_ids:
                        continue
                    self.mirrors.pop(aid, None)
                item_bytes = path.stat().st_size if path.exists() else 0
                path.unlink(missing_ok=True)
                deleted_files += 1
                freed_file_bytes += item_bytes
            except OSError:
                pass
        if self.view_kind == "lab" and self.view_id not in self.lab_sessions:
            if self.lab_sessions:
                self.view_id = next(iter(self.lab_sessions))
            else:
                self.view_kind, self.view_id = "mirror", ""
        self.broadcast_state()
        return {"deleted_requests": deleted_requests, "deleted_files": deleted_files, "freed_bytes": freed_file_bytes + freed_db_bytes, "deleted_lab_sessions": len(deleted_lab_ids)}

    def clear_observed_history(self) -> dict:
        """Clear telemetry/X-Ray and mirror history; preserve only currently live PTY channels."""
        self.store.clear_telemetry()
        self._inspector_ring.clear()
        now = time.time()
        live_ids = {aid for aid, ts in self.pty_heartbeats.items() if now - ts <= 25.0}
        removed_channels = 0
        for aid in list(self.mirrors):
            if aid in live_ids:
                self.mirrors[aid] = self._new_mirror_obj(aid)
                self._persist_mirror(self.mirrors[aid])
            else:
                self.mirrors.pop(aid, None)
                safe = re.sub(r"[^a-zA-Z0-9_.-]", "-", aid) or "agent"
                p = self.store.mirrors_dir / f"{safe}.json"
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
                removed_channels += 1
        # Remove orphan/stale mirror files even if they were not loaded into memory.
        for p in self.store.mirrors_dir.glob("*.json"):
            try:
                content = json.loads(p.read_text(encoding="utf-8"))
                if content.get("agent_id") not in live_ids:
                    p.unlink(missing_ok=True)
            except Exception:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
        self.broadcast_state()
        return {"cleared": True, "removed_channels": removed_channels, "preserved_live_channels": len(live_ids)}

    def create_lab_session(self, title: str | None = None) -> dict:
        idx = len(self.lab_sessions) + 1
        s = self._make_lab_session(title or f"تست مستقیم #{idx}")
        self.lab_sessions[s["id"]] = s
        self._persist_lab_session(s)
        self.view_kind = "lab"
        self.view_id = s["id"]
        self.broadcast_state()
        return s

    def delete_lab_session(self, session_id: str) -> bool:
        if session_id not in self.lab_sessions:
            return False
        del self.lab_sessions[session_id]
        f = self.store.sessions_dir / "lab" / f"{session_id}.json"
        if f.exists():
            f.unlink()
        if self.view_kind == "lab" and self.view_id == session_id:
            if self.lab_sessions:
                self.view_id = next(iter(self.lab_sessions.keys()))
            else:
                self.view_kind, self.view_id = "mirror", ""
        self.broadcast_state()
        return True

    # ---- SSE Pub/Sub ----
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
        if self.shutting_down:
            return
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
            limit = max(1, min(200, int(self.config.get("ui", {}).get("xray_limit", 40))))
            if len(self._inspector_ring) > limit:
                self._inspector_ring = self._inspector_ring[-limit:]

    def consume_saved_tokens(self, agent_name: str) -> int:
        return self.pending_saved_by_agent.pop(agent_name, 0)

    def _translate_turn_fields(self, turn: dict) -> None:
        tr_on = self.config["translation"].get("enabled", True)
        raw_en = turn.get("reply_en", "").strip()
        if raw_en:
            if tr_on:
                tr_res = translate_prose(raw_en, "fa", self.config["translation"], self.glossary)
                turn["reply_fa"] = tr_res.get("translation", "")
                turn["blocks"] = tr_res.get("blocks") or split_markdown_into_blocks(raw_en)
                turn["tr_engine"] = tr_res.get("engine", "")
            else:
                turn["blocks"] = split_markdown_into_blocks(raw_en)
                turn["tr_engine"] = "proxy-only"

        raw_think = turn.get("thinking", "").strip()
        if raw_think and tr_on and self.config["ui"].get("translate_thinking", True):
            th_res = translate_prose(raw_think, "fa", self.config["translation"], self.glossary)
            turn["think_blocks"] = th_res.get("blocks") or split_markdown_into_blocks(raw_think)
            turn["thinking_fa"] = th_res.get("translation", "")
        elif raw_think:
            turn["think_blocks"] = split_markdown_into_blocks(raw_think)

    def retranslate_turn(self, turn_id: str, scope: str = "all", step_index: int = -1) -> bool:
        turns = self._active_turns_list()
        for t in turns:
            if t["id"] != turn_id:
                continue
            forced_cfg = {**self.config["translation"], "enabled": True}
            if scope in ("all", "reply") and t.get("reply_en"):
                r = translate_prose(t["reply_en"], "fa", forced_cfg, self.glossary)
                t["reply_fa"] = r.get("translation", "")
                t["blocks"] = r.get("blocks", [])
                t["tr_engine"] = r.get("engine", "")
            if scope in ("all", "think") and t.get("thinking"):
                rt = translate_prose(t["thinking"], "fa", forced_cfg, self.glossary)
                t["thinking_fa"] = rt.get("translation", "")
                t["think_blocks"] = rt.get("blocks", [])
            if scope == "step-think":
                steps = t.get("steps", [])
                if 0 <= step_index < len(steps) and steps[step_index].get("thinking"):
                    rt = translate_prose(steps[step_index]["thinking"], "fa", forced_cfg, self.glossary)
                    steps[step_index]["thinking_fa"] = rt.get("translation", "")
                    steps[step_index]["think_blocks"] = rt.get("blocks", [])
            self._persist_active_container()
            self.broadcast_state()
            return True
        return False

    def _active_turns_list(self) -> list[dict]:
        if self.view_kind == "lab":
            return self.lab_sessions.get(self.view_id, {}).get("turns", [])
        return self.mirrors.get(self.view_id, {}).get("turns", [])

    def _persist_active_container(self) -> None:
        if self.view_kind == "lab" and self.view_id in self.lab_sessions:
            self._persist_lab_session(self.lab_sessions[self.view_id])
        elif self.view_kind == "mirror" and self.view_id in self.mirrors:
            self._persist_mirror(self.mirrors[self.view_id])

    # ---- Wire-Driven Live Terminal Mirror Sync ----
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
        # Internal Direct Lab manages its own turns directly
        if agent_name.startswith("lab-"):
            return

        first_user_txt = ""
        last_user_txt = ""
        tool_outputs_by_id: dict[str, str] = {}

        for m in messages:
            role = m.get("role")
            c_str = _extract_msg_text(m.get("content", "")).strip()
            if role == "user" and c_str:
                if not first_user_txt:
                    first_user_txt = c_str
                last_user_txt = c_str
            elif role == "tool":
                tcid = m.get("tool_call_id", "")
                if tcid:
                    tool_outputs_by_id[tcid] = _extract_msg_text(m.get("content", ""))

        clean_reply = raw_reply
        extracted_think = reasoning_text or ""
        m_th = THINK_TAG_RE.search(clean_reply)
        if m_th:
            extracted_think = (extracted_think + "\n" + m_th.group(1)).strip()
            clean_reply = THINK_TAG_RE.sub("", clean_reply).strip()

        if not clean_reply.strip() and not tool_calls and not extracted_think.strip():
            return

        mirror = self.mirrors.setdefault(agent_name, self._new_mirror_obj(agent_name))

        # Auto-detect terminal session switch (/new or /resume inside terminal `pi`!)
        conv_fp = hashlib.sha1(first_user_txt.encode("utf-8")).hexdigest()[:12] if first_user_txt else "init"
        if mirror.get("conv_fp") and mirror["conv_fp"] != conv_fp:
            mirror["turns"] = []
        mirror["conv_fp"] = conv_fp
        if first_user_txt:
            mirror["title"] = first_user_txt.replace("\n", " ")[:36]

        # Stitch multi-step agent loop (assistant -> tool -> assistant) onto the same turn
        existing_turn = mirror["turns"][-1] if mirror["turns"] else None
        is_continuation = (
            existing_turn is not None
            and last_user_txt
            and existing_turn.get("prompt_sent", "").strip() == last_user_txt
        )

        if is_continuation and existing_turn is not None:
            step = {
                "index": len(existing_turn.setdefault("steps", [])) + 1,
                "thinking": extracted_think,
                "tools": list(tool_calls),
                "reply_en": clean_reply,
                "status": "tools" if tool_calls else "final",
            }
            existing_turn["steps"].append(step)
            for tl in existing_turn.get("tools", []):
                if tl["id"] in tool_outputs_by_id and not tl.get("output"):
                    tl["output"] = tool_outputs_by_id[tl["id"]]
                    tl["status"] = "done"
            for new_tc in tool_calls:
                existing_turn["tools"].append(new_tc)
            if extracted_think:
                existing_turn["thinking"] = (
                    (existing_turn.get("thinking", "") + "\n\n" + extracted_think).strip()
                    if existing_turn.get("thinking")
                    else extracted_think
                )
            if clean_reply.strip():
                existing_turn["reply_en"] = (
                    (existing_turn.get("reply_en", "") + "\n\n" + clean_reply).strip()
                    if existing_turn.get("reply_en")
                    else clean_reply
                )
            self._translate_turn_fields(existing_turn)

            em = existing_turn.setdefault("metrics", {"uncached_in": 0, "cached_in": 0, "out_tok": 0, "tg_tps": 0.0})
            em["uncached_in"] += metrics.get("uncached_in", 0)
            em["cached_in"] = max(em.get("cached_in", 0), metrics.get("cached_in", 0))
            em["out_tok"] += metrics.get("out_tok", 0)
            if metrics.get("tg_tps"):
                em["tg_tps"] = metrics["tg_tps"]
            existing_turn["kv_status"] = kv_status
            existing_turn["elapsed_s"] = round(existing_turn.get("elapsed_s", 0.0) + elapsed_s, 1)
            self._persist_mirror(mirror)
            return

        # Pair Persian draft if injected from Web UI moments ago
        user_display = last_user_txt
        saved_tok = 0
        pend = self.pending_fa_by_agent.get(agent_name)
        if pend and (time.time() - pend["ts"] < 45.0):
            if pend["en"].strip()[:40] in last_user_txt:
                user_display = pend["fa"]
                saved_tok = pend["saved"]
                self.pending_fa_by_agent.pop(agent_name, None)

        turn = {
            "id": uuid.uuid4().hex[:8],
            "agent": agent_name,
            "model": model_name,
            "source": "tty",
            "ts": time.strftime("%H:%M:%S"),
            "user_raw": user_display,
            "prompt_sent": last_user_txt,
            "saved_fa_tokens": saved_tok,
            "kv_status": kv_status,
            "thinking": extracted_think,
            "thinking_fa": "",
            "think_blocks": [],
            "steps": [{"index": 1, "thinking": extracted_think, "tools": list(tool_calls), "reply_en": clean_reply, "status": "tools" if tool_calls else "final"}],
            "tools": tool_calls,
            "reply_en": clean_reply,
            "reply_fa": "",
            "blocks": [],
            "tr_engine": "",
            "status": "done",
            "elapsed_s": round(elapsed_s, 1),
            "metrics": metrics,
        }
        self._translate_turn_fields(turn)
        mirror["turns"].append(turn)
        self._persist_mirror(mirror)

        # Auto-focus mirror if user is watching mirrors
        if self.view_kind == "mirror" and self.view_id not in self.mirrors:
            self.view_id = agent_name

    # ---- Built-in Direct Lab & Safe Local Tool Workbench ----
    def _lab_tools_schema(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "list_files",
                    "description": "List files and directories inside the target path.",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": {"type": "string", "description": "Relative or absolute directory path"}},
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read up to 160 lines of a UTF-8 text file.",
                    "parameters": {
                        "type": "object",
                        "properties": {"path": {"type": "string"}},
                        "required": ["path"],
                    },
                },
            },
        ]

    def _lab_safe_path(self, value: str) -> Path:
        """Resolve a Lab path and reject absolute paths, traversal, and symlink escapes."""
        raw = Path(value or ".")
        if raw.is_absolute():
            raise PermissionError("Lab file tools accept workspace-relative paths only.")
        root = self.lab_workspace.resolve()
        target = (root / raw).resolve()
        if target != root and root not in target.parents:
            raise PermissionError("Path escapes the isolated agent-team workspace.")
        return target

    def _exec_lab_tool(self, name: str, args: dict) -> tuple[str, bool]:
        """Read-only starter tools, jailed to ./agent-team; no shell or repo access."""
        try:
            if name == "list_files":
                target = self._lab_safe_path(str(args.get("path", ".") or "."))
                if not target.is_dir():
                    return "Not a directory.", True
                entries = sorted(p.name + ("/" if p.is_dir() else "") for p in target.iterdir())[:80]
                return "\\n".join(entries) or "(empty directory)", False
            if name == "read_file":
                target = self._lab_safe_path(str(args.get("path", "")))
                if not target.is_file():
                    return "Not a regular file.", True
                if target.stat().st_size > 128 * 1024:
                    return "File exceeds the 128 KiB Lab read limit.", True
                lines = target.read_text(encoding="utf-8", errors="replace").splitlines()[:160]
                return "\\n".join(f"{i+1}: {ln}" for i, ln in enumerate(lines)), False
            return f"Tool not enabled in the starter Lab: {name}", True
        except Exception as exc:
            return f"Tool error: {exc}", True

    def _run_lab_turn_thread(self, sess: dict, turn: dict) -> None:
        self.session_state = "THINKING"
        self.lab_abort_flag = False
        self.broadcast_state()

        custom_prompt = self.config["tap"].get("lab_system_prompt", "").strip()
        sys_prompt = (
            "You are the starter agent-team workspace assistant. Work only inside the dedicated "
            "agent-team workspace. The only available tools are read-only list_files and read_file; "
            "there is no shell, write, or access to the Agent Bridge repository or other folders. "
            "Do not pretend that files were changed. Build capabilities incrementally only when asked.\n\n"
            + custom_prompt
        )
        use_tools = bool(self.config["tap"].get("lab_enable_tools", True))

        # Build clean OpenAI conversation history so KV prefix stays 100% static across turns!
        api_msgs: list[dict] = []
        if sys_prompt:
            api_msgs.append({"role": "system", "content": sys_prompt})
        for prev in sess["turns"]:
            if prev["id"] == turn["id"]:
                break
            if prev.get("prompt_sent"):
                api_msgs.append({"role": "user", "content": prev["prompt_sent"]})
            if prev.get("reply_en"):
                api_msgs.append({"role": "assistant", "content": prev["reply_en"]})
        api_msgs.append({"role": "user", "content": turn["prompt_sent"]})

        agent_tag = f"lab-{sess['id'][-4:]}"
        t_start = time.perf_counter()

        try:
            for _step in range(5):
                if self.lab_abort_flag or self.shutting_down:
                    break
                payload: dict = {
                    "model": turn["model"],
                    "messages": api_msgs,
                    "stream": True,
                }
                if use_tools:
                    payload["tools"] = self._lab_tools_schema()

                req = urllib.request.Request(
                    f"http://127.0.0.1:{self.bridge_port}/v1/chat/completions",
                    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer agent:{agent_tag}",
                    },
                    method="POST",
                )

                step_content: list[str] = []
                step_think: list[str] = []
                step_no = len(turn.setdefault("steps", [])) + 1
                step_record = {"index": step_no, "thinking": "", "tools": [], "reply_en": "", "status": "thinking"}
                turn["steps"].append(step_record)
                tool_map: dict[int, dict] = {}
                last_bcast = 0.0

                with LOOPBACK_OPENER.open(req, timeout=240) as resp:
                    for raw_ln in resp:
                        if self.lab_abort_flag or self.shutting_down:
                            break
                        ls = raw_ln.decode("utf-8", errors="replace").strip()
                        if not ls.startswith("data:") or ls[5:].strip() == "[DONE]":
                            continue
                        chunk = json.loads(ls[5:].strip())
                        if chunk.get("timings"):
                            tm = chunk["timings"]
                            turn["metrics"] = {
                                "uncached_in": int(tm.get("prompt_n", 0)),
                                "cached_in": int(tm.get("cache_n", 0)),
                                "out_tok": int(tm.get("predicted_n", 0)),
                                "pp_tps": round(float(tm.get("prompt_per_second", 0.0)), 1),
                                "tg_tps": round(float(tm.get("predicted_per_second", 0.0)), 1),
                            }
                        for ch in chunk.get("choices", []):
                            d = ch.get("delta", {})
                            if d.get("reasoning_content"):
                                step_think.append(d["reasoning_content"])
                                step_record["thinking"] = "".join(step_think)
                                turn["thinking"] = "\n\n".join(s.get("thinking", "") for s in turn["steps"] if s.get("thinking"))
                            if d.get("content"):
                                self.session_state = "STREAMING"
                                step_content.append(d["content"])
                                step_record["reply_en"] = "".join(step_content)
                                turn["reply_en"] = "".join(step_content)
                            for tcd in d.get("tool_calls", []) or []:
                                idx = int(tcd.get("index", 0))
                                ent = tool_map.setdefault(idx, {"id": "", "name": "", "args": ""})
                                if tcd.get("id"):
                                    ent["id"] = tcd["id"]
                                fn = tcd.get("function", {})
                                if fn.get("name"):
                                    ent["name"] += fn["name"]
                                if fn.get("arguments"):
                                    ent["args"] += fn["arguments"]

                        now_m = time.monotonic()
                        if now_m - last_bcast > 0.28:
                            last_bcast = now_m
                            self.broadcast_state()

                full_txt = "".join(step_content)
                m_th = THINK_TAG_RE.search(full_txt)
                if m_th:
                    step_record["thinking"] = (step_record.get("thinking", "") + "\n" + m_th.group(1)).strip()
                    turn["thinking"] = "\n\n".join(s.get("thinking", "") for s in turn["steps"] if s.get("thinking"))
                    full_txt = THINK_TAG_RE.sub("", full_txt).strip()
                    turn["reply_en"] = full_txt

                if not tool_map:
                    step_record["status"] = "final"
                    step_record["reply_en"] = full_txt or step_record.get("reply_en", "")
                    break
                step_record["status"] = "tools"

                # Execute requested Lab tools & continue loop
                self.session_state = "TOOL_EXEC"
                asst_tcs = []
                tool_msgs = []
                for idx in sorted(tool_map.keys()):
                    it = tool_map[idx]
                    tc_id = it["id"] or f"call_{uuid.uuid4().hex[:6]}"
                    try:
                        parsed_a = json.loads(it["args"]) if it["args"] else {}
                    except Exception:
                        parsed_a = {"raw": it["args"]}
                    t_rec = {
                        "id": tc_id,
                        "name": it["name"] or "tool",
                        "args": parsed_a,
                        "output": "",
                        "status": "running",
                        "is_error": False,
                    }
                    turn["tools"].append(t_rec)
                    step_record["tools"].append(t_rec)
                    self.broadcast_state()

                    out_str, is_err = self._exec_lab_tool(t_rec["name"], parsed_a if isinstance(parsed_a, dict) else {})
                    t_rec["output"] = out_str
                    t_rec["is_error"] = is_err
                    t_rec["status"] = "error" if is_err else "done"

                    asst_tcs.append(
                        {
                            "id": tc_id,
                            "type": "function",
                            "function": {"name": t_rec["name"], "arguments": json.dumps(parsed_a)},
                        }
                    )
                    tool_msgs.append({"role": "tool", "tool_call_id": tc_id, "content": out_str})

                api_msgs.append({"role": "assistant", "content": full_txt or None, "tool_calls": asst_tcs})
                api_msgs.extend(tool_msgs)
                self.broadcast_state()

            turn["elapsed_s"] = round(time.perf_counter() - t_start, 1)
            self.session_state = "TRANSLATING_OUT"
            self.broadcast_state()
            self._translate_turn_fields(turn)
            turn["status"] = "done"
        except Exception as exc:
            turn["reply_en"] = (turn.get("reply_en", "") + f"\n\n[Lab Error: {exc}]").strip()
            turn["blocks"] = split_markdown_into_blocks(turn["reply_en"])
            turn["status"] = "error"
        finally:
            self._persist_lab_session(sess)
            self.session_state = "IDLE"
            self.broadcast_state()

    # ---- Unified Prompt Dispatch ----
    def submit_prompt(self, user_raw: str, prompt_sent: str) -> dict:
        savings = estimate_persian_token_savings(user_raw, prompt_sent)

        # Case 1: Built-in Direct Model & Tool Lab
        if self.view_kind == "lab":
            sess = self.lab_sessions.get(self.view_id)
            if not sess:
                sess = self.create_lab_session((user_raw or "گفتگوی Lab").replace("\\n", " ")[:32])
            up = probe_upstream_passive(self.config["tap"]["upstream_url"])
            if not up["online"]:
                raise RuntimeError(
                    f"سرور مدل روی {self.config['tap']['upstream_url']} روشن نیست؛ ابتدا llama-server را اجرا کن."
                )
            if len(sess["turns"]) == 0 and user_raw.strip():
                sess["title"] = user_raw.strip().replace("\n", " ")[:30]

            agent_tag = f"lab-{sess['id'][-4:]}"
            self.pending_saved_by_agent[agent_tag] = savings["saved"]

            turn = {
                "id": uuid.uuid4().hex[:8],
                "agent": agent_tag,
                "model": up["detected_model"],
                "source": "lab",
                "ts": time.strftime("%H:%M:%S"),
                "user_raw": user_raw,
                "prompt_sent": prompt_sent,
                "saved_fa_tokens": savings["saved"],
                "kv_status": "warm",
                "thinking": "",
                "thinking_fa": "",
                "think_blocks": [],
                "steps": [],
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
            self._persist_lab_session(sess)
            threading.Thread(target=self._run_lab_turn_thread, args=(sess, turn), daemon=True).start()
            return {"dispatched": "lab", "turn_id": turn["id"]}

        # Case 2: Live Terminal Mirror (`pi`, `pi-2`, ...)
        target_agent = self.view_id
        pty_alive = (time.time() - self.pty_heartbeats.get(target_agent, 0.0)) < 25.0
        if not pty_alive:
            raise RuntimeError(
                f"ترمینال زنده برای «{target_agent}» متصل نیست (متن انگلیسی در کلیپ‌بورد کپی شد). برای تایپ خودکار در ترمینال بزن: python3 cli.py --wrap pi"
            )

        self.pending_saved_by_agent[target_agent] = savings["saved"]
        self.pending_fa_by_agent[target_agent] = {
            "fa": user_raw,
            "en": prompt_sent,
            "saved": savings["saved"],
            "ts": time.time(),
        }
        self.emit_event("pty_inject", {"agent_id": target_agent, "message": prompt_sent})
        return {"dispatched": "pty", "agent_id": target_agent, "saved_tokens": savings["saved"]}

    def abort_active(self) -> None:
        self.lab_abort_flag = True
        if self.view_kind == "mirror":
            self.emit_event("pty_abort", {"agent_id": self.view_id})
        self.session_state = "IDLE"
        self.broadcast_state()

    def mark_translator_tested(self, cfg: dict, result: dict) -> None:
        if not result.get("ok"):
            return
        mode = "online" if cfg.get("engine") in ("builtin-online", "online") else "offline"
        item = {"mode": mode, "label": result.get("engine", mode), "latency_ms": result.get("latency_ms", 0), "tested_at": time.strftime("%H:%M:%S")}
        self.tested_translators = [x for x in self.tested_translators if x.get("mode") != mode]
        self.tested_translators.append(item)

    def build_state_snapshot(self) -> dict:
        up = probe_upstream_passive(self.config["tap"]["upstream_url"])
        tr_ok = probe_translator_health(self.config["translation"])
        usage = self.store.query_usage(
            self.config["pricing"]["active_profile"],
            self.usage_window_hours,
            self.usage_model_filter,
            self.usage_agent_filter,
            int(self.config.get("ui", {}).get("recent_requests_limit", 10)),
        )

        for mrow in usage.get("by_model", []):
            mrow["est_kv_mb_q8"] = estimate_kv_mb_for_tokens(
                mrow["model"], mrow.get("peak_ctx", 0), "q8_0"
            )

        now = time.time()
        mirrors_list = []
        history_list = []
        for aid, m in sorted(self.mirrors.items()):
            item = {
                "agent_id": aid,
                "title": m.get("title") or aid,
                "turn_count": len(m.get("turns", [])),
                "pty_live": (now - self.pty_heartbeats.get(aid, 0.0)) < 25.0,
            }
            (mirrors_list if item["pty_live"] else history_list).append(item)

        lab_list = [
            {"id": s["id"], "title": s["title"], "turn_count": len(s.get("turns", []))}
            for s in sorted(self.lab_sessions.values(), key=lambda x: x.get("updated_at", 0), reverse=True)
        ]

        if self.view_kind == "lab":
            if self.view_id not in self.lab_sessions:
                if self.lab_sessions:
                    self.view_id = next(iter(self.lab_sessions.keys()))
                else:
                    self.view_kind, self.view_id = "mirror", ""
            active_conv = self.lab_sessions[self.view_id] if self.view_kind == "lab" else self._new_mirror_obj("")
        else:
            active_conv = self.mirrors.get(self.view_id) or self._new_mirror_obj(self.view_id)

        with self._lock:
            insp = list(self._inspector_ring)

        return {
            "config": self.config,
            "glossary": self.glossary,
            "session_state": self.session_state,
            "view_kind": self.view_kind,
            "view_id": self.view_id,
            "mirrors": mirrors_list,
            "mirror_history": history_list,
            "lab_sessions": lab_list,
            "active_conversation": active_conv,
            "upstream": up,
            "translator_online": tr_ok,
            "tested_translators": list(self.tested_translators),
            "bridge_port": self.bridge_port,
            "usage": usage,
            "inspector": insp,
            "storage": self.store.data_dir_stats(),
        }

    def broadcast_state(self) -> None:
        self.emit_event("state", {"state": self.build_state_snapshot()})
