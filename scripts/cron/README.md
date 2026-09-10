# scripts/cron — launchd-installation för ingestion-pipelinen

> **Skapad 2026-09-10** som svar på krav att ALLA plansteg (P1A, P2A, P2B, P2C, P2D, P3A, P3B, P3C) körs automatiskt varje natt kl 02:30.

## Vad detta gör

`com.eventpulse.ingestion.plist` startar `scripts/ingestion-cron.ts` dagligen kl 02:30 via macOS launchd. Cronjobbet kör hela ingestion-pipelinen:

| Steg | Vad | Plan-steg |
|------|-----|-----------|
| A | Direkt-API ingestion (Ticketmaster, Eventbrite) | grund |
| B | Network API ingestion (RSS/Atom feeds) | grund |
| C | HTML Gate (universell extractor, 123-loop) | grund |
| **D-renderGate** | Scrapingbee för JS-tunga sidor | **P1A** |
| **I-pdfExtraction** | PDF/affisch-extraktion | **P2A** |
| **manual-review-triage** | Triagera toolScB-rester | **P1B** |
| **etag-refresh** | ETag/If-Modified-Since dedup | **P2B** |
| D-images | Library-first image fallback | grund |
| **P2C-active-learning** | Confidence < 0.5 → human review | **P2C** |
| **P3A-google-cse** | Google Custom Search → source_candidates | **P3A** |
| **P3B-venue-graph-geo** | Geo-expansion 500m | **P3B** |
| **P3C-rss-discovery** | /feed, /rss.xml för venues | **P3C** |
| pattern-promoter | URL-mönster C → C0/C2 | grund |

## Installation (engångs)

```bash
# 1. Kopiera plist till launchd
cp scripts/cron/com.eventpulse.ingestion.plist ~/Library/LaunchAgents/

# 2. Ladda in i launchd
launchctl load ~/Library/LaunchAgents/com.eventpulse.ingestion.plist

# 3. Verifiera att den är aktiv
launchctl list | grep com.eventpulse.ingestion
```

## Avinstallation

```bash
launchctl unload ~/Library/LaunchAgents/com.eventpulse.ingestion.plist
rm ~/Library/LaunchAgents/com.eventpulse.ingestion.plist
```

## Manuell testkörning

```bash
# Kör hela pipelinen direkt (utan att vänta till 02:30)
bash scripts/cron/runIngestion.sh

# Eller hoppa över enskilda steg för felsökning
npx tsx scripts/ingestion-cron.ts --skip-render --skip-images --limit 10
```

## .env-integration

`runIngestion.sh` läser `.env` automatiskt via `set -a; source .env; set +a`.
launchd ärver EnvironmentVariables från plisten (`PATH`).

**VIKTIGT:** `GOOGLE_API_KEY` och `GOOGLE_CSE_ID` finns redan i `.env` som `_PLACEHOLDER_FAKE_` — modulen no-op:ar tills riktiga nycklar är på plats.

## Status & loggar

- **Statusfil:** `runtime/ingestion-cron.status.json` (skrivs av cronjobbet)
- **stdout:** `runtime/ingestion-cron/launchd.out.log`
- **stderr:** `runtime/ingestion-cron/launchd.err.log`

Dashboard 7777 läser statusfilen och visar röd/grön-knapp som triggar manuell start.

## Schema-jämförelse med andra launchd-jobb

| Jobb | Tid | Plats |
|------|-----|-------|
| com.eventpulse.ingestion (denna) | 02:30 | scripts/cron/ |
| com.eventpulse.purge | 03:00 | 09-ScrapingSupervisor/cron/ |
| com.eventpulse.supervisor | 04:30 | 09-ScrapingSupervisor/cron/ |
| com.eventpulse.discovery | 04:30 | 09-DiscoveryAgent/cron/ |

## Relaterade planer

- Plan: `~/.claude/plans/eventual-leaping-plum.md` (P1–P3, 14 steg)
- Image library Phase 2: `docs/IMAGE-LIBRARY-PHASE2-GOAL.md`
- ENOTFOUND-batch 2026-09-10: 93 sources → `sources/_quarantine/`
