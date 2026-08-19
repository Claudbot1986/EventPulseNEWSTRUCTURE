"""
cleanup_sources.py — Rensar felregistrerade källor.

Tre klassificeringsregler:
  1. Stale >90 dagar + icke-Stockholm stad → bort (dead-weight)
  2. Event-permalink URL (mönster /event/123, /evenemang/123, datum i URL) → bort
  3. Ticket-platform host (biljettshop.se, tickster, billetto/event) → bort

Säkerhet:
  - Backup: kopia till sources/_archive/<date>-cleanup/ (ADDITIV, kan rullas tillbaka)
  - Audit-logg: runtime/audit-<date>-source-cleanup.jsonl
  - sources_status.jsonl filtreras i samma operation
  - Stockholm working sources (kungstradgarden, aik, etc.) skyddas av regel 1

Användning:
  python3 02-Ingestion/tools/cleanup_sources.py            # kör
  python3 02-Ingestion/tools/cleanup_sources.py --dry-run  # visa utan att utföra

Output:
  sources/_archive/2026-08-19-cleanup/<sourceId>.jsonl
  runtime/audit-2026-08-19-source-cleanup.jsonl
  runtime/sources_status.jsonl (filtrerad)
"""

import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

# ─── Config ──────────────────────────────────────────────────────────────────

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCES_DIR = os.path.join(PROJECT_ROOT, 'sources')
RUNTIME_DIR = os.path.join(PROJECT_ROOT, 'runtime')
STATUS_FILE = os.path.join(RUNTIME_DIR, 'sources_status.jsonl')

DATE = datetime.now().strftime('%Y-%m-%d')
ARCHIVE_DIR = os.path.join(SOURCES_DIR, '_archive', f'{DATE}-cleanup')
AUDIT_FILE = os.path.join(RUNTIME_DIR, f'audit-{DATE}-source-cleanup.jsonl')

STHLM_HINTS = {
    'stockholm', 'solna', 'sundbyberg', 'nacka', 'lidingö', 'lidingo', 'täby', 'taby',
    'huddinge', 'järfälla', 'jarfalla', 'sollentuna', 'tyresö', 'tyreso',
    'södertälje', 'sodertalje', 'kista', 'bromma', 'östermalm', 'ostermalm',
    'södermalm', 'sodermalm', 'vasastan', 'kungsholmen', 'enskede', 'hässelby',
    'hasselby', 'skärholmen', 'skarholmen', 'farsta', 'skarpnäck',
    'bandhagen', 'trollbäcken', 'tullinge', 'djursholm', 'mörby', 'morby',
    'kungens kurva', 'vällingby', 'vallingby',
}

EVENT_PATH_PATTERNS = [
    r'/event/\d+',
    r'/events/\d+',
    r'/arr/\d+',
    r'/show/\d+',
    r'/p/\d+',
    r'/e/\d+',
    r'/performance/\d+',
    r'/arrangemang/\d+',
    r'/evenemang/\d+',
    r'/kalender/datum/',
    r'/\d{4}/\d{2}/\d{2}/',
    r'/\d{4}-\d{2}-\d{2}',
    r'/agenda/[a-z0-9-]+-\d{4}',
    r'/tickets?/[a-z0-9-]+-?\d{4}',
]

TICKET_HOSTS = ['biljettshop.se', 'tickster.com', 'billetto.se', 'billetto.com', 'ticnet.com', 'northstarmtg.com']

PROTECTED_SOURCES = [
    'kungstradgarden', 'stenpiren', 'stockholm-live', 'eventbrite-stockholm',
    'sthlmlist', 'aik',
]

STALE_DAYS = 90

# ─── Classification ───────────────────────────────────────────────────────────

def is_sthlm(city):
    if not city: return False
    city = city.lower().strip()
    if city in STHLM_HINTS: return True
    return any(c in city for c in ['stockholm', 'södermalm', 'sodermalm', 'solna',
                                    'sundbyberg', 'lidingö', 'nacka', 'täby', 'taby',
                                    'huddinge', 'sollentuna', 'tyresö', 'bromma',
                                    'enskild', 'södertälje', 'kista', 'östermalm'])

def is_event_permalink(url):
    p = urlparse(url)
    path = p.path.lower()
    host = (p.hostname or '').lower()
    if any(h in host for h in TICKET_HOSTS):
        return True
    return any(re.search(pat, path) for pat in EVENT_PATH_PATTERNS)

def is_ticket_platform_host(url):
    host = (urlparse(url).hostname or '').lower()
    return any(h in host for h in TICKET_HOSTS)

def is_stale(last_run, days=STALE_DAYS):
    if not last_run: return True
    try:
        d = datetime.fromisoformat(last_run.replace('Z', '+00:00'))
        return (datetime.now(timezone.utc) - d).days > days
    except:
        return False

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv

    sources = {}
    for fn in sorted(os.listdir(SOURCES_DIR)):
        if not fn.endswith('.jsonl'): continue
        with open(os.path.join(SOURCES_DIR, fn)) as fh:
            for line in fh:
                if not line.strip(): continue
                o = json.loads(line)
                sources[o['id']] = ({**o, '_file': fn})

    status = {}
    with open(STATUS_FILE) as fh:
        for line in fh:
            if not line.strip(): continue
            o = json.loads(line)
            status[o['sourceId']] = o

    to_remove = []
    for sid, o in sources.items():
        if sid in PROTECTED_SOURCES:
            continue
        url = o.get('url', '')
        st = status.get(sid, {})
        meta = o.get('metadata') or {}
        city = meta.get('rawCity') or o.get('city') or ''

        reasons = []
        if is_event_permalink(url):
            reasons.append('event-permalink-pattern')
        if is_ticket_platform_host(url):
            reasons.append('ticket-platform-host')
        if is_stale(st.get('lastRun')) and not is_sthlm(city):
            reasons.append('stale-non-sthlm')

        if reasons:
            to_remove.append({
                'sourceId': sid,
                'url': url,
                'name': o.get('name'),
                'city': city,
                'reasons': reasons,
                'lastRun': st.get('lastRun'),
                'status': st.get('status'),
                'file': o['_file'],
            })

    counts = {}
    for r in to_remove:
        for reason in r['reasons']:
            counts[reason] = counts.get(reason, 0) + 1
    print(f'=== CLEANUP {"DRY-RUN" if dry_run else "LIVE"} ===')
    print(f'Total sources: {len(sources)}')
    print(f'To remove: {len(to_remove)} ({len(counts)} reasons):')
    for k, v in sorted(counts.items(), key=lambda x: -x[1]):
        print(f'  {k:30s} {v}')

    if dry_run:
        print('\nFirst 5 of each category:')
        for reason in counts:
            sample = [r for r in to_remove if reason in r['reasons']][:5]
            print(f'\n  [{reason}]')
            for r in sample:
                print(f'    {r["sourceId"]:35s} {r["url"][:60]}')
        return

    print(f'\nArchiving to: {ARCHIVE_DIR}')
    print(f'Audit log: {AUDIT_FILE}')
    response = input('Proceed? (yes/no): ')
    if response.lower() != 'yes':
        print('Aborted.')
        return

    os.makedirs(ARCHIVE_DIR, exist_ok=True)

    with open(AUDIT_FILE, 'w') as fh:
        for r in to_remove:
            fh.write(json.dumps({
                'auditType': 'source-cleanup',
                'date': DATE,
                **r,
            }) + '\n')

    moved = 0
    for r in to_remove:
        src = os.path.join(SOURCES_DIR, r['file'])
        dst = os.path.join(ARCHIVE_DIR, r['file'])
        if os.path.exists(src):
            shutil.move(src, dst)
            moved += 1
    print(f'Moved {moved} files to archive.')

    removed_ids = {r['sourceId'] for r in to_remove}
    kept = []
    with open(STATUS_FILE) as fh:
        for line in fh:
            if not line.strip(): continue
            o = json.loads(line)
            if o['sourceId'] not in removed_ids:
                kept.append(line)
    with open(STATUS_FILE, 'w') as fh:
        fh.writelines(kept)
    print(f'Filtered sources_status.jsonl: {len(status)} → {len(kept)} rows.')

    for sid in PROTECTED_SOURCES:
        if sid not in sources:
            print(f'  - {sid} not in registry (ok)')
        elif sid in removed_ids:
            print(f'  ❌ BUG: protected source {sid} was marked for removal!')
        else:
            print(f'  ✓ Protected {sid} preserved')

    print(f'\n✅ Done. {len(to_remove)} sources removed.')
    print(f'   Archive: {ARCHIVE_DIR}')
    print(f'   Audit:   {AUDIT_FILE}')

if __name__ == '__main__':
    main()
