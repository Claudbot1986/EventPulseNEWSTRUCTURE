#!/usr/bin/env python3
"""
queue-mem.py - Queue-minnessystem

Flytta källor mellan köer, återställ, sammanfoga.

Usage:
  python3 queue-mem.py status                    # Visa alla köer + antal
  python3 queue-mem.py reconcile                 # Visa diskrepans: sources/ vs köer
  python3 queue-mem.py reconcile --force          # Återställ SAMTLIGA köer → preA
  python3 queue-mem.py list <queue>              # Lista källor i en kö
  python3 queue-mem.py find <sourceId>            # Var finns källan?
  python3 queue-mem.py move <sourceId> <queue>  # Flytta en källa till annan kö
  python3 queue-mem.py move-all <from> <to>     # Flytta ALLA från en kö till en annan
  python3 queue-mem.py restore <sourceId> <queue> # Återställ källa (alias för move)
  python3 queue-mem.py merge <queue1,queue2> <to> # Flytta från FLERA köer till EN kö
  python3 queue-mem.py diff <queueA> <queueB>    # Visa källor som finns i A men inte i B
  python3 queue-mem.py missing <queue>            # Visa källor som borde finnas men saknas
  python3 queue-mem.py reset <sourceId>           # Återställ källa till preA
  python3 queue-mem.py reset-all <queue>         # Återställ alla från en kö till preA
  python3 queue-mem.py snapshot <namn>            # Spara backup med namn
  python3 queue-mem.py restore-snap <namn>       # Återställ från backup
  python3 queue-mem.py snapshots                 # Visa tillgängliga backups
  python3 queue-mem.py log                       # Visa journal

Queues: preA, postA, preB, postB, postB-preC, preUI, postTestC-A, postTestC-B,
        postTestC-D, postTestC-UI, postTestC-man, postTestC-Fail
"""

import sys
import json
import shutil
from pathlib import Path
from datetime import datetime

RUNTIME = Path(__file__).parent / "runtime"
JOURNAL = RUNTIME / "queue-mem-log.jsonl"
SNAPSHOT_DIR = RUNTIME / "queue-mem-snapshots"

QUEUE_FILES = {
    "preA":          "preA-queue.jsonl",
    "postA":         "postA-queue.jsonl",
    "preB":          "preB-queue.jsonl",
    "postB":         "postB-queue.jsonl",
    "postB-preC":    "postB-preC-queue.jsonl",
    "preUI":         "preUI-queue.jsonl",
    "EVENTPULSE-APP": "EVENTPULSE-APP-queue.jsonl",
    "postTestC-A":    "postTestC-A.jsonl",
    "postTestC-B":    "postTestC-B.jsonl",
    "postTestC-D":    "postTestC-D.jsonl",
    "postTestC-UI":   "postTestC-UI.jsonl",
    "postTestC-man":  "postTestC-manual-review.jsonl",
    "postTestC-serverdown": "postTestC-serverdown.jsonl",
    "postTestC-404":        "postTestC-404.jsonl",
    "postTestC-error500":   "postTestC-error500.jsonl",
    "postTestC-timeout":    "postTestC-timeout.jsonl",
    "postTestC-blocked":    "postTestC-blocked.jsonl",
    "postTestC-out":        "postTestC-out.jsonl",
    "postTestC-Fail":      "postTestC-Fail.jsonl",
}


def load_queue(name):
    fname = QUEUE_FILES.get(name)
    if not fname:
        return {}
    path = RUNTIME / fname
    if not path.exists():
        return {}
    entries = {}
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                entries[e["sourceId"]] = e
            except:
                pass
    except:
        pass
    return entries


def save_queue(name, entries):
    fname = QUEUE_FILES.get(name)
    if not fname:
        return
    path = RUNTIME / fname
    lines = []
    for e in entries.values():
        e["queueName"] = name
        e["queuedAt"] = datetime.utcnow().isoformat() + "Z"
        lines.append(json.dumps(e, ensure_ascii=False))
    path.write_text("\n".join(lines) + ("\n" if lines else ""))


def journal(action, detail):
    entry = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "action": action,
        "detail": detail,
    }
    with open(JOURNAL, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def cmd_status():
    """
    Visar status med automatisk rekonciliering:
      - summa > sources/ → deduplicera (behåll första, ta bort resten)
      - summa < sources/ → varna och peka på R
      - summa == sources/ → ✅
    """
    SOURCES_DIR = Path(__file__).parent / "sources"
    source_ids = {f.stem for f in SOURCES_DIR.glob("*.jsonl")}
    total_sources = len(source_ids)

    # Ladda alla köer med käll-ID → (queueName, entry, line_number)
    queue_order = list(QUEUE_FILES.keys())
    all_entries: list[tuple[int, str, dict]] = []  # (priority, sourceId, entry)
    # EVENTPULSE-APP behåller ALLTID sina duplicerade poster (aldrig deduplicera från den)
    SKIP_DEDUP_QUEUE = "EVENTPULSE-APP"

    for qname in queue_order:
        entries = load_queue(qname)
        for sid, entry in entries.items():
            priority = queue_order.index(qname)
            all_entries.append((priority, sid, entry))

    total_in_queues = len(all_entries)

    print()
    print("  KÖ                     ANTAL")
    print("  " + "─" * 28)
    for qname, fname in QUEUE_FILES.items():
        if qname == "postTestC-Fail":
            total = 0
            try:
                for f in RUNTIME.iterdir():
                    if f.name.startswith("postTestC-Fail") and f.suffix == ".jsonl":
                        total += sum(1 for line in f.read_text().splitlines() if line.strip())
            except:
                pass
            print(f"  {qname:<20} {total:>6}")
        else:
            path = RUNTIME / fname
            count = 0
            if path.exists():
                count = sum(1 for line in path.read_text().splitlines() if line.strip())
            print(f"  {qname:<20} {count:>6}")
    print()
    print(f"  {'Total sources:':<20} {total_sources:>6}")

    if total_in_queues > total_sources:
        # ── FÖR MÅNGA: deduplicera ────────────────────────────────────────────
        actual_dupes = total_in_queues - total_sources
        print()
        print(f"  ⚠   {actual_dupes} duplicerade poster hittades!")
        print(f"      Totalt i köer: {total_in_queues} | sources/: {total_sources}")
        print()
        print("  🔧 DEDUPLICERAR...")

        # Sortera: lägst queue-priority (preA=0) behålls först
        all_entries.sort(key=lambda x: (x[0], x[1]))  # (priority, sid)
        seen: set = set()
        to_remove: dict[str, set] = {}  # queueName → set of sourceIds to purge

        for priority, sid, entry in all_entries:
            qn = entry.get("queueName", queue_order[priority])

            # EVENTPULSE-APP behåller ALLTID sina poster — aldrig ta bort från den
            if qn == SKIP_DEDUP_QUEUE:
                continue

            if sid in seen:
                # Markera för borttagning ur denna kö
                if qn not in to_remove:
                    to_remove[qn] = set()
                to_remove[qn].add(sid)
            else:
                seen.add(sid)

        total_removed = 0
        for qn, sids in to_remove.items():
            entries = load_queue(qn)
            before = len(entries)
            for sid in sids:
                entries.pop(sid, None)
            save_queue(qn, entries)
            removed = before - len(entries)
            total_removed += removed
            print(f"    {qn}: {removed} duplicerade poster borttagna")

        # EVENTPULSE-APP behåller sina duplicerade poster — rapportera hur många som finns där
        app_entries = load_queue(SKIP_DEDUP_QUEUE)
        app_total = len(app_entries)
        app_unique = len(set(app_entries.keys()))
        app_dupes = app_total - app_unique
        print(f"    {SKIP_DEDUP_QUEUE}: {app_total} poster ({app_dupes} duplicerade — alla bevarade)")

        print(f"  ✅ {total_removed} duplicerade poster borttagna.")
        print(f"      Alla {total_sources} källor finns nu exakt 1 gång (exkl. EVENTPULSE-APP).")
        journal("AUTO-DEDUP", f"{total_removed} dupes removed, {total_sources} unique in queues (EVENTPULSE-APP preserved)")

    elif total_in_queues < total_sources:
        # ── FÖR FÅ: varnar ────────────────────────────────────────────────────
        missing = total_sources - total_in_queues
        print()
        print(f"  ╔══════════════════════════════════════════════════════╗")
        print(f"  ║  ⚠   {missing} KÄLLOR SAKNAS — kör:  python3 queue-mem.py reconcile --force   ║")
        print(f"  ╚══════════════════════════════════════════════════════╝")
        print()
        print("  Detta återställer SAMTLIGA köer → preA och fyller på")
        print("  med de {missing} källor som saknas från sources/.")
    else:
        print()
        print("  ✅ Alla köer i synk med sources/.")


def cmd_list(queue):
    entries = load_queue(queue)
    if not entries:
        print(f"  {queue} är tom eller okänd.")
        return
    try:
        width = shutil.get_terminal_size().columns
    except:
        width = 140
    width = max(width, 100)

    print()
    print(f"  {queue} ({len(entries)} källor)")
    print("  " + "─" * (min(width, 140) - 4))
    for sid, e in sorted(entries.items()):
        reason = e.get("queueReason", "")
        outcome = e.get("outcomeType", "")
        stage = e.get("winningStage", "")
        print(f"  {sid:<35} {outcome:<8} {stage}")
        if reason:
            print(f"    {reason[:min(len(reason), width - 5)]}")


def cmd_find(source_id):
    print()
    found = []
    for qname in QUEUE_FILES:
        entries = load_queue(qname)
        if source_id in entries:
            found.append((qname, entries[source_id]))
    if not found:
        print(f"  {source_id} finns inte i någon kö.")
    else:
        for qname, e in found:
            print(f"  {source_id} → {qname}")
            print(f"    outcomeType: {e.get('outcomeType')}")
            print(f"    winningStage: {e.get('winningStage')}")
            print(f"    routeSuggestion: {e.get('routeSuggestion')}")
            print(f"    queueReason: {e.get('queueReason')}")


def cmd_move(source_id, target_queue):
    if target_queue not in QUEUE_FILES:
        print(f"  Okänd queue: {target_queue}")
        return
    for qname in QUEUE_FILES:
        entries = load_queue(qname)
        if source_id in entries:
            e = entries.pop(source_id)
            save_queue(qname, entries)
            e["queueName"] = target_queue
            e["queueOrigin"] = target_queue
            e["queuedAt"] = datetime.utcnow().isoformat() + "Z"
            target = load_queue(target_queue)
            target[source_id] = e
            save_queue(target_queue, target)
            journal("MOVE", f"{source_id}: {qname} → {target_queue}")
            print(f"  [MOVE] {source_id}: {qname} → {target_queue}")
            return
    print(f"  {source_id} finns inte i någon queue.")


def cmd_move_all(from_queue, to_queue):
    if from_queue not in QUEUE_FILES or to_queue not in QUEUE_FILES:
        print("  Okänd queue.")
        return
    entries = load_queue(from_queue)
    if not entries:
        print(f"  {from_queue} är tom.")
        return
    count = len(entries)
    for e in entries.values():
        e["queueName"] = to_queue
        e["queueOrigin"] = to_queue
        e["queuedAt"] = datetime.utcnow().isoformat() + "Z"
    target = load_queue(to_queue)
    target.update(entries)
    save_queue(to_queue, target)
    save_queue(from_queue, {})
    journal("MOVE-ALL", f"{count} källor: {from_queue} → {to_queue}")
    print(f"  [MOVE-ALL] {count} källor: {from_queue} → {to_queue}")


def cmd_merge(from_str, to_queue):
    from_queues = [q.strip() for q in from_str.split(",")]
    for q in from_queues:
        if q not in QUEUE_FILES:
            print(f"  Okänd queue: {q}")
            return
    total = 0
    for qname in from_queues:
        entries = load_queue(qname)
        if not entries:
            continue
        for e in entries.values():
            e["queueName"] = to_queue
            e["queuedAt"] = datetime.utcnow().isoformat() + "Z"
        target = load_queue(to_queue)
        target.update(entries)
        save_queue(to_queue, target)
        save_queue(qname, {})
        total += len(entries)
        journal("MERGE", f"{len(entries)} källor: {qname} → {to_queue}")
        print(f"  [MERGE] {len(entries)} källor: {qname} → {to_queue}")
    if total == 0:
        print("  Inga källor att flytta.")


def cmd_diff(queue_a, queue_b):
    a_entries = load_queue(queue_a)
    b_entries = load_queue(queue_b)
    only_in_a = set(a_entries.keys()) - set(b_entries.keys())
    print()
    print(f"  Finns i {queue_a} men inte i {queue_b}: {len(only_in_a)}")
    print("  " + "─" * 50)
    for sid in sorted(only_in_a):
        e = a_entries[sid]
        print(f"  {sid:<30} {e.get('outcomeType',''):<8} {e.get('winningStage','')}")


def cmd_missing(target_queue):
    preA = load_queue("preA")
    target = load_queue(target_queue)
    missing = set(preA.keys()) - set(target.keys())
    print()
    print(f"  I preA men inte i {target_queue}: {len(missing)}")
    print("  " + "─" * 50)
    for sid in sorted(missing):
        print(f"  {sid}")


def cmd_reset(source_id):
    cmd_move(source_id, "preA")


def cmd_reset_all(from_queue):
    if from_queue == "preA":
        print("  Källa är redan i preA.")
        return
    cmd_move_all(from_queue, "preA")


def cmd_snapshot(name):
    SNAPSHOT_DIR.mkdir(exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    snap_dir = SNAPSHOT_DIR / f"{name}-{ts}"
    snap_dir.mkdir()
    for qname, fname in QUEUE_FILES.items():
        src = RUNTIME / fname
        if src.exists():
            shutil.copy2(src, snap_dir / fname)
    journal("SNAPSHOT", f"{name} @ {ts}")
    print(f"  [SNAPSHOT] sparad: {name} ({ts})")
    print(f"  Sökväg: {snap_dir}")


def cmd_restore_snapshot(name):
    snaps = sorted([d for d in SNAPSHOT_DIR.iterdir() if d.is_dir() and d.name.startswith(name + "-")], key=lambda d: d.name)
    if not snaps:
        print(f"  Ingen snapshot hittades för: {name}")
        return
    snap_dir = snaps[-1]
    for qname, fname in QUEUE_FILES.items():
        src = snap_dir / fname
        dst = RUNTIME / fname
        if src.exists():
            shutil.copy2(src, dst)
    journal("RESTORE-SNAP", f"{name} <- {snap_dir.name}")
    print(f"  [RESTORE-SNAP] {name} <- {snap_dir.name}")


def cmd_snapshots():
    print()
    print("  TILLGÄNGLIGA BACKUPS")
    print("  " + "─" * 50)
    if not SNAPSHOT_DIR.exists():
        print("  Inga snapshots.")
        return
    for d in sorted(SNAPSHOT_DIR.iterdir(), key=lambda d: d.name, reverse=True):
        parts = d.name.split("-", 1)
        name = parts[0]
        ts = parts[1] if len(parts) > 1 else ""
        count = sum(1 for f in d.iterdir() if f.is_file() and f.suffix == ".jsonl")
        print(f"  {name:<25} {ts}  ({count} filer)")


def cmd_log():
    print()
    print("  QUEUE-MEM LOG (senaste 50)")
    print("  " + "─" * 50)
    if not JOURNAL.exists():
        print("  (tom)")
        return
    lines = JOURNAL.read_text().splitlines()
    for line in reversed(lines[-50:]):
        try:
            e = json.loads(line)
            print(f"  {e['ts'][:19]}  {e['action']:<12} {e['detail']}")
        except:
            pass


def cmd_reconcile():
    """Visa reconciliationsrapport: sources/ vs köer. Skriver inget om ingen diskrepans."""
    SOURCES_DIR = Path(__file__).parent / "sources"

    source_ids = {f.stem for f in SOURCES_DIR.glob("*.jsonl")}
    total_sources = len(source_ids)

    in_queues: dict = {q: set() for q in QUEUE_FILES}
    in_any_queue = set()
    for qname, fname in QUEUE_FILES.items():
        path = RUNTIME / fname
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            if line.strip():
                try:
                    sid = json.loads(line).get("sourceId", "")
                    if sid:
                        in_queues[qname].add(sid)
                        in_any_queue.add(sid)
                except:
                    pass

    missing = source_ids - in_any_queue
    total_in_queues = sum(len(v) for v in in_queues.values())
    dupes = total_in_queues - len(in_any_queue)

    print()
    print("  ╔══════════════════════════════════════════════════════╗")
    print("  ║               QUEUE RECONCILE                        ║")
    print("  ╠══════════════════════════════════════════════════════╣")
    print(f"  ║  sources/:         {total_sources:>6} källor             ║")
    print(f"  ║  Totalt i köer:     {len(in_any_queue):>6} källor             ║")
    print(f"  ║  Saknas helt:      {len(missing):>6} källor             ║")
    print(f"  ║  Duplicerade:      {dupes:>6} poster            ║")
    print("  ╠══════════════════════════════════════════════════════╣")
    for qname in QUEUE_FILES:
        print(f"  ║  {qname:<20} {len(in_queues[qname]):>6}              ║")
    print("  ╚══════════════════════════════════════════════════════╝")

    if missing or dupes or len(in_any_queue) != total_sources:
        print()
        print("  ⚠   DISKREPANS UPPTÄCKT — kör reconcile --force för att återställa")
    else:
        print()
        print("  ✅ Alla köer är i synk med sources/.")


def cmd_reconcile_force():
    """Nollställ alla köer, återinportera allt från sources/ → preA.
    Körs ENBART om antalet i köer är färre än antalet i sources/."""
    SOURCES_DIR = Path(__file__).parent / "sources"

    source_ids = set(f.stem for f in SOURCES_DIR.glob("*.jsonl"))
    total = len(source_ids)

    # Räkna alla unika källor i alla köer
    in_any_queue: set = set()
    for qname, fname in QUEUE_FILES.items():
        path = RUNTIME / fname
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            if line.strip():
                try:
                    sid = json.loads(line).get("sourceId", "")
                    if sid:
                        in_any_queue.add(sid)
                except:
                    pass

    if len(in_any_queue) >= total:
        print()
        print("  ╔══════════════════════════════════════════════════════╗")
        print("  ║  🚫 R KAN INTE KÖRAS                                 ║")
        print("  ║  Antalet i köerna är inte färre än antalet i sources/ ║")
        print(f"  ║  Köer: {len(in_any_queue):>4} | sources/: {total:>4}                       ║")
        print("  ║  Inget behöver återställas. Kör 'a' för auto-dedup. ║")
        print("  ╚══════════════════════════════════════════════════════╝")
        return

    missing_count = total - len(in_any_queue)
    preA_before = len(load_queue("preA"))
    print(f"\n  R: {missing_count} källor saknas i köerna. Återställer {total} → preA (war {preA_before} före)...")

    now = datetime.utcnow().isoformat() + "Z"

    # Nollställ alla köer utom preA
    for qname in QUEUE_FILES:
        if qname == "preA":
            continue
        save_queue(qname, {})

    # Repopulera preA
    preA_entries = {}
    for sid in source_ids:
        preA_entries[sid] = {
            "sourceId": sid,
            "queueName": "preA",
            "queuedAt": now,
            "priority": 1,
            "attempt": 1,
            "queueReason": "reconcile: sources-truth",
        }
    save_queue("preA", preA_entries)

    journal("RECONCILE-FORCE", f"{total} källor → preA (was {preA_before} before)")
    print(f"  ✅ {total} källor nu i preA. Alla andra köer = 0.")
    cmd_status()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1].lower()
    args = sys.argv[2:]

    if cmd == "status":
        cmd_status()
    elif cmd == "list":
        if len(args) < 1:
            print("  Usage: list <queue>")
        else:
            cmd_list(args[0])
    elif cmd == "find":
        if len(args) < 1:
            print("  Usage: find <sourceId>")
        else:
            cmd_find(args[0])
    elif cmd == "move":
        if len(args) < 2:
            print("  Usage: move <sourceId> <queue>")
        else:
            cmd_move(args[0], args[1])
    elif cmd == "restore":
        if len(args) < 2:
            print("  Usage: restore <sourceId> <queue>")
        else:
            cmd_move(args[0], args[1])
    elif cmd == "move-all":
        if len(args) < 2:
            print("  Usage: move-all <fromQueue> <toQueue>")
        else:
            cmd_move_all(args[0], args[1])
    elif cmd == "merge":
        if len(args) < 2:
            print("  Usage: merge <queue1,queue2> <toQueue>")
        else:
            cmd_merge(args[0], args[1])
    elif cmd == "diff":
        if len(args) < 2:
            print("  Usage: diff <queueA> <queueB>")
        else:
            cmd_diff(args[0], args[1])
    elif cmd == "missing":
        if len(args) < 1:
            print("  Usage: missing <queue>")
        else:
            cmd_missing(args[0])
    elif cmd == "reset":
        if len(args) < 1:
            print("  Usage: reset <sourceId>")
        else:
            cmd_reset(args[0])
    elif cmd == "reset-all":
        if len(args) < 1:
            print("  Usage: reset-all <queue>")
        else:
            cmd_reset_all(args[0])
    elif cmd == "snapshot":
        if len(args) < 1:
            print("  Usage: snapshot <namn>")
        else:
            cmd_snapshot(args[0])
    elif cmd == "restore-snap":
        if len(args) < 1:
            print("  Usage: restore-snap <namn>")
        else:
            cmd_restore_snapshot(args[0])
    elif cmd == "snapshots":
        cmd_snapshots()
    elif cmd == "log":
        cmd_log()
    elif cmd == "reconcile":
        if "--force" in args:
            cmd_reconcile_force()
        else:
            cmd_reconcile()
    else:
        print(f"  Okänt kommando: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
