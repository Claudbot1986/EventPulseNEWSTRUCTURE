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
#   "  paddan: vägrade vår förfrågan (svarskod 403)"
#   "  riksarkivet: gick inte att nå (ETIMEDOUT)"

# 4. Förväntat slut-tillstånd
grep -A1 "=== TOTAL ===" "$LATEST" | tail -1
# → fetched=359 future=347 persisted=0 duplicates=347 errors=1 refused=7 unreachable=1 empty=121
grep -E "^─── direct-jsonld finished" "$LATEST"
# → exit=0 duration=~40s för 139 sources
```

Bevis: `runtime/ingestion-cron/steps/direct-jsonld-<ISO>.log` + Supabase `events`-tabell.

## Vägran ≠ transportfel (2026-10-28)

Skriptet skiljer på tre utfall, och kedjan klassar dem olika:

| Utfall | Vad det betyder | Kedjan |
|---|---|---|
| 2xx | Vi fick HTML | klart |
| 4xx / 5xx | Servern **svarade men nekade** (bot-spärr, rate limit) | `DEGRADED` — försämring, steget går inte rött |
| kastat fel | Nätverket nådde inte fram (timeout, DNS) | `DEGRADED` per källa — rött först om världen är trasig |

Utfallen mäts i `refused=` och `unreachable=` i TOTAL-raden.

**Varför detta ändrades.** Den gamla koden skrev "fetch failed" för både
vägran och transportfel. "fetch failed" är en transportmarkör i
`scripts/lib/net-error.mjs`, så kedjan gick röd med exit 69 — "nätet dog" —
medan 129 av 139 källor svarade normalt. Mätt 2026-10-28: 7 källor svarade
403/429, 1 (riksarkivet.se) svarade inte inom 12 s.

**Exitkoderna för steget:**

| Exit | Betyder |
|---|---|
| 0 | Steget gick igenom. Försämringar syns i `degradedSteps` i `status.json`. |
| 69 | Ingen källa svarade alls, eller mer än hälften gick inte att nå → världen är trasig |
| 75 | Alla källor svarade men nekade → inget kom in, men ingenting är trasigt |

## Gotchas

**Ingen retry** — en källa som inte svarar hoppas över i körningen. Men
källan är inte "permanent trasig": nästa natt försöks den igen, och en
källa som nekades av en bot-spärr kan svara nästa gång.

**Degraderingar går till stderr med `DEGRADED`-markör.** Kedjan läser
stderr och klassar raderna. En DEGRADED-rad räknas som *rapporterad
försämring* — kedjan går inte röd, men steget syns i `degradedSteps`.
Utan markören skulle samma rad klassas som transportfel (exit 69).

**Concurrency styrs via env** (`JSONLD_CONCURRENCY`), inte CLI. Sänker concurrency → längre runtime. Ökar → risk för rate-limit hos målsajter.

**Sweeper alla working-sources** — `sources/_quarantined.jsonl` och liknande exkluderas automatiskt via fil-prefix.

**12 s/req timeout** — JS-tunga sidor kan behöva Scrapingbee (D-renderGate) istället. direct-jsonld är plain `fetch` utan render.