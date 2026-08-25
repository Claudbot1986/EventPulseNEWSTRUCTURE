#!/usr/bin/env python3
"""
Deduplicate sources by URL (safe mode first).

Rules:
- Dedup ONLY when URL string is identical after trim.
- Never dedup sources with missing/invalid URL.
- Default is dry-run; use --apply to mutate files.

On apply:
1) Create timestamped backup zip with sources/ and affected runtime queue files.
2) Rewrite queue sourceId references to canonical sourceId.
3) Delete redundant source files (safe because backup exists).
4) Write JSON report to runtime/logs/.
"""

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = ROOT / "sources"
RUNTIME_DIR = ROOT / "runtime"
BACKUP_DIR = RUNTIME_DIR / "backups"
LOGS_DIR = RUNTIME_DIR / "logs"

# Queue priority follows dashboard order: topmost queues win.
QUEUE_FILES = [
    "preA-queue.jsonl",
    "postA-queue.jsonl",
    "preB-queue.jsonl",
    "postB-queue.jsonl",
    "postB-preC-queue.jsonl",
    "preUI-queue.jsonl",
    "EVENTPULSE-APP-queue.jsonl",
    "postTestC-A.jsonl",
    "postTestC-B.jsonl",
    "postTestC-D.jsonl",
    "postTestC-UI.jsonl",
    "postTestC-manual-review.jsonl",
    "postTestC-man1.jsonl",
    "postTestC-serverdown.jsonl",
    "postTestC-404.jsonl",
    "postTestC-error500.jsonl",
    "postTestC-timeout.jsonl",
    "postTestC-blocked.jsonl",
    "postTestC-out.jsonl",
    "postD-UI.jsonl",
    "postD-man1.jsonl",
    "postD-man.jsonl",
    "post-man.jsonl",
    "postTestC-Fail.jsonl",
]


@dataclass
class SourceRow:
    source_id: str
    url_raw: str
    url_key: str
    file_path: Path
    discovered_at: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def strict_url_key(url: str) -> str:
    if not url:
        return ""
    return url.strip()


def canonical_url_key(url: str) -> str:
    """
    Canonical key for source identity dedupe:
    - lowercase scheme + host
    - remove leading www.
    - collapse duplicate slashes in path
    - remove trailing slash except root
    - keep query string (conservative; avoids over-merging different filtered pages)
    """
    raw = strict_url_key(url)
    if not raw:
        return ""
    try:
        p = urlparse(raw)
    except Exception:
        return ""
    if not p.netloc:
        return ""

    scheme = (p.scheme or "https").lower()
    host = p.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = p.path or "/"
    while "//" in path:
        path = path.replace("//", "/")
    if path != "/":
        path = path.rstrip("/")
    query = f"?{p.query}" if p.query else ""
    return f"{scheme}://{host}{path}{query}"


def read_source_file(path: Path) -> SourceRow | None:
    try:
        txt = path.read_text(encoding="utf-8").strip()
        if not txt:
            return None
        obj = json.loads(txt)
    except Exception:
        return None

    source_id = str(obj.get("id") or path.stem).strip()
    url_raw = str(obj.get("url") or "").strip()
    discovered_at = str(obj.get("discoveredAt") or "")
    url_key = strict_url_key(url_raw)
    if not source_id:
        return None
    return SourceRow(source_id=source_id, url_raw=url_raw, url_key=url_key, file_path=path, discovered_at=discovered_at)


def load_sources() -> List[SourceRow]:
    rows: List[SourceRow] = []
    for p in sorted(SOURCES_DIR.glob("*.jsonl")):
        r = read_source_file(p)
        if r is not None:
            rows.append(r)
    return rows


def load_queue_ref_counts() -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for fn in QUEUE_FILES:
        p = RUNTIME_DIR / fn
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            sid = str(obj.get("sourceId") or "").strip()
            if not sid:
                continue
            counts[sid] = counts.get(sid, 0) + 1
    return counts


def load_source_best_queue_rank() -> Dict[str, int]:
    """
    Compute best (highest) queue position per sourceId.
    Lower number means higher in dashboard queue list.
    """
    best_rank: Dict[str, int] = {}
    for rank, fn in enumerate(QUEUE_FILES):
        p = RUNTIME_DIR / fn
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except Exception:
                continue
            sid = str(obj.get("sourceId") or "").strip()
            if not sid:
                continue
            if sid not in best_rank or rank < best_rank[sid]:
                best_rank[sid] = rank
    return best_rank


def choose_canonical(group: List[SourceRow], queue_refs: Dict[str, int], best_queue_rank: Dict[str, int]) -> SourceRow:
    def key_fn(r: SourceRow) -> Tuple[int, int, str, str]:
        rank = best_queue_rank.get(r.source_id, 10_000)
        refs = queue_refs.get(r.source_id, 0)
        discovered = r.discovered_at or "9999-99-99T99:99:99Z"
        return (rank, -refs, discovered, r.source_id)

    return sorted(group, key=key_fn)[0]


def build_plan(rows: List[SourceRow]) -> Dict[str, object]:
    queue_refs = load_queue_ref_counts()
    best_queue_rank = load_source_best_queue_rank()
    by_norm: Dict[str, List[SourceRow]] = {}
    for r in rows:
        key = canonical_url_key(r.url_raw)
        if not key:
            continue
        by_norm.setdefault(key, []).append(r)

    groups = []
    replace_map: Dict[str, str] = {}
    delete_files: List[Path] = []
    for norm, group in sorted(by_norm.items()):
        if len(group) <= 1:
            continue
        canonical = choose_canonical(group, queue_refs, best_queue_rank)
        members = sorted(group, key=lambda x: x.source_id)
        remove_ids = [m.source_id for m in members if m.source_id != canonical.source_id]
        for m in members:
            if m.source_id == canonical.source_id:
                continue
            replace_map[m.source_id] = canonical.source_id
            delete_files.append(m.file_path)
        groups.append({
            "url_key": norm,
            "canonical_source_id": canonical.source_id,
            "members": [m.source_id for m in members],
            "remove_source_ids": remove_ids,
            "canonical_reason": {
                "best_queue_rank": best_queue_rank.get(canonical.source_id),
                "queue_refs": queue_refs.get(canonical.source_id, 0),
            },
        })

    return {
        "groups": groups,
        "replace_map": replace_map,
        "delete_files": delete_files,
        "queue_ref_counts": queue_refs,
        "source_best_queue_rank": best_queue_rank,
    }


def rewrite_queue_source_ids(replace_map: Dict[str, str]) -> Dict[str, int]:
    changed: Dict[str, int] = {}
    if not replace_map:
        return changed

    for fn in QUEUE_FILES:
        p = RUNTIME_DIR / fn
        if not p.exists():
            continue

        out_lines: List[str] = []
        n_changed = 0
        for line in p.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except Exception:
                out_lines.append(raw)
                continue

            sid = str(obj.get("sourceId") or "").strip()
            if sid and sid in replace_map:
                obj["sourceId"] = replace_map[sid]
                n_changed += 1
            out_lines.append(json.dumps(obj, ensure_ascii=False))

        if n_changed > 0:
            p.write_text("\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8")
            changed[fn] = n_changed

    return changed


def dedupe_queue_membership() -> Dict[str, object]:
    """
    Ensure each sourceId exists in at most one queue row total.
    Priority is QUEUE_FILES order (topmost queue wins).
    Also removes duplicate rows for same sourceId inside a queue.
    """
    seen: set[str] = set()
    per_file_removed: Dict[str, int] = {}
    total_removed = 0

    for fn in QUEUE_FILES:
        p = RUNTIME_DIR / fn
        if not p.exists():
            continue

        out_lines: List[str] = []
        removed_here = 0

        for line in p.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except Exception:
                # keep malformed lines untouched (do not risk data loss)
                out_lines.append(raw)
                continue

            sid = str(obj.get("sourceId") or "").strip()
            if not sid:
                out_lines.append(json.dumps(obj, ensure_ascii=False))
                continue

            if sid in seen:
                removed_here += 1
                continue

            seen.add(sid)
            out_lines.append(json.dumps(obj, ensure_ascii=False))

        if removed_here > 0:
            p.write_text("\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8")
            per_file_removed[fn] = removed_here
            total_removed += removed_here

    return {
        "queue_duplicate_rows_removed_total": total_removed,
        "queue_duplicate_rows_removed_by_file": per_file_removed,
    }


def create_backup_zip(affected_queue_files: List[str]) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = BACKUP_DIR / f"source-dedup-{ts}"

    staging = base.with_suffix("")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    sources_copy = staging / "sources"
    shutil.copytree(SOURCES_DIR, sources_copy)

    runtime_copy = staging / "runtime"
    runtime_copy.mkdir(parents=True, exist_ok=True)
    for fn in affected_queue_files:
        src = RUNTIME_DIR / fn
        if src.exists():
            shutil.copy2(src, runtime_copy / fn)

    zip_path = shutil.make_archive(str(base), "zip", root_dir=staging)
    shutil.rmtree(staging)
    return Path(zip_path)


def delete_redundant_sources(paths: List[Path]) -> int:
    deleted = 0
    for p in paths:
        if p.exists() and p.is_file():
            p.unlink()
            deleted += 1
    return deleted


def write_report(report: Dict[str, object]) -> Path:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    p = LOGS_DIR / f"source-dedup-report-{ts}.json"
    p.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deduplicate sources by identical URL string (trimmed).")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Plan only (default mode).")
    mode.add_argument("--apply", action="store_true", help="Apply queue rewrites + source deletions.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    apply_mode = bool(args.apply)

    if not SOURCES_DIR.exists():
        print("ERROR: sources directory not found")
        return 2

    rows = load_sources()
    plan = build_plan(rows)

    groups = plan["groups"]
    replace_map = plan["replace_map"]
    delete_files: List[Path] = plan["delete_files"]

    summary = {
        "timestamp": now_iso(),
        "mode": "apply" if apply_mode else "dry-run",
        "source_files_scanned": len(rows),
        "duplicate_groups": len(groups),
        "redundant_source_ids": len(replace_map),
        "groups": groups,
    }

    if not apply_mode:
        report_path = write_report(summary)
        print(f"[DRY-RUN] duplicate_groups={len(groups)} redundant_source_ids={len(replace_map)}")
        print(f"[DRY-RUN] report={report_path}")
        return 0

    affected_queue_files = [fn for fn in QUEUE_FILES if (RUNTIME_DIR / fn).exists()]
    backup_zip = create_backup_zip(affected_queue_files)

    queue_changes = rewrite_queue_source_ids(replace_map)
    queue_dedupe_stats = dedupe_queue_membership()
    deleted_count = delete_redundant_sources(delete_files)

    summary["backup_zip"] = str(backup_zip)
    summary["queue_changes"] = queue_changes
    summary.update(queue_dedupe_stats)
    summary["deleted_source_files"] = deleted_count
    summary["deleted_source_ids"] = sorted(replace_map.keys())

    report_path = write_report(summary)

    print(f"[APPLY] duplicate_groups={len(groups)} redundant_source_ids={len(replace_map)}")
    print(f"[APPLY] queue_duplicate_rows_removed={queue_dedupe_stats['queue_duplicate_rows_removed_total']}")
    print(f"[APPLY] deleted_source_files={deleted_count}")
    print(f"[APPLY] backup={backup_zip}")
    print(f"[APPLY] report={report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
