# Ingestion-live — landar events verkligen i Supabase?

## Sub-features

- **P3A/P3B/P3C/P3D** — discovery-stegen kör **först** i kedjan
  (`scripts/ingestion-cron.ts:1047-1059`), så en promote:ad källa kan nå
  A-gaten samma natt.
- **Preflight** — kan avbryta hela kedjan med exit 69 innan något steg körs.
- **A-gatet** (`02-Ingestion/A-directAPI-networkGate/runA.ts`) — väljer källor
  och hämtar dem.
- **B-gatet** (`runB-parallel`) — JSON/RSS-flöden.
- **C-gatet** (`02-Ingestion/C-htmlGate/`) — HTML-kandidater → JSON-LD.
  Styrs **inte** av `--limit` (`--max-rounds 200`).
- **D-gatet** (`02-Ingestion/D-renderGate/`) — renderad HTML.
- **import-to-eventpulse** — råevents → bullmq → Supabase.
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

| Vad | Hur | Krav |
|---|---|---|
| `events_public` | `count` via `Prefer: count=exact` före/efter | får inte minska |
| importkö | `LLEN bull:raw_events:wait` före/efter | **tom efter** |
| ledger | filen `runtime/import-ledger.jsonl` (ingen tabell!) före/efter | `queued` ska inte växa (L7) + ingen "kunde inte skriva/uppdatera ledger" i loggen |
| worker-drain | `completed`/`failed` ur kedjans stdout | completed > 0 **och** failed = 0 |
| import-steget | kedjans **totala** exit-kod + antal events som enqueueades i bullmq (ur stdout, ur stegloggen) | exit 0 |
| nya rader i `events` | räknas sedan körningsstart | rapporteras, ej gate |
| status.json-liveness | pid + tidsstämpel | L5 |

**PASS** = exit 0 och sista raden `[verify-chain-live] GRÖN` + ny fil
`runtime/verification-reports/chain-live-<TS>.json`.
**FAIL** = exit 1 och `[verify-chain-live] RÖD` med en eller flera `FAIL:`-rader.

Flaggor: `--only x,y` (bara utvalda steg — snabb iteration, inte nattlig
semantik), `--exercise N` (tvinga produktion på N källor med framtida events;
**default är 3**, `0` stänger av), `--limit N`.

## Gotchas

- **`--exercise` är ON som standard (3 källor).** Gaten tvingar alltså
  produktion även utan flaggan — den behöver inte "tvingas igång" av
  operatören.
- **Gaten raderar inga ledgerposter.** Den skickar `--force-import-sources`
  → importen kör med `--force` → ledgerposter skrivs **inte alls** under
  tvingad import. Mekanismen är "tvinga förbi ledgerkontrollen".
- **Ledgern är en fil**, `runtime/import-ledger.jsonl` — det finns ingen
  `ingestion_ledger`-tabell.
- **`--limit` når A, B, D-render, pdf, etag och D-images** — men **inte**
  C-htmlGate, sitemap, subpath, P3-stegen eller de enskilda feed-skripten.
  Därför förkortar `--limit 200` **inte** 40-minuterssteget.
- **subpath-discovery äger ~76 % av tiden** (2 388 s av 3 154 s i nattens
  körning) och **sitemap** är nästa längsta.
- **Kedjan tar 30–60 min** (nattens körning: 52,6 min; senaste fem: 65,5 /
  55,1 / 52,1 / 53,7 / 52,6 min).
- **Ingen låsfil finns i kedjan.** Två fria körningar skriver samma
  statusfiler → falska siffror. Gaten har en krockvakt (`liveChainPids`) och
  avbryter med exit 1 om en annan kedja lever.
- **Preflight kan avbryta med exit 69** innan något steg körs — gaten
  behandlar det som fel.
- **`runtime/discovery-verification.status.json`** styr om verify-skills
  skippar inom 24 h och sätts till `errorClass:'empty'` om kedjan producerade
  0 events.
- **Verifieringskörningen har `AI_IMAGE_PIPELINE_ENABLED=0`** — ingen bildkö
  under verifieringen.
- **Ett grönt `status.json` betyder inte att events skapades.** Det betyder
  bara att stegen exitade 0. Det är därför gaten mäter DB:t.
