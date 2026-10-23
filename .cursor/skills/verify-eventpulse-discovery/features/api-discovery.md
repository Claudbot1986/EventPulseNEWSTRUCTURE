# api-discovery

Hidden API endpoint discovery. Scannar ALLA sources efter fetch/axios/GraphQL/`__NEXT_DATA__`-mönster → output till `data/api-discovery-results.jsonl`.

## Sub-features

- Sweepar `sources/*.jsonl` (working-state)
- Patterns detected: `fetch(...)`, `axios.get(...)`, `$.get(...)`, `__NEXT_DATA__`, `__NUXT__`, `window.__INITIAL_STATE__`, `wp-json`, `/api/v1/`, `GraphQL`, `wss://`, `__APOLLO_CLIENT__`
- `--max-age-days=N`: skippa om resultat-filen är färsk (default körs veckovis)
- Output: `data/api-discovery-results.jsonl` (JSONL per source: `slug, url, status, bodySize, htmlEndpoints, jsonLdEndpoints, nextData, nuxtData, apollo, graphqlHints, jsFilesScanned, jsEndpoints, jsonHints`)
- Fetch + parse JS bundles för att hitta endpoints

## How to get to it (user POV)

Användaren ser api-discovery som "vi lärde en sajt att den har ett dolt REST-API".

**Ingen kod läser `data/api-discovery-results.jsonl`.** Sökning i hela repot ger noll konsumenter utanför `discover-hidden-apis.mjs` själv. `ingest-tribe-events.mjs` har hårdkodade `/wp-json/tribe/events/v1/events`-URL:er — den läser inte resultatfilen, utan är handskriven utifrån samma mönster. Steget är **observerande, inte matande**, precis som subpath-discovery.

Konsekvens för verifiering: du kan bevisa att steget skannade, men inte att något kom till nytta. Rapportera det som producerat-underlag, inte som integrerad förmåga.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. chain-overview step-end
jq -r 'select(.event=="step-end" and .step=="api-discovery") | "exit=\(.exitCode) duration=\(.durationMs)ms"' \
  runtime/ingestion-cron/chain-overview.log | tail -3

# 2. Resultatfil
test -f data/api-discovery-results.jsonl && wc -l data/api-discovery-results.jsonl
# → växer över tid

# 3. Spot-checka — hittade tribe-API:er
grep -E "wp-json|graphql|__NEXT_DATA__" data/api-discovery-results.jsonl | head -5

# 4. Förväntat slut-tillstånd (log-path är stdout, filen via child-process)
ls -t runtime/ingestion-cron/steps/api-discovery-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1 | xargs grep -E "Sources to scan|done" | tail -5
```

Bevis: `chain-overview.log` step-end + `data/api-discovery-results.jsonl` (innehåll) + per-step log (sources scanned).

## Gotchas

**Ingen timeout på JS-bundle-fetches** (inom `discover()`) — kan hänga om en sajt serverar 10 MB JS långsamt. AbortController finns för HTML-fetchen (10 s) men inte för JS-bundle-fetches.

**`--max-age-days` skip-logik** — om filen är färsk än N dagar → process.exit(0) utan output. Bra för att undvika daglig rescan, men kan maskera faktiska körningar.

**Output till `data/`, inte `runtime/`** — git-tracked ibland. Verifiera pathen explicit.

**Skippar sources med icke-http-URLs** (`data.url.startsWith('http')` krävs inte explicit i koden, men `fetch(src.url)` kommer krascha vid `ftp://` etc).