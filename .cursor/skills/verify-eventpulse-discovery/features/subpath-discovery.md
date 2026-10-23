# subpath-discovery

Auto-discover event subpaths per source. Probar 19 kända event-subpaths per source och skriver resultat till `data/subpath-discovery-results.jsonl`.

## Sub-features

- 19 subpaths: `/events`, `/evenemang`, `/event`, `/program`, `/kalender`, `/calendar`, `/forestallning`, `/forestallningar`, `/konsert`, `/konserter`, `/show`, `/shows`, `/agenda`, `/pagar`, `/whatson`, `/whats-on`, `/utstallning` m.fl.
- Source-lista: alla källor i `sources/*.jsonl` (default `--max-sources=999`); rate-limit 0.5 s/req (`RATE_LIMIT_MS = 500`); 6 s/host timeout
- Output: skriver JSONL till `data/subpath-discovery-results.jsonl` (skapar INTE `runtime/ingestion-cron/steps/subpath-discovery-*.log`-filer — scriptet kör via `node scripts/discover-subpaths.mjs`, output hamnar via stdout + jsonl)

## How to get to it (user POV)

Användaren ser subpath-discovery som "vi lärde en sajt att den har en events-sida". Output persisteras i `data/subpath-discovery-results.jsonl`.

**Ingen kod läser den filen.** Sökning i hela repot efter `subpath-discovery-results` ger noll konsumenter utanför scriptet självt och denna skill. `discoverySearch.ts` parsar inga subpath-resultat. Steget är alltså **observerande, inte matande** — det producerar underlag för en människa, inte en automatisk handläggning. Tidigare versioner av den här texten påstod att P3A konsumerar filen; det är fel.

Konsekvens: 17 av 230 källor hittade en events-subpath i nattens körning, men ingen av dem blev automatiskt tillagd som källa. Vill du att de ska det behövs ett steg som läser filen och skriver `source_candidates` — det finns inte.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. Senaste subpath-körning
LATEST=$(ls -t runtime/ingestion-cron/steps/subpath-discovery-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)

# 2. Vilka sajter gav nya fynd?
grep -E "(found|discovered|subpath|FOUND|MISSING)" "$LATEST" | head -20

# 3. Hur lång var körningen?
grep -E "^─── subpath-discovery" "$LATEST" | tail -1

# 4. Output-fil: data/subpath-discovery-results.jsonl
test -f data/subpath-discovery-results.jsonl && wc -l data/subpath-discovery-results.jsonl
# → växer över tid

# 5. (Valfritt) kör smoke manuellt för att se nya fynd
node scripts/discover-subpaths.mjs --max-sources=5
```

Bevis: `runtime/ingestion-cron/steps/subpath-discovery-<ISO>.log` + `data/subpath-discovery-results.jsonl`.

## Gotchas

**Output går till `data/subpath-discovery-results.jsonl`, inte `sources/*.jsonl`.** Tidigare dokumentation påstod att source-filer uppdaterades — det stämmer inte. Scriptet appendar bara till JSONL. Eventuell wire-back till `sources/*.jsonl` sker i ett separat steg (eller för hand).

**Inga `runtime/ingestion-cron/steps/subpath-discovery-*.log`-filer** — scriptet kör stdout-only, men ingestion-cron fångar stdout och skriver per-step logs ändå (via `runStep` i `scripts/ingestion-cron.ts:185-261`).

**`--max-sources=999` hårdkodat.** Alla källor testas.

**19 subpaths hårdkodade** i `scripts/discover-subpaths.mjs:17-22`. `/events` förekommer dubblerat. Ändra genom att editera konstanten, inte via CLI.

**Rate-limit per host:** ~0.5 s per path × 19 paths × ~6 s timeout per host. Sajter med 5xx-svar blockerar inte (skip + nästa path), men kan ge timeout på 19 paths × 6s = 114s per host × 999 hosts = ~31h i värsta fall. Verifiera `--max-sources` om du vill korta ner.