# Ingestion-live — landar events verkligen i Supabase?

## Sub-features

- **A-gatet** (`02-Ingestion/A-directAPI-networkGate/runA.ts`) — väljer källor
  och hämtar dem.
- **B-gatet** (`runB-parallel`) — JSON/RSS-flöden.
- **C-gatet** (`02-Ingestion/C-htmlGate/`) — HTML-kandidater → JSON-LD.
- **D-gatet** (`02-Ingestion/D-renderGate/`) — renderad HTML.
- **import-to-eventpulse** — råevents → Supabase.
- **worker-drain** — normalisering, beskrivningar, bilder.
- **dedup-audit + reconcile** — dubblettkontroll och källstatus.

## How to get to it (user POV)

Operatören ser resultatet i appen: evenemang i Hem, i Utforska, i sökningen.
Underliggande är `events_public` i Supabase. Gaten mäter den tabellen före och
efter en riktig kedjekörning.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify-chain-live.mjs --limit 200
```

Kör hela kedjan (`scripts/ingestion-cron.ts`) mot levande Redis/Supabase och
mäter i samma process:

| Vad | Hur |
|---|---|
| events_public | `count` före och efter — får inte minska |
| importkö | `bull:raw_events:wait` före/efter — importen ska ha jobbat |
| ledger | `ingestion_ledger` före/efter — `persisted` ska ha växt |
| worker-drain | slutförda jobb och misslyckade jobb |
| import-steget | exit-kod + importerade events i stegloggen |

Flaggor: `--only a,b,c` (bara utvalda steg — snabb iteration, inte nattlig
semantik), `--exercise N` (tvinga produktion på N källor med framtida events).

## Gotchas

- **Utan `--exercise` är importen idempotent** och gaten alltid röd. Gaten
  tar bort ledgerposter för källor med framtida events så att importen måste
  göra om jobbet.
- **`--limit` styr flera steg**, inte bara A-gaten (B, D-render, pdf, etag).
- **Kedjan tar 30–60 min** (subpath-discovery ensam ~40 min). Kör den i
  bakgrunden och läs `chain-overview.log` medan den går.
- **Ingen parallell kedje-körning.** Två samtidiga körningar skriver samma
  statusfiler och ger läsbara men falska siffror.
- **Subpath-discovery äger 76 % av tiden** — om kedjan verkar "hånga", titta
  först där.
- **Ett grönt `status.json` betyder inte att events skapades.** Det betyder
  bara att stegen exitade 0. Det är därför gaten mäter DB:t.
