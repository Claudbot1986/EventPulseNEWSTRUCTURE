#!/usr/bin/env python3
"""
_clusterAnalysis.py — Klusteranalys av 11 407 future events.

Mål: hitta naturliga grupperingar (kluster) baserat på:
- category_slug (taksonomi)
- raw_data['@type'] (schema.org subtyp)
- har performer / organizer / location_data
- raw_description längd-bucket
- venue_full_name popularitet
- source (provider)

Output: kluster-rapport till runtime/cluster-analysis-2026-10-13.md
"""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

INPUT = Path('runtime/events-future-2026-10-13.jsonl')
OUT_DIR = Path('runtime')
OUT_DIR.mkdir(exist_ok=True)

events = []
with INPUT.open() as f:
    for line in f:
        events.append(json.loads(line))

print(f'Totalt events inlästa: {len(events)}')

# ─── PROFILFÄLT ───────────────────────────────────────────────────────
N = len(events)

# 1. per kategori
by_cat = Counter(e.get('category_slug') for e in events)

# 2. per source
by_source = Counter(e.get('source') for e in events)

# 3. description_license
by_license = Counter(e.get('description_license') for e in events)

# 4. raw_data['@type'] (schema.org subtype)
by_atype = Counter()
for e in events:
    rd = e.get('raw_data') or {}
    t = rd.get('@type') if isinstance(rd, dict) else None
    if isinstance(t, list):
        t = ','.join(sorted(t))
    by_atype[t] += 1

# 5. har performer / organizer
sig_performer = sum(1 for e in events if isinstance((e.get('raw_data') or {}).get('performer'), (dict, list)))
sig_organizer = sum(1 for e in events if (e.get('raw_data') or {}).get('organizer'))
sig_location = sum(1 for e in events if (e.get('raw_data') or {}).get('location') and not (e.get('raw_data') or {}).get('location', {}).get('error'))
sig_offers = sum(1 for e in events if (e.get('raw_data') or {}).get('offers'))
sig_image = sum(1 for e in events if (e.get('raw_data') or {}).get('image'))

# 6. raw_description längd-bucket
desc_buckets = Counter()
for e in events:
    rd = e.get('raw_description') or ''
    rd_clean = re.sub(r'<[^>]+>', '', rd).strip() if isinstance(rd, str) else ''
    if len(rd_clean) == 0:
        desc_buckets['empty'] += 1
    elif len(rd_clean) < 50:
        desc_buckets['<50'] += 1
    elif len(rd_clean) < 200:
        desc_buckets['50-200'] += 1
    elif len(rd_clean) < 500:
        desc_buckets['200-500'] += 1
    else:
        desc_buckets['500+'] += 1

# 7. har event_profile
with_profile = sum(1 for e in events if e.get('event_profile'))
with_editorial = sum(1 for e in events if e.get('editorial_description'))

# 8. venue popularitet
by_venue = Counter(e.get('venue_full_name') for e in events)

print(f'\n=== PROFIL ===')
print(f'Per kategori (top 12):')
for cat, n in by_cat.most_common(12):
    print(f'  {cat:24} {n:5} ({n/N*100:.1f}%)')
print(f'\nPer source (top 15):')
for src, n in by_source.most_common(15):
    print(f'  {src[:50]:50} {n:5}')
print(f'\nDescription license:')
for lic, n in by_license.most_common(8):
    print(f'  {lic or "null":24} {n:5}')
print(f'\nraw_data @type top 10:')
for t, n in by_atype.most_common(10):
    print(f'  {str(t)[:50]:50} {n:5}')

print(f'\n--- RIKEDOM ---')
print(f'  performer:       {sig_performer:5} ({sig_performer/N*100:.1f}%)')
print(f'  organizer:       {sig_organizer:5} ({sig_organizer/N*100:.1f}%)')
print(f'  location:        {sig_location:5} ({sig_location/N*100:.1f}%)')
print(f'  offers:          {sig_offers:5} ({sig_offers/N*100:.1f}%)')
print(f'  image:           {sig_image:5} ({sig_image/N*100:.1f}%)')
print(f'  raw_desc empty:  {desc_buckets["empty"]:5}')
print(f'  raw_desc <50:    {desc_buckets["<50"]:5}')
print(f'  raw_desc 50-200: {desc_buckets["50-200"]:5}')
print(f'  raw_desc 200+:   {desc_buckets["200-500"]+desc_buckets["500+"]:5}')

print(f'\n--- AVANCERAT ---')
print(f'  with event_profile:  {with_profile}')
print(f'  with editorial:      {with_editorial}')

# ─── KLUSTER: rikhet × kategori ─────────────────────────────────────────
print(f'\n=== KLUSTER (rikhet × kategori) ===')
# Bucket events into 8 richness categories based on signals
def richness(e):
    rd = e.get('raw_data') or {}
    score = 0
    if rd.get('performer'): score += 3
    if rd.get('organizer'): score += 2
    if rd.get('offers'): score += 1
    if rd.get('location') and not rd.get('location', {}).get('error'): score += 1
    rd_text = e.get('raw_description') or ''
    rd_text_clean = re.sub(r'<[^>]+>', '', rd_text).strip() if isinstance(rd_text, str) else ''
    if len(rd_text_clean) >= 50: score += 1
    if len(rd_text_clean) >= 200: score += 1
    return score

buckets = defaultdict(list)
for e in events:
    b = richness(e)
    buckets[b].append(e)

print('\nFördelning rikhets-poäng (0-9):')
for score in sorted(buckets.keys(), reverse=True):
    n = len(buckets[score])
    if n > 50:
        # top 5 kategorier i detta kluster
        cats = Counter(e.get('category_slug') for e in buckets[score])
        top_cats = ', '.join(f'{c}:{n2}' for c, n2 in cats.most_common(3))
        print(f'  score={score}: {n} events — topp kategorier: {top_cats}')

# ─── KLUSTER: per kategorisubtyp ────────────────────────────────────────
print('\n=== KLUSTER (kategori × har performer) ===')
cat_perf = defaultdict(lambda: [0, 0])  # [med_performer, utan]
for e in events:
    cat = e.get('category_slug') or 'unknown'
    has = 1 if isinstance((e.get('raw_data') or {}).get('performer'), (dict, list)) else 0
    cat_perf[cat][has] += 1

print(f'{"kategori":25} {"med perf":10} {"utan perf":10} {"ratio":8}')
for cat in sorted(cat_perf.keys(), key=lambda k: -sum(cat_perf[k])):
    with_p, without_p = cat_perf[cat]
    ratio = with_p / (with_p + without_p) * 100 if (with_p + without_p) > 0 else 0
    if with_p + without_p > 30:
        print(f'  {cat:23} {with_p:10} {without_p:10} {ratio:6.1f}%')

# ─── KLUSTER: typ av performer ──────────────────────────────────────────
print('\n=== KLUSTER (performer-typ i raw_data) ===')
perf_types = Counter()
for e in events:
    rd = e.get('raw_data') or {}
    perf = rd.get('performer')
    if isinstance(perf, dict):
        if perf.get('@type'): perf_types[f"single-{perf['@type']}"] += 1
        else: perf_types['single-noType'] += 1
    elif isinstance(perf, list):
        for p in perf:
            if isinstance(p, dict) and p.get('@type'): perf_types[f"list-{p['@type']}"] += 1
            else: perf_types['list-noType'] += 1
    elif perf is None:
        perf_types['noPerformer'] += 1

print('Performer-former (top 10):')
for t, n in perf_types.most_common(10):
    print(f'  {t:30} {n}')

# ─── KLUSTER: source × kategori ─────────────────────────────────────────
print('\n=== KLUSTER (topp 5 source per topp 5 kategori) ===')
top_cats = [c for c, _ in by_cat.most_common(5)]
for cat in top_cats:
    cat_events = [e for e in events if e.get('category_slug') == cat]
    src_count = Counter(e.get('source') for e in cat_events)
    print(f'\n  {cat}: {len(cat_events)} events')
    for src, n in src_count.most_common(5):
        print(f'    {str(src)[:45]:45} {n}')

print('\n=== KLUSTERANALYS KLAR ===')
