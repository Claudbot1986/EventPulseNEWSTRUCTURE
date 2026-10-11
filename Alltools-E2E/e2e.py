#!/usr/bin/env python3
"""
Alltools-E2E — kör **riktiga** verktyg A → B → C → D (TypeScript) mot projektets `runtime/`.

Ingen simulerad extraktion. Batch tas från `runtime/preA-queue.jsonl` (--from-preA).

Plan: vault `00-Inbox/E2E-Integration-Plan-Alltools-med-D.md`
Principer: `04-People/Me/Hur-Jag-Vill-Att-AI-Ska-Arbeta.md` (bygg färdigt, verifiera).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.e2e_report import build_batch_report
from core.legacy_sync import audit_legacy_runtime
from core.real_pipeline import run_real_abcd

ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = Path(os.environ.get("EVENTPULSE_SANDBOX_ROOT", str(ROOT))).resolve()
E2E_ROOT = Path(__file__).resolve().parent
REPORTS = E2E_ROOT / "runtime" / "reports"
SOURCES = DATA_ROOT / "sources"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def run_id() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


# ─── Ingestion runs log (runtime/ingestion_runs.jsonl) ─────────────────────────
# En rad per batch/cykel. Spegel av 02-Ingestion/tools/runRecorder.ts (TS).
# Skriver till ROOT/runtime/ingestion_runs.jsonl (gitignorerad, ingen Supabase).
INGESTION_RUNS_LOG = ROOT / "runtime" / "ingestion_runs.jsonl"


def _random_suffix() -> str:
    import secrets
    return secrets.token_hex(2)


def write_ingestion_run_summary(
    trigger: str,
    run_id_value: str,
    sources_attempted: int,
    report_path: Optional[str],
    stage_notes: List[str],
    exit_code: int,
    dry_run: bool,
    per_source_events: int = 0,
    start_ts: Optional[str] = None,
) -> None:
    """Append-only skrivning av en batch-rad. Kastar aldrig (loggning får aldrig krascha).

    start_ts: om angiven används den (redan UTC, från rapporten) — detta undviker
              tidszons-buggar som uppstår om man parsar rid (lokal tid) som UTC.
    """
    try:
        INGESTION_RUNS_LOG.parent.mkdir(parents=True, exist_ok=True)
        end_ts = now_iso()
        if not start_ts:
            # Fallback: bygg från rid (lokal tid, antas vara UTC om systemklockan är UTC)
            try:
                start_dt = datetime.strptime(run_id_value, "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)
                start_ts = start_dt.isoformat().replace("+00:00", "Z")
            except ValueError:
                start_ts = end_ts
        # Räkna duration korrekt
        try:
            start_dt = datetime.fromisoformat(start_ts.replace("Z", "+00:00"))
            duration_ms = int((datetime.now(timezone.utc) - start_dt).total_seconds() * 1000)
        except Exception:
            duration_ms = 0
        ok = exit_code == 0 and not dry_run
        # Första felet (om något) från stage_notes
        error_summary: Optional[str] = None
        if not ok:
            for note in stage_notes:
                if "ERROR" in note.upper() or "FAIL" in note.upper() or "exception" in note.lower():
                    error_summary = note[:200]
                    break
            if error_summary is None:
                error_summary = f"exit_code={exit_code}"
        entry = {
            "runId": f"{trigger}-{run_id_value}-{_random_suffix()}",
            "triggerSource": trigger,
            "startTs": start_ts,
            "endTs": end_ts,
            "durationMs": max(0, duration_ms),
            "ok": ok,
            "sourcesAttempted": sources_attempted,
            "sourcesSucceeded": sources_attempted if ok else 0,
            "sourcesFailed": 0 if ok else sources_attempted,
            "totalEventsFound": per_source_events,
            "totalEventsPersisted": 0,  # E2E vet inte vad som persisterades — läses i TS-tap
            "stagesCompleted": [],  # TS-tap-points fyller i detaljer; e2e har inte steg-fönster
            "errorSummary": error_summary,
            "pid": os.getpid(),
            "reportPath": report_path,
            "dryRun": dry_run,
        }
        with INGESTION_RUNS_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        # Loggning får aldrig krascha en körning — stderr är OK.
        print(f"[E2E] WARNING: ingestion_runs-log misslyckades: {e}", file=sys.stderr)


def _source_preferred_path_field(obj: dict) -> Optional[str]:
    pp = obj.get("preferredPath")
    if pp is None:
        return None
    s = str(pp).strip()
    return s if s else None


def all_canonical_sources() -> List[Dict[str, Any]]:
    by_id: Dict[str, Dict[str, Any]] = {}
    for p in sorted(SOURCES.glob("*.jsonl")):
        try:
            obj = json.loads(p.read_text(encoding="utf-8").strip())
        except Exception:
            continue
        sid = str(obj.get("id") or p.stem).strip()
        url = str(obj.get("url") or "").strip()
        if not sid or not url:
            continue
        if sid in by_id:
            continue
        by_id[sid] = {
            "sourceId": sid,
            "name": str(obj.get("name") or sid),
            "url": url,
            "city": str(obj.get("city") or ""),
            "sourcePreferredPath": _source_preferred_path_field(obj),
        }
    return [by_id[k] for k in sorted(by_id.keys())]


def catalog_fingerprint(ids: List[str]) -> str:
    import hashlib

    h = hashlib.sha256()
    for s in sorted(ids):
        h.update(s.encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()[:16]


def count_pre_a_sources(project_root: Path) -> int:
    prea = project_root / "runtime" / "preA-queue.jsonl"
    if not prea.is_file():
        return 0
    n = 0
    for line in prea.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            if str(json.loads(raw).get("sourceId") or "").strip():
                n += 1
        except Exception:
            pass
    return n


def load_pre_a_batch(
    project_root: Path,
    catalog: List[Dict[str, Any]],
    limit: int,
) -> Tuple[List[Dict[str, Any]], str, bool]:
    prea = project_root / "runtime" / "preA-queue.jsonl"
    ordered_ids: List[str] = []
    if prea.is_file():
        for line in prea.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw:
                continue
            try:
                sid = str(json.loads(raw).get("sourceId") or "").strip()
                if sid:
                    ordered_ids.append(sid)
            except Exception:
                pass
    fp0 = catalog_fingerprint(sorted({r["sourceId"] for r in catalog}))
    if not ordered_ids:
        return [], fp0, False
    take = min(limit, len(ordered_ids))
    batch_ids = ordered_ids[:take]
    by_id = {r["sourceId"]: r for r in catalog}
    items: List[Dict[str, Any]] = []
    for sid in batch_ids:
        if sid in by_id:
            items.append(by_id[sid])
        else:
            print(f"[E2E] VARNING: {sid} i preA men saknas i sources-katalog — hoppas över")
    return items, fp0, False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Alltools-E2E: real Tool A→B→C→D (TypeScript) on project runtime/"
    )
    parser.add_argument("--limit", type=int, default=10, help="Max sources from top of preA")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute real pipeline (network, disk writes, ingestion tools)",
    )
    parser.add_argument(
        "--sync-legacy",
        action="store_true",
        help="No-op (compat): TS tools already write project runtime/.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Run even if audit reports blocking issues (e.g. intra-file duplicates).",
    )
    parser.add_argument(
        "--from-preA",
        dest="from_pre_a",
        action="store_true",
        help="Required. Batch = first N rows of runtime/preA-queue.jsonl.",
    )
    parser.add_argument("--workers-a", type=int, default=24, help="runA --workers")
    parser.add_argument("--workers-b", type=int, default=8, help="runB-parallel --workers")
    parser.add_argument("--workers-c", type=int, default=5, help="runC-one-time-only --workers")
    parser.add_argument("--workers-d", type=int, default=4, help="runD --workers")
    parser.add_argument(
        "--no-extended-d",
        dest="no_extended_d",
        action="store_true",
        help="Skip extended D-sweep over postTestC-manual-review/serverdown/404/error500 (default: enabled).",
    )
    args = parser.parse_args()

    if not args.from_pre_a:
        print(
            "[E2E] ERROR: Real pipeline requires --from-preA "
            "(batch = top of runtime/preA-queue.jsonl).",
            file=sys.stderr,
        )
        return 2

    catalog = all_canonical_sources()
    if not catalog:
        print("ERROR: No sources found under sources/", file=sys.stderr)
        return 2

    prea_n = count_pre_a_sources(DATA_ROOT)
    if prea_n == 0:
        print("[E2E] preA är tom — inget att köra.")
        return 0

    eff_limit = min(int(args.limit), prea_n)
    items, catalog_fp, cycled = load_pre_a_batch(DATA_ROOT, catalog, eff_limit)
    if not items:
        print("[E2E] ERROR: preA har rader men ingen batch kunde matchas mot katalog.", file=sys.stderr)
        return 2

    sids = [str(s["sourceId"]) for s in items]
    # Scrapingbee key check: read from .env file directly (tsx loads via dotenv;
    # this Python status check shouldn't rely on shell env vars).
    scb_key = os.environ.get("SCRAPINGBEE_API_KEY", "")
    if not scb_key:
        env_path = ROOT / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("SCRAPINGBEE_API_KEY="):
                    scb_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not scb_key:
        scb_status = "MISSING — D-gate falls back to Puppeteer"
    elif scb_key.startswith("sb_REPLACE_ME"):
        scb_status = f"prefix={scb_key[:8]} (PLACEHOLDER — D-gate falls back to Puppeteer)"
    else:
        scb_status = f"prefix={scb_key[:8]} (active — D-gate uses ScrapingBee)"
    print(f"[E2E] SCRAPINGBEE_API_KEY: {scb_status}")
    print(
        f"[E2E] real pipeline | preA: {prea_n} rader | batch: {len(sids)} "
        f"(limit={args.limit} → effektivt {eff_limit}) | cycled={cycled}"
    )
    print(f"[E2E] batch sourceIds: {', '.join(sids)}")

    dry = not args.apply
    if args.apply:
        audit = audit_legacy_runtime(DATA_ROOT)
        # Warnings: cross-queue duplicates — fortsätt, logga separat.
        if audit["warnings"]:
            print(
                f"[E2E] {len(audit['warnings'])} warning(s) — cross-queue duplicates "
                f"(legacy-state, fortsätter):",
                file=sys.stderr,
            )
            for w in audit["warnings"][:25]:
                print(f"  - {w}", file=sys.stderr)
            if len(audit["warnings"]) > 25:
                print(f"  ... +{len(audit['warnings']) - 25} fler", file=sys.stderr)
        # Errors: intra-file duplicates — hårt fel såvida inte --force anges.
        if audit["blocking"] and not args.force:
            print(
                "[E2E] ABORT: legacy-köer har hårda fel (intra-file duplicates):",
                file=sys.stderr,
            )
            for err in audit["errors"][:25]:
                print(f"  - {err}", file=sys.stderr)
            if len(audit["errors"]) > 25:
                print(f"  ... +{len(audit['errors']) - 25} fler", file=sys.stderr)
            print(
                "[E2E] Tips: kör med --force för att fortsätta ändå (rekommenderas inte).",
                file=sys.stderr,
            )
            return 4
        if audit["blocking"] and args.force:
            print(
                f"[E2E] --force angivet: fortsätter trots {len(audit['errors'])} hårda fel.",
                file=sys.stderr,
            )

    if args.sync_legacy and args.apply:
        print("[E2E] Note: --sync-legacy is a no-op; TypeScript tools write project runtime/ directly.")

    if args.no_extended_d:
        os.environ["EVENTPULSE_NO_EXTENDED_D"] = "1"
        print("[E2E] --no-extended-d: skipping extended D-sweep over recovery queues")

    res = run_real_abcd(
        ROOT,
        sids,
        data_root=DATA_ROOT,
        workers_a=args.workers_a,
        workers_b=args.workers_b,
        workers_c=args.workers_c,
        workers_d=args.workers_d,
        include_extended_stages=os.environ.get("EVENTPULSE_ABCD_ONLY") != "1",
        dry_run=dry,
    )

    rid = run_id()
    REPORTS.mkdir(parents=True, exist_ok=True)
    report = build_batch_report(
        DATA_ROOT,
        sids,
        run_id=rid,
        timestamp=now_iso(),
        catalog_fingerprint=catalog_fp,
        batch_mode="from_preA",
        pipeline_notes=res.stage_notes + ([f"exit_code={res.exit_code}"] if res.exit_code else []),
        commands_run=res.commands_run,
    )
    report["dryRun"] = dry
    rp = REPORTS / f"run-{rid}.json"
    rp.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[E2E] report={rp}")

    # ── Logga batch-körning till runtime/ingestion_runs.jsonl ────────────────
    try:
        # Summera events från rapportens perSource (rappor är redan byggd ovan)
        per_source_events = 0
        try:
            for ps in (report.get("perSource") or []):
                per_source_events += int(ps.get("eventsFound") or 0)
        except Exception:
            pass
        write_ingestion_run_summary(
            trigger="e2e",
            run_id_value=rid,
            sources_attempted=len(sids),
            report_path=str(rp),
            stage_notes=list(res.stage_notes or []),
            exit_code=res.exit_code,
            dry_run=dry,
            per_source_events=per_source_events,
            start_ts=report.get("timestamp"),
        )
    except Exception as e:
        # Loggning får aldrig krascha en körning
        print(f"[E2E] WARNING: kunde inte skriva ingestion_runs.jsonl: {e}", file=sys.stderr)

    if res.exit_code != 0:
        return res.exit_code if res.exit_code <= 127 else 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
