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
LATEST=$(ls -t runtime/ingestion-cron/steps/tribe-events-*.log 2>/dev/null | head -1)

# 2. Vilka wp-json URL:er försökte den?
grep -oE 'https://[^ ]+/wp-json/tribe/events/v1/events' "$LATEST" | sort -u

# 3. Häng-detektion: samma URL >5 ggr i rad = evig-loop (inte retry)
URLS=$(grep -oE 'https://[^ ]+/wp-json/tribe/events/v1/events' "$LATEST")
echo "$URLS" | sort | uniq -c | sort -rn | head -5
# → förväntat: counts < 5 (varje URL hämtas 1–2 ggr)
#    tribe-häng 2026-10-18: samma URL ~83k+ ggr (while-true utan page++ i persist-grenen)

# 4. Förväntat slut-tillstånd
grep -E "^─── tribe-events" "$LATEST" | tail -1
# → '─── tribe-events finished ... exit=0 duration=~180000ms'
```

Bevis: filen `runtime/ingestion-cron/steps/tribe-events-<ISO>.log`. Green = `exit=0` + minst 1 `total=N, total_pages=K`-rad per URL + inga 5xx i >5 returer.

## Gotchas

**Evig-loop på `page++`-väg.** tribe-events hängde 2026-10-16–18 med samma URL 83 778 ggr i rad. Orsak: `scripts/ingest-tribe-events.mjs:80` har `while (true) { ... }` där `page++` bara sker i `if (dryRun || future.length === 0)`-grenen. När `future.length > 0` persisteras events men page inkrementeras aldrig → fast på samma page.

**5 hosts hårdkodade inline** i `scripts/ingest-tribe-events.mjs:28-34`. aik + aik-se-kalender delar samma `baseUrl`, så det är 4 unika hosts. Inte laddade från `sources/*.jsonl`.

**Ingen `fetchWithRetry` / backoff** — scriptet använder plain `fetch` + `sleep(RATE_LIMIT_MS)`. Ett 5xx-svar ger `break` (inte retry). Vid ihållande 5xx på en host → bara den hosten skip, resten körs.

**Cron-flagga `--pages=10` hårdkodad** i `scripts/ingestion-cron.ts:296`. Ändra via `--skip-tribe` om du vill stänga av utan att röra cron.

**Watchdog sätter stage som stale efter 2h**, men cron-processen lever. Manuellt: `kill <cron-pid>` för att frigöra watchdog-flaggan (`runtime/watchdog.json:stale=true`).