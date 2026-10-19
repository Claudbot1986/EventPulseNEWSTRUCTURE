# livespot

Livespot.se REST-API för Stockholm events (5 494 events i API:t, paginerat).

## Sub-features

- Endpoint: `https://livespot.se/api/events?city=Stockholm&page=N&limit=100&startDate=...&endDate=...`
- Rate-limit: 1 s/req (`RATE_LIMIT_MS = 1000`)
- Pagination: `--pages=6` i cron (600 events/natt), `--pages=999` default
- Datumfilter: `--start-date=YYYY-MM-DD`, `--end-date=YYYY-MM-DD`
- Kategori-mappning: livespot-råsträngar (`Teater`, `Musik`, `Standup`) → kanon-slugs (`theater`, `music→concert`, `standup`) via `normalizeLivespotCategories`
- Pushar till `raw_events`-kö (T0201)

## How to get to it (user POV)

Användaren ser livespot som "den största källan för community-events i Stockholm". Livespot är en publik plattform som samlar events från många venues. Output via workern → events-tabellen.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Senaste livespot-körning
LATEST=$(ls -t runtime/ingestion-cron/steps/livespot-stockholm-*.log 2>/dev/null | head -1)

# 2. Hur många events hämtades?
grep -E "(page|fetched|persisted|errors)" "$LATEST" | tail -10

# 3. Förväntat slut-tillstånd
grep -E "^─── livespot-stockholm" "$LATEST" | tail -1
# → exit=0 duration=~10 min (6 pages × 100 events + 1s rate-limit)

# 4. Spot-checka kategorier
grep -E "category|Teater|Musik|Standup" "$LATEST" | head -5
```

Bevis: `runtime/ingestion-cron/steps/livespot-stockholm-<ISO>.log` + Supabase `events.category_slug`-fördelning.

## Gotchas

**Ingen abort-controller på fetch** — `fetchPage` har ingen timeout. Livespot-API:t har historiskt varit stabilt men om det hänger → stage hänger.

**`--pages=999` default** är farlig — kan teoretiskt köra i timmar. Cron sätter `--pages=6` explicit. Manuell körning utan `--pages=N` → potentiell runaway.

**Kategori-mappning är partiell** — okända livespot-kategorier lämnas som råsträngar, normalizern fallback-hanterar via `categoryKeywords.ts`. Verifiera att okända kategorier inte blir NULL.

**Livespot JSON-LD saknar ibland tid** (verifierat 2026-10-14, livespot Matt Hansen) — `startDate` finns men `startTime` saknas. UI visar "Tid ej angiven" (se `06-UI/i18n/strings/sv.js:40`).