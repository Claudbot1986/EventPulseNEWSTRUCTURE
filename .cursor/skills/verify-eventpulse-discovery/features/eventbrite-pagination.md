# eventbrite-pagination

Paginerad Eventbrite Stockholm-ingestion. Standalone .mjs (ingen tsx-overhead), pushar till `raw_events` BullMQ-kö.

## Sub-features

- 7 city-slugs: `stockholm` + 6 distrikt (`sodermalm`, `vasastan`, `kungsholmen`, `bromma`, `hagersten`, `lidingo`)
- Forward pagination: `--months=N` (default 3 i cron, 6 i manuell)
- JSON-LD `ItemList`-extraktion från `eventbrite.com/d/sweden--stockholm/...`
- Rate-limit: 1 req / 3s (`RATE_LIMIT_MS = 3000`)
- Pushar till `raw_events`-kö (T0201.5) → workern kör normalizer + dedup + T0201

## How to get to it (user POV)

Användaren ser eventbrite-pagination som "nya eventbrite-events dyker upp i grafén". Output persisteras via `raw_events` → workern → `events`-tabell. Effekten syns i Stockholms event-graf och i agent-responsen.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Senaste eventbrite-körning
LATEST=$(ls -t runtime/ingestion-cron/steps/eventbrite-pagination-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)

# 2. Hur många events per stad?
grep -E "^\s*\[" "$LATEST" | head -20
# → '[stockholm 2026-10-01] fetched=20 future=15 new=8 (page)'

# 3. Förväntat slut-tillstånd
grep -E "^─── eventbrite-pagination finished" "$LATEST" | tail -1
# → exit=0 duration=~21s

# 4. Total events
sed -n '/=== TOTAL ===/,+2p' "$LATEST"
# → fetched=60 future=42 persisted=24 duplicates=18  +  "DB eventbrite-stockholm count: 87"
```

Bevis: `runtime/ingestion-cron/steps/eventbrite-pagination-<ISO>.log` + Supabase `events`-tabell (efter workern dränerat).

## Gotchas

**`redirect: 'manual'` + rekursiv `fetchPage(loc)`** — kan teoretiskt orsaka oändlig redirect-loop om Eventbrite returnerar samma URL. Inga max-retries i koden.

**Ingen backoff på 5xx** — `if (!r.ok) return null` → continue till nästa stad. En enda 5xx dödar bara en (stad, månad)-kombination.

**City-slugs är hårdkodade** (`CITY_SLUGS` rad 25-33). Om Eventbrite byter slug-struktur → tyst fel (stad skip:as).

**Respekterar BACKLOG.md rate-limit 1 req/3s** — ökad `--months` → linjär ökning av runtime (3s × städer × månader).