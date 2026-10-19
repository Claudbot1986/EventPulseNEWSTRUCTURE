# community-platforms

Fyra community-plattformar: luma (tech meetups), ra (electronic music), posh (social/party), reddit (cross-posts). Alla pushar till `raw_events`-kö.

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

# 2. Senaste log per steg
for STEP in luma-stockholm ra-stockholm posh-stockholm reddit-stockholm; do
  LATEST=$(ls -t runtime/ingestion-cron/steps/${STEP}-*.log 2>/dev/null | head -1)
  echo "=== $STEP: $LATEST ==="
  grep -E "(fetched|persisted|errors|done)" "$LATEST" 2>/dev/null | tail -5
done

# 3. Förväntade runtime: 1-3 min vardera (liten datamängd)
```

Bevis: 4 chain-overview step-end + per-step loggar + Supabase `events.source`-fördelning.

## Gotchas

**luma + posh kräver `SCRAPINGBEE_API_KEY`** — utan nyckel `process.exit(2)` omedelbart. Cron förutsätter att nyckeln finns. Verifiera `.env` före verifiering.

**ra är EN sida (ingen pagination)** — alla Stockholm-events finns på en URL. Risk: om RA ändrar struktur → tyst fel.

**reddit är direkt-upsert, INTE raw_events-kö** — `scripts/ingest-reddit-stockholm.mjs` skriver rakt till `events`-tabellen (rad 5: `const supabase = createClient(...)`, ingen BullMQ). Avviker från mönstret för de andra tre. Kan påverka normalizer-flödet.

**reddit `KNOWN_EVENT_HOSTS` är hårdkodad** — ny plattform (t.ex. Dice, Shotgun) → manuellt edit-lista. Hittar inga events för hosts utanför listan.

**Inga retry/backoff i någon av de fyra** — alla använder plain `fetch` + `sleep(RATE_LIMIT_MS)`. En 5xx dödar bara en (kategori, query)-kombination.

**Rate-limit mot Reddit** är strängare än mot de andra — 3 s/req × 3 subreddits × 5 search terms = 45 s minimum per körning.