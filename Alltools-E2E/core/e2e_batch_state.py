"""Rota vilka källor Alltools-E2E (verktyg 17) tar — undvik att alltid köra samma 10."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

STATE_REL = Path("runtime") / "state" / "tool17-processed.json"


def _state_path(e2e_root: Path) -> Path:
    p = e2e_root / STATE_REL
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def catalog_fingerprint(sorted_ids: List[str]) -> str:
    return hashlib.sha256("|".join(sorted_ids).encode("utf-8")).hexdigest()


def load_state(e2e_root: Path) -> dict:
    p = _state_path(e2e_root)
    if not p.is_file():
        return {"processed": [], "fingerprint": ""}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"processed": [], "fingerprint": ""}


def save_state(e2e_root: Path, processed: List[str], fingerprint: str) -> None:
    p = _state_path(e2e_root)
    p.write_text(
        json.dumps({"processed": processed, "fingerprint": fingerprint}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )


def pick_next_batch(
    all_rows: List[Dict[str, Any]],
    limit: int,
    e2e_root: Path,
) -> Tuple[List[Dict[str, Any]], List[str], str, bool]:
    """
    Välj nästa batch som inte finns i processed.
    Returnerar: (batch, new_processed_list_efter_lyckad_körning, fingerprint, cycled).
    Om alla körts: nollställ processed och börja om (cycled=True).
    """
    sorted_ids = sorted({r["sourceId"] for r in all_rows})
    fp = catalog_fingerprint(sorted_ids)
    state = load_state(e2e_root)
    processed = list(state.get("processed", []))
    if state.get("fingerprint") != fp:
        processed = []
    pset = set(processed)
    fresh = [r for r in all_rows if r["sourceId"] not in pset]
    cycled = False
    if not fresh and all_rows:
        processed = []
        fresh = list(all_rows)
        cycled = True
    batch = fresh[:limit]
    new_processed = processed + [r["sourceId"] for r in batch]
    return batch, new_processed, fp, cycled
