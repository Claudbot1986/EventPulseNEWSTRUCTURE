# tribe-events

The Events Calendar WordPress REST API — generisk fetcher för 5 hardkodade WP-sajter. Häng-pattern 2026-10-18.

## Sub-features

- WP-JSON pagination: `/wp-json/tribe/events/v1/events?per_page=50&page=N&start_date=<today>&order=asc` (5 hosts hårdkodade inline i `TRIBE_SOURCES`)
- BullMQ `raw_events`-kö (inte direkt Supabase-upsert) — workern dränerar och persisterar
- Dedup via `dedup_hash = sha256(slug::title::startTime)`
- Rate-limit: 2 s/req (`RATE_LIMIT_MS = 2000`), `--pages=10` max

## How to get to it (user POV)

Användaren märker tribe-events när dashboard 7777 visar stale på `tribe-events`-steget, eller när hen öppnar Stockholm-event-grafen och saknar events från WP-sajter (aik, formex, allamassor/kungstradgarden, stockholmsmassan). Nattkörningen startar `tribe-events` kl 02:00 och är tänkt att ta ~3 min.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Senaste tribe-körning
LATEST=$(ls -t runtime/ingestion-cron/steps/tribe-events-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)

# 2. Vilka wp-json URL:er försökte den?
grep -oE 'https://[^ ]+/wp-json/tribe/events/v1/events' "$LATEST" | sort -u

# 3. Häng-detektion: samma URL >5 ggr i rad = evig-loop (inte retry)
# 3. Regressionskontroll av den historiska evighets-loopen
grep -cE '^\s+total=[0-9]+, total_pages=[0-9]+' "$LATEST"
# → 5 (en per källa). Lägre = någon källa avslutade utan att paginera klart.

# 4. Förväntat slut-tillstånd
grep -A1 "=== TOTAL ===" "$LATEST" | tail -1
# → fetched=548 persisted=0 duplicates=528 errors=0
grep -E "^─── tribe-events finished" "$LATEST" | tail -1
# → exit=0 duration=~47s
```

Bevis: filen `runtime/ingestion-cron/steps/tribe-events-<ISO>.log`. Green = `exit=0` + 5 st `total=N, total_pages=K`-rader + TOTAL-rad med `errors=0`.

**`wp-json`-URL:er skrivs aldrig till loggen.** Det URL-grep som tidigare stod här returnerade alltid tomt resultat — det fanns aldrig något att hitta. Använd antalet `total=`-rader i stället.

## Gotchas

**Evig-loop-felet är FIXAT (2026-10-19, commit `d846cb44`).** tribe-events hängde 2026-10-16–18 med samma URL 83 778 ggr i rad. Orsak: `while (true)` där `page++` bara skedde i `if (dryRun || future.length === 0)`-grenen. Nu finns `page++` även efter persist-vägen (`ingest-tribe-events.mjs:231`). Verifiera regression med `fetched=548 persisted=0 duplicates=528` — ren sidpaginering. **Om du ser `queued:` upprepas utan att `page N:` växler → buggen är tillbaka.**

**Rätt loggrecept.** `queued: N` skrivs UTAN `page N:`-prefix (`rad 230`), så `grep "page [0-9]+: queued"` ger alltid noll träffar. Rätt mönster är `^\s+total=[0-9]+, total_pages=[0-9]+` (en rad per källa) — 5 träffar = alla 5 källor körda. Summary-raden per källa heter `<slug> done: fetched=N persisted=M duplicates=D`. `wp-json`-URL:er skrivs aldrig till loggen, så URL-grepet i SKILL.md ger tomt resultat varje gång.

**5 hosts hårdkodade inline** i `scripts/ingest-tribe-events.mjs:28-34`. aik + aik-se-kalender delar samma `baseUrl`, så det är 4 unika hosts. Inte laddade från `sources/*.jsonl`.

**Ingen `fetchWithRetry` / backoff** — scriptet använder plain `fetch` + `sleep(RATE_LIMIT_MS)`. Ett 5xx-svar ger `break` (inte retry). Vid ihållande 5xx på en host → bara den hosten skip, resten körs.

**Cron-flagga `--pages=10` hårdkodad** i `scripts/ingestion-cron.ts:296`. Ändra via `--skip-tribe` om du vill stänga av utan att röra cron.

**Watchdog sätter stage som stale efter 2h**, men cron-processen lever. Manuellt: `kill <cron-pid>` för att frigöra watchdog-flaggan (`runtime/ingestion-cron/watchdog.json:stale=true`).