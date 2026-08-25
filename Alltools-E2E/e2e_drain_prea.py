#!/usr/bin/env python3
"""
Verktyg 18 (CLI): kör Alltools-E2E i batch om 10 tills runtime/preA är tom.

Från db.py / val 18 körs i stället run_e2e_drain_prea_interactive() som uppdaterar
dashboarden efter varje batch. Detta skript används för manuell körning utan UI.

Varje batch skriver rapport under Alltools-E2E/runtime/reports/run-*.json.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E2E_DIR = Path(__file__).resolve().parent
E2E_MAIN = E2E_DIR / "e2e.py"
PREA = ROOT / "runtime" / "preA-queue.jsonl"
BATCH_CAP = 10
CURRENT_PROC: subprocess.Popen | None = None


def terminate_current_proc(signum: int, _frame) -> None:
    global CURRENT_PROC
    if CURRENT_PROC and CURRENT_PROC.poll() is None:
        print(f"\n[E2E-18] Fick signal {signum}; stoppar aktiv E2E-batch...")
        child_pid = CURRENT_PROC.pid
        try:
            os.killpg(child_pid, signum)
        except Exception:
            CURRENT_PROC.terminate()
        try:
            CURRENT_PROC.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(child_pid, signal.SIGKILL)
        except Exception:
            if CURRENT_PROC.poll() is None:
                CURRENT_PROC.kill()
        try:
            CURRENT_PROC.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        finally:
            CURRENT_PROC = None
    raise SystemExit(128 + signum)


def count_pre_a() -> int:
    if not PREA.is_file():
        return 0
    n = 0
    for line in PREA.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            sid = str(json.loads(raw).get("sourceId") or "").strip()
            if sid:
                n += 1
        except Exception:
            pass
    return n


def main() -> int:
    signal.signal(signal.SIGINT, terminate_current_proc)
    signal.signal(signal.SIGTERM, terminate_current_proc)

    if not E2E_MAIN.is_file():
        print(f"ERROR: saknas {E2E_MAIN}")
        return 2

    batch_no = 0
    while True:
        n = count_pre_a()
        if n == 0:
            print("\n[E2E-18] preA är tom — alla batchar klara.")
            return 0

        lim = min(BATCH_CAP, n)
        batch_no += 1
        print(f"\n[E2E-18] ─── Batch {batch_no} ─── preA kvar: {n} → kör limit={lim}")

        global CURRENT_PROC
        CURRENT_PROC = subprocess.Popen(
            [
                sys.executable,
                str(E2E_MAIN),
                "--limit",
                str(lim),
                "--apply",
                "--sync-legacy",
                "--from-preA",
            ],
            cwd=str(ROOT),
            start_new_session=True,
        )
        rc = CURRENT_PROC.wait()
        CURRENT_PROC = None

        if rc != 0:
            print(f"\n[E2E-18] Batch {batch_no} misslyckades (exit {rc}). Stoppar.")
            return rc


if __name__ == "__main__":
    raise SystemExit(main())
