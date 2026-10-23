# community-platforms

Fyra community-plattformar: luma (tech meetups), ra (electronic music), posh (social/party), reddit (cross-posts). **luma, ra och posh pushar till `raw_events`-kö. Reddit persisterar ingenting alls** — bara loggar kandidater.

## Sub-features

| Plattform | URL | Render | Rate-limit | Special |
|---|---|---|---|---|
| `luma-stockholm` | lu.ma (Next.js) | **Scrapingbee** (krävs) | 3 s/req | 5 kategorier: tech, business, social, health, arts |
| `ra-stockholm` | ra.co/events/se/stockholm | HTML+JSON-LD (eller Scrapingbee om satt) | 3 s/req | En sida (ingen pagination) |
| `posh-stockholm` | posh.vip/discover | **Scrapingbee** (krävs) | 2 s/req | Hårdkodade queries |
| `reddit-stockholm-events` | reddit.com/r/{Stockholm,StockholmEvents,SwedishEvents} | JSON API (ingen auth) | 3 s/req | Filtrerar `external_url` mot `KNOWN_EVENT_HOSTS` |

## How to get to it (user POV)

Användaren ser dessa fyra som "nischen dyker upp i grafén": luma = tech meetups, ra = electronic music, posh = party events, reddit = community cross-posts. Output via workern → events-tabellen.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# 1. chain-overview för alla 4
for STEP in luma-stockholm ra-stockholm posh-stockholm reddit-stockholm; do
  jq -r --arg s "$STEP" 'select(.event=="step-end" and .step==$s) | "\(.step)\texit=\(.exitCode)\tduration=\(.durationMs)ms"' \
    runtime/ingestion-cron/chain-overview.log | tail -1
done

# 2. Senaste log per steg — varje adapter har SIN egen loggformat
for STEP in luma-stockholm ra-stockholm posh-stockholm reddit-stockholm; do
  LATEST=$(ls -t runtime/ingestion-cron/steps/${STEP}-*.log 2>/dev/null | grep -v '\.err\.log$' | head -1)
  echo "=== $STEP ==="
  tail -5 "$LATEST" 2>/dev/null
done
# Referensvärden 2026-10-21:
#   luma    → "Total: 40 future: 40" + "DB luma-stockholm total: 47"
#   ra      → "fetched=0 future=0"          (tomt är normalt, RA har ingen JSON-LD)
#   posh    → "Total: 0 future: 0"
#   reddit  → "Total candidates: 0 unique: 0"

# 3. Förväntade runtime: 8–60 s vardera
```

Bevis: 4 chain-overview step-end + per-step loggar + Supabase `events.source`-fördelning.

## Gotchas

**luma + posh kräver `SCRAPINGBEE_API_KEY`** — utan nyckel `process.exit(2)` omedelbart. Cron förutsätter att nyckeln finns. Verifiera `.env` före verifiering.

**ra är EN sida (ingen pagination)** — alla Stockholm-events finns på en URL. Risk: om RA ändrar struktur → tyst fel.

**reddit persisterar INGENTING — bara loggar.** `scripts/ingest-reddit-stockholm.mjs` skapar en Supabase-klient (rad 29) men skriver aldrig till den; rad 99-102 är uttryckligen `// skip persistence — Reddit posts are signal-only, not full events`. Inget `insert()`, inget `upsert()`, ingen BullMQ. Steget är en **läsande signal-sökning**. En tidigare version av den här texten påstod direkt-upsert till `events` — det är fel, och påståendet "alla fyra pushar till `raw_events`-kö" i header-texten är därför också fel för reddit.

Följd: reddit kan aldrig ge ett `persisted > 0`. Facit är `Total candidates: N unique: M` och topp-10-listan. Vill du att reddit ska skapa events krävs implementation — fråga ep-lead.

**reddit `KNOWN_EVENT_HOSTS` är hårdkodad** — ny plattform (t.ex. Dice, Shotgun) → manuellt edit-lista. Hittar inga events för hosts utanför listan.

**Inga retry/backoff i någon av de fyra** — alla använder plain `fetch` + `sleep(RATE_LIMIT_MS)`. En 5xx dödar bara en (kategori, query)-kombination.

**Rate-limit mot Reddit** är strängare än mot de andra — 3 s/req × 3 subreddits × 5 search terms = 45 s minimum per körning.