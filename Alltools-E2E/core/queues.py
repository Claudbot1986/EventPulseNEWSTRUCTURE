from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def queue_file(runtime_dir: Path, queue_name: str) -> Path:
    return runtime_dir / "queues" / f"{queue_name}.jsonl"


def write_queue(runtime_dir: Path, queue_name: str, rows: Iterable[dict]) -> None:
    p = queue_file(runtime_dir, queue_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(r, ensure_ascii=False) for r in rows]
    p.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def append_queue(runtime_dir: Path, queue_name: str, row: dict) -> None:
    p = queue_file(runtime_dir, queue_name)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def read_queue(runtime_dir: Path, queue_name: str) -> list[dict]:
    p = queue_file(runtime_dir, queue_name)
    if not p.exists():
        return []
    out: list[dict] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            out.append(json.loads(raw))
        except Exception:
            continue
    return out
