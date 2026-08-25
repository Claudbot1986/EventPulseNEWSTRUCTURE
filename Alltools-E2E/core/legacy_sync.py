"""
Apply E2E routing decisions to legacy runtime/ queue files (same layout as queue-mem.py).

E2E sandbox lists may contain the same sourceId in several queues (e.g. preA + preUI).
We pick the most downstream queue per source via QUEUE_PRIORITY, then:
  - remove that sourceId from every legacy queue
  - insert the winning row into the target legacy queue

Keep QUEUE_FILES in sync with queue-mem.py QUEUE_FILES.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

# Mirror queue-mem.py QUEUE_FILES (short queue name -> filename under runtime/)
QUEUE_FILES: Dict[str, str] = {
    "preA": "preA-queue.jsonl",
    "postA": "postA-queue.jsonl",
    "preB": "preB-queue.jsonl",
    "postB": "postB-queue.jsonl",
    "postB-preC": "postB-preC-queue.jsonl",
    "preUI": "preUI-queue.jsonl",
    "EVENTPULSE-APP": "EVENTPULSE-APP-queue.jsonl",
    "postTestC-A": "postTestC-A.jsonl",
    "postTestC-B": "postTestC-B.jsonl",
    "postTestC-D": "postTestC-D.jsonl",
    "postTestC-UI": "postTestC-UI.jsonl",
    "postTestC-man": "postTestC-manual-review.jsonl",
    "postTestC-man1": "postTestC-man1.jsonl",
    "postTestC-serverdown": "postTestC-serverdown.jsonl",
    "postTestC-404": "postTestC-404.jsonl",
    "postTestC-error500": "postTestC-error500.jsonl",
    "postTestC-timeout": "postTestC-timeout.jsonl",
    "postTestC-blocked": "postTestC-blocked.jsonl",
    "postTestC-out": "postTestC-out.jsonl",
    "post10-UI": "post10-UI.jsonl",
    "post10-man": "post10-man.jsonl",
    "postD-UI": "postD-UI.jsonl",
    "postD-man1": "postD-man1.jsonl",
    "postD-man": "postD-man.jsonl",
    "post-man": "post-man.jsonl",
    "postTestC-Fail": "postTestC-Fail.jsonl",
}

# Higher = final destination wins (same source may appear in postTestC-D and preUI after D-stage)
QUEUE_PRIORITY: Dict[str, int] = {
    "post-man": 100,
    "postD-man": 95,
    "preUI": 90,
    "post10-UI": 89,
    "post10-man": 88,
    "postTestC-man1": 85,
    "postTestC-D": 50,
    "postTestC-man": 45,
    "postB-preC": 25,
    "preB": 15,
    "preA": 5,
}


def _load_queue_entries(runtime: Path, qname: str) -> Dict[str, dict]:
    fname = QUEUE_FILES.get(qname)
    if not fname:
        return {}
    path = runtime / fname
    if not path.exists():
        return {}
    out: Dict[str, dict] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw:
                continue
            try:
                e = json.loads(raw)
                sid = e.get("sourceId")
                if sid:
                    out[str(sid)] = e
            except Exception:
                pass
    except Exception:
        pass
    return out


def _save_queue_entries(runtime: Path, qname: str, entries: Dict[str, dict]) -> None:
    fname = QUEUE_FILES.get(qname)
    if not fname:
        return
    path = runtime / fname
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: List[str] = []
    for e in entries.values():
        e = dict(e)
        e["queueName"] = qname
        e["queuedAt"] = datetime.utcnow().isoformat() + "Z"
        lines.append(json.dumps(e, ensure_ascii=False))
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def load_full_queues_state(runtime: Path) -> Dict[str, Dict[str, dict]]:
    return {qn: _load_queue_entries(runtime, qn) for qn in QUEUE_FILES}


def total_entries_in_state(queues_state: Dict[str, Dict[str, dict]]) -> int:
    return sum(len(d) for d in queues_state.values())


def audit_legacy_runtime(project_root: Path) -> dict:
    """
    Rå rad-räkning + global unikhet: varje sourceId förekommer högst en gång totalt,
    och högst en gång per fil.
    """
    runtime = project_root / "runtime"
    raw_total = 0
    sid_home: Dict[str, str] = {}
    errors: List[str] = []

    for qname, fname in QUEUE_FILES.items():
        path = runtime / fname
        if not path.exists():
            continue
        seen_in_file: set[str] = set()
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue
        for line in lines:
            raw = line.strip()
            if not raw:
                continue
            raw_total += 1
            try:
                e = json.loads(raw)
                sid = str(e.get("sourceId", "")).strip()
                if not sid:
                    continue
                if sid in seen_in_file:
                    errors.append(f"duplicate sourceId {sid} in file {qname} ({fname})")
                seen_in_file.add(sid)
                if sid in sid_home:
                    errors.append(
                        f"sourceId {sid} appears in both {sid_home[sid]} and {qname}"
                    )
                else:
                    sid_home[sid] = qname
            except Exception:
                pass

    return {
        "raw_total": raw_total,
        "unique_sources_in_queues": len(sid_home),
        "errors": errors,
        "sid_home": sid_home,
    }


def compute_legacy_sync(
    project_root: Path,
    output_queues: dict,
    source_ids: List[str],
) -> Tuple[Dict[str, Dict[str, dict]], set[str], List[dict]]:
    """Bygg ny kö-state i minnet utan att skriva disk."""
    runtime = project_root / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    placements = final_row_per_source(output_queues, source_ids)
    queues_state = load_full_queues_state(runtime)
    dirty: set[str] = set()
    moved: List[dict] = []

    for sid in source_ids:
        if sid not in placements:
            continue
        target_q, row = placements[sid]
        for qname, entries in queues_state.items():
            if sid in entries:
                entries.pop(sid)
                dirty.add(qname)
        new_e = dict(row)
        new_e["sourceId"] = sid
        new_e["queueName"] = target_q
        new_e["queueOrigin"] = target_q
        new_e["queuedAt"] = datetime.utcnow().isoformat() + "Z"
        queues_state[target_q][sid] = new_e
        dirty.add(target_q)
        moved.append({"sourceId": sid, "to": target_q})

    return queues_state, dirty, moved


def persist_legacy_queues(
    project_root: Path,
    queues_state: Dict[str, Dict[str, dict]],
    dirty: set[str],
) -> None:
    runtime = project_root / "runtime"
    for qname in dirty:
        _save_queue_entries(runtime, qname, queues_state[qname])


def final_row_per_source(
    output_queues: Dict[str, List[dict]],
    source_ids: List[str],
) -> Dict[str, Tuple[str, dict]]:
    result: Dict[str, Tuple[str, dict]] = {}
    for sid in source_ids:
        best_q: str | None = None
        best_row: dict | None = None
        best_pri = -1
        for qname, rows in output_queues.items():
            pri = QUEUE_PRIORITY.get(qname, -1)
            if pri < 0:
                continue
            for r in rows:
                if str(r.get("sourceId", "")) != sid:
                    continue
                if pri > best_pri:
                    best_pri = pri
                    best_q = qname
                    best_row = dict(r)
        if best_q and best_row is not None:
            result[sid] = (best_q, best_row)
    return result


def sync_e2e_outputs_to_legacy(project_root: Path, output_queues: dict, source_ids: List[str]) -> dict:
    """
    Update project runtime/*.jsonl so each processed sourceId appears in exactly one queue
    (the most downstream E2E bucket for that source).
    """
    queues_state, dirty, moved = compute_legacy_sync(project_root, output_queues, source_ids)
    persist_legacy_queues(project_root, queues_state, dirty)
    return {"synced": len(moved), "queues_touched": sorted(dirty), "moved": moved}
