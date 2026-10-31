# Världen lever (preflight + env)

## Sub-features

Preflighten kör **10 kontroller** (`scripts/lib/preflight.mjs` → `runPreflight`),
varav sex är hårda (blockerar kedjan) och fyra mjuka (bara `degraded`):

| Kontroll | Hård? | Vad den testar |
|---|---|---|
| `redis-tcp` | ✅ | Redis svarar på TCP |
| `redis-ping` | ✅ | Redis svarar PING |
| `dns-supabase` | ✅ | DNS slår upp Supabase |
| `supabase-rest` | ✅ | `GET /rest/v1/` svarar |
| `keys` | ✅ | `SUPABASE_SERVICE_ROLE_KEY` finns och inte är en placeholder |
| `env-parse` | ✅ | `.env` går att parsa |
| `dns` | mjuk | generell DNS |
| `egress-tcp` | mjuk | utgående trafik fungerar |
| `keys-third-party` | mjuk | Exa/Scrapingbee-nycklar finns |
| `local-servers` | mjuk | port 7777/7778 (bara med `--require-local-servers`) |

Blockering: kedjan gör `process.exit(69)` och skriver
`status.json.preflight` (`scripts/ingestion-cron.ts:1112–1146`).
Tredjepart är mjukt som standard (`allowDegraded`), tvingas hårt med
`--strict-preflight`.

## How to get to it (user POV)

Ingen UI. Operatören kör preflight före varje nattlig körning — det är det
första steget i `scripts/ingestion-cron.ts` (steget `preflight`), och samma
funktion används av `scripts/verify-preflight.mjs`.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify-preflight.mjs          # L1-gaten
node scripts/verify-env-integrity.mjs      # .env-parsning
```

**PASS** = sista raden `[verify-preflight] GATE L1: GRÖN` (exit 0).
**FAIL** = `GATE L1: RÖD` (exit 1); orsaken står i raden
`→ failed=redis-tcp,…`. Mellanraderna `[OK ] hard|soft <check>` visar
hård vs mjuk.

Verktyget har en egen negativ kontroll: det stänger av en kontroll och
verifierar att gaten blir röd (`scripts/verify-preflight.mjs:52–74`).

## Gotchas

- **Preflight och kedjan använder Samma funktion** (`runPreflight`).
  Det finns ingen separat "världen redo"-kontroll. Verktygets egen succésrad
  är "världen är körbar" — den säger alltså precis den distinktion man kan
  förvänta sig.
- **Redis mäts bara som TCP + PING.** Ingen bull-kö-probe — ködjobbens
  tillstånd är alltså inte del av preflight.
- **`verify-preflight.mjs` skriver ingen JSON-artifact.** Filerna
  `runtime/ingestion-cron/preflight-<TS>.json` skrivs av kedjan (och av
  `node scripts/lib/preflight.mjs`).
- **Env läses från `<projektrot>/.env`** — det finns ingen `runtime/.env`.
  Sökvägen löses mot modulens egen plats (`import.meta.url` / `__dirname`), så
  cwd är irrelevant för preflight, env-integrity och kedjan (kedjan spawnar
  barn med `cwd: PROJECT_ROOT`).
- **dotenv 17.3.1: vid dubblett vinner den SISTA raden** (`obj[key] = value`),
  inte den första. Samma "sista vinner"-regel gäller `env-parse.mjs` och
  `source .env` i bash. `.env` innehåller fyra dubbletter:
  `SUPABASE_PAT` (samma värde — ofarligt), samt `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` och `OPENAI_API_KEY` (skilda värden — där vinner den
  sista).
- **`process.env` slår `.env`** i preflight (`override: false`). Ett värde som
  sätts i launchd-miljön vinner alltså över filen.
- **Nyckelkontrollen testar existens/placeholder-mönster**, inte att nyckeln
  fungerar — en trasig men icke-placeholder-nyckel går som OK.
- **P3A har Google-CSE-fallback**, så "ingen Exa" betyder inte "ingen
  discovery" — bara mindre discovery.
