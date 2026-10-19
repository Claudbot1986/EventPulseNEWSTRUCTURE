# etag-refresh

P2B dedup-cache: uppdaterar body-hash + etag för ALLA working-sources så efterföljande körningar skippar nedladdning av oförändrade sidor.

## Sub-features

- Läser URL-pool från `sources/*.jsonl` (working-state, exkluderar quarantined/retired)
- `refreshCache()` med `concurrency=5` (hårdkodad, inte CLI-exponerad)
- Body-hash → `etagCache` (modul i samma katalog)
- Loggar till `runtime/etag-refresh.log` (separat log-path, INTE `runtime/ingestion-cron/steps/`)
- Returnerar `RefreshStats { totalChecked, cacheHits, cacheMisses, errors, durationMs }`

## How to get to it (user POV)

Användaren ser etag-refresh som "subsequent körningar är snabbare". Effekten är indirekt: fler cache-hits i efterföljande A/B/C-steg = färre HTTP-requests = lägre Scrapingbee-kostnad + snabbare körning.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Senaste etag-refresh-körning (separat log-path!)
tail -50 runtime/etag-refresh.log

# 2. Hur många URLs kollades?
grep -E "refreshing" runtime/etag-refresh.log | tail -3

# 3. Förväntat slut-tillstånd
grep -E "(RefreshStats|durationMs|cacheHits|cacheMisses)" runtime/etag-refresh.log | tail -5

# 4. chain-overview step-end (separat från fil-loggen!)
jq -r 'select(.event=="step-end" and .step=="etag-refresh") | "exit=\(.exitCode) duration=\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -3
# → exit=0 duration=~30s för 100 URLs
```

Bevis: `runtime/etag-refresh.log` + `chain-overview.log` step-end.

## Gotchas

**Log-path INTE i `runtime/ingestion-cron/steps/`** — `02-Ingestion/tools/etagRefresh.ts:11` specificerar `runtime/etag-refresh.log`. Verify-skill:ens hung-detect kan missa etag-refresh om man bara tittar på chain-overview.

**Concurrency hårdkodad till 5** (`runEtagRefresh` rad 59). Inte CLI-exponerad — ändra i source om du vill ha annat.

**Exkluderar quarantined/retired sources automatiskt** (rad 45-46) — bra för working-state men kan missa "almost working" källor.

**Läser ENDAST working-sources första rad** — om en source har alternativa URLs i `urlbank`, laddas de inte heller. Begränsad täckning.