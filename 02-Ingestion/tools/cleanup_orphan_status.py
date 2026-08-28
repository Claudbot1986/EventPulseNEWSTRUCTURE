"""
cleanup_orphan_status.py — Rensar ghost-entries från sources_status.jsonl.

Många sourceIds finns kvar i sources_status.jsonl trots att motsvarande
source-fil (sources/<id>.jsonl) har tagits bort — t.ex. dramaten, fotografiska,
grona-lund. Dessa är rester från tidigare städningar och ger felaktig
dashboard-signal (säger att källan "fail:ar" när den inte ens finns).

Säkerhet:
  - Backup: runtime/audit-<date>-orphan-cleanup.jsonl
  - sources_status.jsonl skrivs med filtrerade rader
  - Försiktig: bara IDs som saknar source-fil tas bort

Användning:
  python3 02-Ingestion/tools/cleanup_orphan_status.py            # kör
  python3 02-Ingestion/tools/cleanup_orphan_status.py --dry-run  # visa utan att utföra
"""

import json
import os
import sys
from datetime import datetime

# ─── Config ──────────────────────────────────────────────────────────────────

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCES_DIR = os.path.join(PROJECT_ROOT, 'sources')
RUNTIME_DIR = os.path.join(PROJECT_ROOT, 'runtime')
STATUS_FILE = os.path.join(RUNTIME_DIR, 'sources_status.jsonl')

DATE = datetime.now().strftime('%Y-%m-%d')
AUDIT_FILE = os.path.join(RUNTIME_DIR, f'audit-{DATE}-orphan-cleanup.jsonl')

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv

    # 1. Bygg set av source-IDs som har en fil på disk
    on_disk = set()
    for fn in os.listdir(SOURCES_DIR):
        if not fn.endswith('.jsonl'): continue
        path = os.path.join(SOURCES_DIR, fn)
        try:
            with open(path) as fh:
                first = fh.readline().strip()
                if first:
                    o = json.loads(first)
                    on_disk.add(o['id'])
        except (json.JSONDecodeError, KeyError):
            continue

    # 2. Läs status och hitta orphans
    with open(STATUS_FILE) as fh:
        rows = [json.loads(line) for line in fh if line.strip()]

    orphan_ids = [r['sourceId'] for r in rows if r['sourceId'] not in on_disk]
    kept_ids = [r['sourceId'] for r in rows if r['sourceId'] in on_disk]

    print(f'=== ORPHAN CLEANUP {"DRY-RUN" if dry_run else "LIVE"} ===')
    print(f'On-disk source IDs:     {len(on_disk)}')
    print(f'sources_status rows:    {len(rows)}')
    print(f'Orphan rows to remove: {len(orphan_ids)}')
    print(f'Kept rows:              {len(kept_ids)}')
    print()
    print(f'First 20 orphans:')
    for sid in sorted(orphan_ids)[:20]:
        print(f'  {sid}')

    if dry_run:
        print(f'\n(DRY-RUN — would write {AUDIT_FILE} + rewrite {STATUS_FILE})')
        return

    response = input('\nProceed? (yes/no): ')
    if response.lower() != 'yes':
        print('Aborted.')
        return

    # 3. Audit-log
    with open(AUDIT_FILE, 'w') as fh:
        for r in rows:
            if r['sourceId'] not in on_disk:
                fh.write(json.dumps({
                    'auditType': 'orphan-cleanup',
                    'date': DATE,
                    'sourceId': r['sourceId'],
                    'lastRoutingReason': r.get('lastRoutingReason'),
                    'lastRun': r.get('lastRun'),
                    'lastSuccess': r.get('lastSuccess'),
                    'status': r.get('status'),
                }) + '\n')

    # 4. Skriv filtrerad status
    with open(STATUS_FILE, 'w') as fh:
        for r in rows:
            if r['sourceId'] in on_disk:
                fh.write(json.dumps(r) + '\n')

    print(f'\n✅ Removed {len(orphan_ids)} orphan rows.')
    print(f'   Kept {len(kept_ids)} rows.')
    print(f'   Audit: {AUDIT_FILE}')

if __name__ == '__main__':
    main()