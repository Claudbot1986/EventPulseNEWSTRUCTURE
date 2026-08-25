"""
Real E2E pipeline for Alltools-E2E: delegates to production TypeScript/Python runners.

Implemented flow:
  A -> B -> C -> D -> D-AI
  C-man -> Tool10(deep) -> post10-UI/post10-man -> Tool11 -> 500-AI -> Tool12

Batch isolation:
  Reorders input queues so current batch sourceIds are processed first.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence, Set, Tuple


RUNTIME_PREA = "preA-queue.jsonl"
RUNTIME_PREB = "preB-queue.jsonl"
RUNTIME_POSTB_PREC = "postB-preC-queue.jsonl"
RUNTIME_PREUI = "preUI-queue.jsonl"
RUNTIME_POSTTESTC_UI = "postTestC-UI.jsonl"
RUNTIME_POSTTESTC_MAN = "postTestC-manual-review.jsonl"
RUNTIME_POSTTESTC_MAN1 = "postTestC-man1.jsonl"
RUNTIME_POSTTESTC_D = "postTestC-D.jsonl"
RUNTIME_POSTTESTC_404 = "postTestC-404.jsonl"
RUNTIME_POSTTESTC_SERVERDOWN = "postTestC-serverdown.jsonl"
RUNTIME_POSTTESTC_ERROR500 = "postTestC-error500.jsonl"
RUNTIME_POST10_UI = "post10-UI.jsonl"
RUNTIME_POST10_MAN = "post10-man.jsonl"
RUNTIME_POSTD_UI = "postD-UI.jsonl"
RUNTIME_POSTD_MAN1 = "postD-man1.jsonl"
RUNTIME_POSTD_MAN = "postD-man.jsonl"


def _read_jsonl_objects(path: Path) -> List[dict]:
    if not path.is_file():
        return []
    out: List[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return out


def _write_jsonl(path: Path, rows: Sequence[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    if text:
        text += "\n"
    path.write_text(text, encoding="utf-8")


def reorder_queue_front(runtime: Path, filename: str, front_ids: Sequence[str]) -> int:
    """
    Move rows whose sourceId is in front_ids to the top (first occurrence order of front_ids),
    then append remaining rows in original relative order. Returns count of batch rows placed first.
    """
    path = runtime / filename
    objs = _read_jsonl_objects(path)
    if not objs or not front_ids:
        return 0

    front_unique: List[str] = []
    seen_f: Set[str] = set()
    for sid in front_ids:
        s = str(sid).strip()
        if s and s not in seen_f:
            front_unique.append(s)
            seen_f.add(s)

    by_sid_first: Dict[str, dict] = {}
    order_all: List[str] = []
    for o in objs:
        sid = str(o.get("sourceId") or "").strip()
        if not sid:
            continue
        if sid not in by_sid_first:
            by_sid_first[sid] = o
            order_all.append(sid)

    out: List[dict] = []
    moved = 0
    used: Set[str] = set()
    for sid in front_unique:
        if sid in by_sid_first:
            out.append(by_sid_first[sid])
            used.add(sid)
            moved += 1
    for sid in order_all:
        if sid not in used:
            out.append(by_sid_first[sid])
            used.add(sid)

    _write_jsonl(path, out)
    return moved


def count_queue_with_ids(runtime: Path, filename: str, id_set: Set[str]) -> int:
    n = 0
    for o in _read_jsonl_objects(runtime / filename):
        sid = str(o.get("sourceId") or "").strip()
        if sid in id_set:
            n += 1
    return n


def _sid_of(row: dict) -> str:
    return str(row.get("sourceId") or "").strip()


def _set_queue_name(row: dict, qname: str) -> dict:
    out = dict(row)
    out["queueName"] = qname
    out["queueOrigin"] = qname
    return out


def _split_rows_by_ids(rows: Sequence[dict], id_set: Set[str]) -> Tuple[List[dict], List[dict]]:
    selected: List[dict] = []
    other: List[dict] = []
    seen: Set[str] = set()
    for r in rows:
        sid = _sid_of(r)
        if sid and sid in id_set and sid not in seen:
            selected.append(r)
            seen.add(sid)
        else:
            other.append(r)
    return selected, other


def _remove_ids_from_queue(runtime: Path, filename: str, id_set: Set[str]) -> Dict[str, dict]:
    path = runtime / filename
    rows = _read_jsonl_objects(path)
    kept: List[dict] = []
    popped: Dict[str, dict] = {}
    for r in rows:
        sid = _sid_of(r)
        if sid and sid in id_set and sid not in popped:
            popped[sid] = r
        else:
            kept.append(r)
    _write_jsonl(path, kept)
    return popped


def _append_unique_by_source(runtime: Path, filename: str, rows: Sequence[dict]) -> int:
    path = runtime / filename
    existing = _read_jsonl_objects(path)
    seen: Set[str] = set()
    for r in existing:
        sid = _sid_of(r)
        if sid:
            seen.add(sid)
    added = 0
    for r in rows:
        sid = _sid_of(r)
        if not sid or sid in seen:
            continue
        existing.append(r)
        seen.add(sid)
        added += 1
    _write_jsonl(path, existing)
    return added


def _relabel_queue_name_for_ids(runtime: Path, filename: str, ids: Set[str], new_queue_name: str) -> int:
    """Update queueName/queueOrigin for matching sourceIds in-place."""
    path = runtime / filename
    rows = _read_jsonl_objects(path)
    changed = 0
    for i, r in enumerate(rows):
        sid = _sid_of(r)
        if sid and sid in ids:
            rows[i] = _set_queue_name(r, new_queue_name)
            changed += 1
    _write_jsonl(path, rows)
    return changed


def _move_selected_ids(
    runtime: Path,
    src_file: str,
    dst_file: str,
    ids: Set[str],
    *,
    dst_queue_name: str | None = None,
) -> int:
    src_path = runtime / src_file
    dst_path = runtime / dst_file
    src_rows = _read_jsonl_objects(src_path)
    dst_rows = _read_jsonl_objects(dst_path)
    selected, remaining = _split_rows_by_ids(src_rows, ids)

    dst_seen = {_sid_of(r) for r in dst_rows if _sid_of(r)}
    for r in selected:
        sid = _sid_of(r)
        if not sid or sid in dst_seen:
            continue
        row = _set_queue_name(r, dst_queue_name) if dst_queue_name else dict(r)
        dst_rows.append(row)
        dst_seen.add(sid)

    _write_jsonl(src_path, remaining)
    _write_jsonl(dst_path, dst_rows)
    return len(selected)


def _isolate_queue_and_run(
    project_root: Path,
    runtime: Path,
    input_file: str,
    selected_ids: Set[str],
    command: List[str],
    *,
    dry_run: bool,
) -> int:
    p = runtime / input_file
    original = _read_jsonl_objects(p)
    selected, non_selected = _split_rows_by_ids(original, selected_ids)
    _write_jsonl(p, selected)
    if dry_run:
        print(f"[E2E-real] DRY isolate {input_file}: {len(selected)} row(s)")
        _write_jsonl(p, original)
        return 0
    rc = subprocess.run(command, cwd=str(project_root)).returncode
    residual = _read_jsonl_objects(p)
    _write_jsonl(p, non_selected + residual)
    return rc


def run_npx_tsx(
    project_root: Path,
    script_rel: str,
    args: List[str],
    *,
    dry_run: bool,
) -> Tuple[int, List[str]]:
    cmd = ["npx", "--yes", "tsx", script_rel, *args]
    flat = " ".join(cmd)
    if dry_run:
        print(f"[E2E-real] DRY: would run: {flat}")
        return 0, cmd
    print(f"[E2E-real] → {flat}")
    rc = subprocess.run(cmd, cwd=str(project_root)).returncode
    return rc, cmd


@dataclass
class RealPipelineResult:
    exit_code: int
    commands_run: List[List[str]]
    stage_notes: List[str]


def run_real_abcd(
    project_root: Path,
    batch_ids: Sequence[str],
    *,
    data_root: Path | None = None,
    workers_a: int = 24,
    workers_b: int = 8,
    workers_c: int = 5,
    workers_d: int = 4,
    run_recovery: bool = False,
    include_extended_stages: bool = True,
    dry_run: bool = False,
) -> RealPipelineResult:
    """Run real tools on data_root/runtime while executing code from project_root."""
    runtime = (data_root or project_root) / "runtime"
    id_list = [str(x).strip() for x in batch_ids if str(x).strip()]
    bset = set(id_list)
    cmds: List[List[str]] = []
    notes: List[str] = []

    n = len(id_list)
    if n == 0:
        return RealPipelineResult(0, [], ["empty batch"])

    reorder_queue_front(runtime, RUNTIME_PREA, id_list)
    notes.append(f"reordered {RUNTIME_PREA} for batch ({n} ids)")

    rc, c1 = run_npx_tsx(
        project_root,
        "02-Ingestion/A-directAPI-networkGate/runA.ts",
        ["--limit", str(n), "--workers", str(workers_a)],
        dry_run=dry_run,
    )
    cmds.append(c1)
    if rc != 0:
        return RealPipelineResult(rc, cmds, notes + [f"runA failed exit={rc}"])
    notes.append("runA done")

    reorder_queue_front(runtime, RUNTIME_PREB, id_list)
    n_preb = count_queue_with_ids(runtime, RUNTIME_PREB, bset)
    if n_preb > 0:
        rc, c2 = run_npx_tsx(
            project_root,
            "02-Ingestion/B-JSON-feedGate/runB-parallel.ts",
            ["--limit", str(n_preb), "--workers", str(workers_b)],
            dry_run=dry_run,
        )
        cmds.append(c2)
        if rc != 0:
            return RealPipelineResult(rc, cmds, notes + [f"runB failed exit={rc}"])
        notes.append(f"runB done (limit={n_preb})")
    else:
        notes.append("runB skipped (no batch rows in preB)")

    reorder_queue_front(runtime, RUNTIME_POSTB_PREC, id_list)
    n_prec = count_queue_with_ids(runtime, RUNTIME_POSTB_PREC, bset)
    if n_prec > 0:
        rc, c3 = run_npx_tsx(
            project_root,
            "02-Ingestion/C-htmlGate/runC-one-time-only.ts",
            ["--workers", str(workers_c)],
            dry_run=dry_run,
        )
        cmds.append(c3)
        if rc != 0:
            return RealPipelineResult(rc, cmds, notes + [f"runC failed exit={rc}"])
        notes.append("runC-one-time-only done")
        # Canonicalize C-stage outputs to match target diagram:
        # - L should be postTestC-UI (some paths still emit preUI)
        # - manual-review file should carry queueName postTestC-man
        moved_ui = _move_selected_ids(
            runtime,
            RUNTIME_PREUI,
            RUNTIME_POSTTESTC_UI,
            bset,
            dst_queue_name="postTestC-UI",
        )
        relabeled_man = _relabel_queue_name_for_ids(
            runtime,
            RUNTIME_POSTTESTC_MAN,
            bset,
            "postTestC-man",
        )
        notes.append(
            f"canonicalized C outputs (preUI->postTestC-UI moved={moved_ui}, postTestC-man relabeled={relabeled_man})"
        )
    else:
        notes.append("runC skipped (no batch rows in postB-preC)")

    # D branch from C output
    reorder_queue_front(runtime, RUNTIME_POSTTESTC_D, id_list)
    n_d = count_queue_with_ids(runtime, RUNTIME_POSTTESTC_D, bset)
    if n_d > 0:
        rc, c4 = run_npx_tsx(
            project_root,
            "02-Ingestion/D-renderGate/runD-scrapingbee.ts",
            [f"--limit={n_d}", f"--workers={workers_d}"],
            dry_run=dry_run,
        )
        cmds.append(c4)
        if rc != 0:
            return RealPipelineResult(rc, cmds, notes + [f"runD failed exit={rc}"])
        notes.append(f"runD done (limit={n_d})")
    else:
        notes.append("runD skipped (no batch rows in postTestC-D)")

    if not include_extended_stages:
        notes.append("extended stages skipped by caller")
        return RealPipelineResult(0, cmds, notes)

    # Tool 15 on postD-man for this batch
    reorder_queue_front(runtime, RUNTIME_POSTD_MAN, id_list)
    n_d_man = count_queue_with_ids(runtime, RUNTIME_POSTD_MAN, bset)
    if n_d_man > 0:
        rc, c5 = run_npx_tsx(
            project_root,
            "02-Ingestion/D-renderGate/runD-ai-scrapingbee.ts",
            ["--input=postD-man.jsonl", f"--limit={n_d_man}", f"--workers={workers_d}"],
            dry_run=dry_run,
        )
        cmds.append(c5)
        if rc != 0:
            return RealPipelineResult(rc, cmds, notes + [f"runD-ai failed exit={rc}"])
        notes.append(f"runD-ai done (limit={n_d_man})")
        # Canonicalize Tool15 outputs to target chain:
        # >=2 events -> postD-UI, 1 event -> postD-man1, 0/fail -> postD-man.
        # Tool15 already writes these queues, but we normalize queueName and
        # migrate any legacy preUI leftovers for the active batch.
        moved_legacy_ui = _move_selected_ids(
            runtime,
            RUNTIME_PREUI,
            RUNTIME_POSTD_UI,
            bset,
            dst_queue_name="postD-UI",
        )
        relabel_d_ui = _relabel_queue_name_for_ids(runtime, RUNTIME_POSTD_UI, bset, "postD-UI")
        relabel_d_man1 = _relabel_queue_name_for_ids(runtime, RUNTIME_POSTD_MAN1, bset, "postD-man1")
        relabel_d_man = _relabel_queue_name_for_ids(runtime, RUNTIME_POSTD_MAN, bset, "postD-man")
        notes.append(
            "tool15 canonicalized "
            f"(legacy preUI->postD-UI moved={moved_legacy_ui}, "
            f"postD-UI relabeled={relabel_d_ui}, "
            f"postD-man1 relabeled={relabel_d_man1}, "
            f"postD-man relabeled={relabel_d_man})"
        )
    else:
        notes.append("runD-ai skipped (no batch rows in postD-man)")

    # Tool 10 branch: input is postTestC-man, but tool10 reads postB-preC.
    n_t10_in = _move_selected_ids(
        runtime,
        RUNTIME_POSTTESTC_MAN,
        RUNTIME_POSTB_PREC,
        bset,
        dst_queue_name="postB-preC",
    )
    if n_t10_in > 0:
        # Ensure Tool10 consumes this batch first even if queue already had older rows.
        reorder_queue_front(runtime, RUNTIME_POSTB_PREC, id_list)
        rc, c6 = run_npx_tsx(
            project_root,
            "02-Ingestion/C-htmlGate/runC-scrapingbee.ts",
            ["--mode=deep", "--limit", str(n_t10_in), "--workers", str(workers_c)],
            dry_run=dry_run,
        )
        cmds.append(c6)
        if rc != 0:
            # Best-effort rollback for untouched/misrouted rows from this move.
            _move_selected_ids(
                runtime,
                RUNTIME_POSTB_PREC,
                RUNTIME_POSTTESTC_MAN,
                bset,
                dst_queue_name="postTestC-man",
            )
            return RealPipelineResult(rc, cmds, notes + [f"tool10 deep failed exit={rc}"])
        notes.append(f"tool10 deep done (from postTestC-man, limit={n_t10_in})")

        # classify tool10 results for batch ids:
        # L: landed in postTestC-UI (or preUI fallback) -> move to post10-UI
        # ML: landed in D/man/man1 or unresolved -> move to post10-man
        c_ui_popped = _remove_ids_from_queue(runtime, RUNTIME_POSTTESTC_UI, bset)
        preui_popped = _remove_ids_from_queue(runtime, RUNTIME_PREUI, bset)
        d_popped = _remove_ids_from_queue(runtime, RUNTIME_POSTTESTC_D, bset)
        man_popped = _remove_ids_from_queue(runtime, RUNTIME_POSTTESTC_MAN, bset)
        man1_popped = _remove_ids_from_queue(runtime, RUNTIME_POSTTESTC_MAN1, bset)
        err500_popped = _remove_ids_from_queue(runtime, RUNTIME_POSTTESTC_ERROR500, bset)
        q404_popped = _remove_ids_from_queue(runtime, RUNTIME_POSTTESTC_404, bset)
        srv_popped = _remove_ids_from_queue(runtime, RUNTIME_POSTTESTC_SERVERDOWN, bset)

        success_rows: List[dict] = []
        fail_rows: List[dict] = []
        missing_tool10_output: List[str] = []
        for sid in id_list:
            if sid in c_ui_popped:
                success_rows.append(_set_queue_name(c_ui_popped[sid], "post10-UI"))
            elif sid in preui_popped:
                success_rows.append(_set_queue_name(preui_popped[sid], "post10-UI"))
            else:
                base = (
                    d_popped.get(sid)
                    or man_popped.get(sid)
                    or man1_popped.get(sid)
                    or err500_popped.get(sid)
                    or q404_popped.get(sid)
                    or srv_popped.get(sid)
                )
                if base is None:
                    missing_tool10_output.append(sid)
                    continue
                fail_rows.append(_set_queue_name(base, "post10-man"))
        _append_unique_by_source(runtime, RUNTIME_POST10_UI, success_rows)
        _append_unique_by_source(runtime, RUNTIME_POST10_MAN, fail_rows)
        if missing_tool10_output:
            notes.append(
                "tool10 produced no queue output for "
                f"{len(missing_tool10_output)} batch id(s); skipped synthetic post10-man rows"
            )
    else:
        notes.append("tool10 skipped (no batch rows in postTestC-man)")

    # Tool 11 on post10-man via isolated postTestC-manual-review queue
    post10_rows = _read_jsonl_objects(runtime / RUNTIME_POST10_MAN)
    ids_for_11 = {_sid_of(r) for r in post10_rows if _sid_of(r) in bset}
    if ids_for_11:
        moved_11 = _move_selected_ids(
            runtime,
            RUNTIME_POST10_MAN,
            RUNTIME_POSTTESTC_MAN,
            ids_for_11,
            dst_queue_name="postTestC-man",
        )
        if moved_11 > 0:
            c7 = ["npx", "--yes", "tsx", "02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts", "--batch"]
            rc = _isolate_queue_and_run(
                project_root,
                runtime,
                RUNTIME_POSTTESTC_MAN,
                ids_for_11,
                c7,
                dry_run=dry_run,
            )
            cmds.append(c7)
            if rc != 0:
                return RealPipelineResult(rc, cmds, notes + [f"tool11 diagnostic failed exit={rc}"])
            notes.append(f"tool11 done ({moved_11} row(s) from post10-man)")
    else:
        notes.append("tool11 skipped (no batch rows in post10-man)")

    # 500-AI first on error500
    ids_for_500 = {
        _sid_of(r)
        for r in _read_jsonl_objects(runtime / RUNTIME_POSTTESTC_ERROR500)
        if _sid_of(r) in bset
    }
    if ids_for_500:
        if run_recovery:
            c8 = ["python3", "03-Queue/scb-500-AI.py"]
            rc = _isolate_queue_and_run(
                project_root,
                runtime,
                RUNTIME_POSTTESTC_ERROR500,
                ids_for_500,
                c8,
                dry_run=dry_run,
            )
            cmds.append(c8)
            if rc != 0:
                return RealPipelineResult(rc, cmds, notes + [f"scb-500-AI failed exit={rc}"])
            notes.append(f"scb-500-AI done ({len(ids_for_500)} error500 row(s))")
        else:
            notes.append(
                f"recovery skipped: {len(ids_for_500)} row(s) remain in postTestC-error500"
            )
    else:
        notes.append("scb-500-AI skipped (no batch rows in postTestC-error500)")

    # Tool12 on 404 + serverdown after 500-AI
    ids_404 = {
        _sid_of(r)
        for r in _read_jsonl_objects(runtime / RUNTIME_POSTTESTC_404)
        if _sid_of(r) in bset
    }
    ids_srv = {
        _sid_of(r)
        for r in _read_jsonl_objects(runtime / RUNTIME_POSTTESTC_SERVERDOWN)
        if _sid_of(r) in bset
    }
    ids_for_12 = ids_404 | ids_srv
    if ids_for_12:
        if run_recovery:
            q404 = runtime / RUNTIME_POSTTESTC_404
            qsrv = runtime / RUNTIME_POSTTESTC_SERVERDOWN
            orig404 = _read_jsonl_objects(q404)
            origsrv = _read_jsonl_objects(qsrv)
            sel404, other404 = _split_rows_by_ids(orig404, ids_for_12)
            selsrv, othersrv = _split_rows_by_ids(origsrv, ids_for_12)
            _write_jsonl(q404, sel404)
            _write_jsonl(qsrv, selsrv)
            c9 = ["python3", "03-Queue/gl-fix-404.py"]
            if dry_run:
                print(f"[E2E-real] DRY: would run {' '.join(c9)} on {len(ids_for_12)} row(s)")
                rc = 0
            else:
                rc = subprocess.run(c9, cwd=str(project_root)).returncode
            cmds.append(c9)
            after404 = _read_jsonl_objects(q404)
            aftersrv = _read_jsonl_objects(qsrv)
            _write_jsonl(q404, other404 + after404)
            _write_jsonl(qsrv, othersrv + aftersrv)
            if rc != 0:
                return RealPipelineResult(rc, cmds, notes + [f"tool12 gl-fix-404 failed exit={rc}"])
            notes.append(f"tool12 done ({len(ids_for_12)} row(s) from 404/serverdown)")
        else:
            notes.append(
                "recovery skipped: "
                f"{len(ids_404)} row(s) remain in postTestC-404, "
                f"{len(ids_srv)} row(s) remain in postTestC-serverdown"
            )
    else:
        notes.append("tool12 skipped (no batch rows in 404/serverdown)")

    return RealPipelineResult(0, cmds, notes)
