# direct-jsonld

Generic JSON-LD extractor för källor med strukturerad data på landing-sidan (utan sitemap).

## Sub-features

- Sweepar ALLA `sources/*.jsonl` (230 källor per 2026-10-21)
- Parsar `<script type="application/ld+json">`-block med `cheerio`
- Extraherar `Event` + `ItemList`-inbäddade events (per `extractEvent` helper). **Ingen `SocialEvent`** — scriptet matchar bara `Event` (rad 78) och `ItemList` (rad 82/94).
- Concurrency: 10 workers (`JSONLD_CONCURRENCY` env, default 10)
- Per-request timeout: 12 s (`PER_REQUEST_TIMEOUT = 12000`)
- Pushar till `raw_events`-kö

## How to get to it (user POV)

Användaren ser direct-jsonld som "sajter som inte har en sitemap fångas ändå". Output persisteras via `raw_events` → workern. Speciellt viktig för källor som `dansenshus`, `nalen`, `stampen` som saknar sitemap men har JSON-LD på event-sidor.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Senaste direct-jsonld-körning
LATEST=$(ls -t runtime/ingestion-cron/steps/direct-jsonld-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)

# 2. Hur många sources processades?
grep -E "^Direct JSON-LD ingestion" "$LATEST"

# 3. Vilka källor gav events?
grep -E "fetched=.*future=.*persisted=" "$LATEST" | head -10
# Per-källraden har TVÅ inledande blanksteg och INGEN "[" — t.ex.
#   "  artipelag: no future events (fetched=0)"
#   "  paddan: fetch failed"

# 4. Förväntat slut-tillstånd
grep -A1 "=== TOTAL ===" "$LATEST" | tail -1
# → fetched=490 future=481 persisted=249 duplicates=232 errors=217
grep -E "^─── direct-jsonld finished" "$LATEST"
# → exit=0 duration=~23s för 230 sources
```

Bevis: `runtime/ingestion-cron/steps/direct-jsonld-<ISO>.log` + Supabase `events`-tabell.

## Gotchas

**Ingen retry på failure** — `try/catch → return null`, men ingen backoff. Källa med enstaka 5xx skip:as permanent.

**Concurrency styrs via env** (`JSONLD_CONCURRENCY`), inte CLI. Sänker concurrency → längre runtime. Ökar → risk för rate-limit hos målsajter.

**Sweeper alla working-sources** — `sources/_quarantined.jsonl` och liknande exkluderas automatiskt via fil-prefix.

**12 s/req timeout** — JS-tunga sidor kan behöva Scrapingbee (D-renderGate) istället. direct-jsonld är plain `fetch` utan render.