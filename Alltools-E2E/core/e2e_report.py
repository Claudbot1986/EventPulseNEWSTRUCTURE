"""Post-run report from real pipeline: scan project runtime + extractedevents (no simulation)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

from core.legacy_sync import QUEUE_FILES

EXTRACTED_REL = Path("03-Queue") / "03-extractedevents"


def _lines_in_file(path: Path) -> int:
    if not path.is_file():
        return 0
    n = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            n += 1
    return n


def _load_status_map(runtime: Path) -> Dict[str, dict]:
    p = runtime / "sources_status.jsonl"
    if not p.is_file():
        return {}
    m: Dict[str, dict] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            o = json.loads(raw)
            sid = str(o.get("sourceId") or "").strip()
            if sid:
                m[sid] = o
        except json.JSONDecodeError:
            continue
    return m


def find_queue_for_source(runtime: Path, source_id: str) -> Optional[str]:
    sid = str(source_id).strip()
    for qname, fname in QUEUE_FILES.items():
        path = runtime / fname
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw:
                continue
            try:
                o = json.loads(raw)
                if str(o.get("sourceId") or "").strip() == sid:
                    return qname
            except json.JSONDecodeError:
                continue
    return None


def infer_e2e_events_path(project_root: Path, sid: str, home: Optional[str]) -> str:
    """Derive dashboard path label from queue home + extracted file locations."""
    ext = project_root / EXTRACTED_REL
    d_file = ext / "D" / f"{sid}.jsonl"
    c_file = ext / "C" / f"{sid}.jsonl"
    root_file = ext / f"{sid}.jsonl"

    if _lines_in_file(d_file) > 0:
        return "render"
    if _lines_in_file(c_file) > 0:
        return "html"

    if _lines_in_file(root_file) > 0:
        if home == "postB":
            return "network"
        return "api"

    if home == "postA":
        return "api"
    if home == "postB":
        return "network"
    if home in ("postTestC-UI", "postTestC-man1", "preUI"):
        return "html"
    if home == "post10-UI":
        return "html"
    if home == "post10-man":
        return "pending"
    if home in ("postD-UI", "postD-man1", "postD-man"):
        return "render"
    if home in ("postB-preC", "postTestC-D", "preB", "preA"):
        return "pending"
    return "unset"


def events_found_for_source(project_root: Path, status_map: Dict[str, dict], source_id: str) -> int:
    sid = str(source_id).strip()
    st = status_map.get(sid)
    if st is not None:
        try:
            n = int(st.get("eventsFound") or 0)
            if n > 0:
                return n
        except (TypeError, ValueError):
            pass
    ext = project_root / EXTRACTED_REL
    total = 0
    for rel in (ext / f"{sid}.jsonl", ext / "C" / f"{sid}.jsonl", ext / "D" / f"{sid}.jsonl"):
        total += _lines_in_file(rel)
    return total


def build_batch_report(
    project_root: Path,
    batch_source_ids: List[str],
    *,
    run_id: str,
    timestamp: str,
    catalog_fingerprint: str,
    batch_mode: str,
    pipeline_notes: List[str],
    commands_run: List[List[str]],
) -> dict:
    runtime = project_root / "runtime"
    status_map = _load_status_map(runtime)
    per_source: List[dict] = []
    path_counts: Dict[str, int] = {}

    for sid in batch_source_ids:
        home = find_queue_for_source(runtime, sid)
        path = infer_e2e_events_path(project_root, sid, home)
        path_counts[path] = path_counts.get(path, 0) + 1
        ev = events_found_for_source(project_root, status_map, sid)
        per_source.append(
            {
                "sourceId": sid,
                "queueHome": home,
                "e2eEventsPath": path,
                "eventsFound": ev,
            }
        )

    return {
        "runId": run_id,
        "timestamp": timestamp,
        "pipeline": "real-abcd-typescript",
        "processed": len(batch_source_ids),
        "batchSourceIds": list(batch_source_ids),
        "catalogFingerprint": catalog_fingerprint,
        "batchMode": batch_mode,
        "stageNotes": pipeline_notes,
        "commandsRun": commands_run,
        "preUIE2eEventsPathCounts": dict(sorted(path_counts.items(), key=lambda x: x[0])),
        "perSource": per_source,
    }
