# sitemap-discovery

Generic sitemap.xml parser — crawlar ALLA sources sitemap, filtrerar event-pattern URLs, extraherar events (JSON-LD + microdata + `<time datetime>` HTML-heuristik) direkt till Supabase.

## Sub-features

- Source-lista: 196+ sources i `sources/*.jsonl` (skippar `_`-prefexade)
- Sitemap discovery: hittar `sitemap.xml`, `sitemap_index.xml`
- URL-filtrering: mot event-pattern regex (år-månad, `/events/`, `/event/`, etc.)
- Concurrency: 20 workers (`CONCURRENCY=20`, override via `SITEMAP_CONCURRENCY` env)
- Output: SKRIV direkt till Supabase `events`-tabell. **Skapar INTE `runtime/postB-preC/*.jsonl`-filer** — output är tabellrader.

## How to get to it (user POV)

Användaren ser sitemap-discovery som det steg som "hittar events från sajter vi inte visste hade events". Om en sajt plötsligt har många nya events i grafén är det ofta sitemap-discovery som hittat dem.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Senaste sitemap-discovery-körning
LATEST=$(ls -t runtime/ingestion-cron/steps/sitemap-discovery-*.log 2>/dev/null | head -1)

# 2. Vilka sajter besöktes?
grep -oE 'sitemap[^ ]*\.xml' "$LATEST" | sort -u | head -20

# 3. Hur många URLs extraherades?
grep -E "^sitemap_urls=" "$LATEST" || echo "(no total line)"
# Logformat: 'sitemap_urls=N event_urls=N fetched=N persisted=N duplicates=N errors=N'

# 4. Förväntat slut-tillstånd
grep -E "^─── sitemap-discovery" "$LATEST" | tail -1
# → exit=0 duration=~600000ms (10 min)

# 5. Jämför pre/post-counts i Supabase
# (använd supabase-cli eller psql mot projektet)
echo "SELECT COUNT(*) FROM events WHERE created_at > now() - interval '24 hours' AND source ~ 'sitemap';"
```

Bevis: `runtime/ingestion-cron/steps/sitemap-discovery-<ISO>.log` + Supabase `events`-tabell (inte filer lokala filer).

## Gotchas

**Lång runtime (~10 min).** Förvänta 10+ heartbeats. Om heartbeat-loggen visar <5 heartbeats men `step-end` finns → steget startade nyss, för tidigt att döma.

**`--max-sources=999 --max-per-source=15` hårdkodade** i cron (`scripts/ingestion-cron.ts:302-306`). Sänker `--max-per-source=30`-default i scriptet till 15 för cron-körningar.

**Ingen `runtime/postB-preC/`-output.** Tidigare dokumentation påstod det; scriptet skriver direkt till Supabase. Verifiera mot events-tabellen, inte mot filer.

**Log-format:** `  <slug>: sitemap=N events=N fetched=N persisted=N dupes=N errors=N` per källa, `sitemap_urls=N event_urls=N ...` som total-rad.

**Häng-pattern:** sitemap discovery har historiskt fastnat på sajter med ogiltiga sitemap-XML (parse error → obehandlad exception). Watchdog-flagg = `heartbeat age > 2h` på step `sitemap-discovery`.

**IGNORERA inte `--skip-sitemap`** utan att först veta vad du skippar: det är primär discovery-källa för nya event-sajter.