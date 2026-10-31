# Världen lever (preflight + env)

## Sub-features

- **Redis** — heartbeat och rensning av bull-kön. Utan Redis går ingen import.
- **Supabase** — DB, storage och RPC:er. Utan Supabase skapas inga events.
- **Exa** (mjuk) — kandidatupptäckt. Utan Exa hittar discovery inga nya källor.
- **Scrapingbee** (mjuk) — render-gaten. Utan den kan JSON-LD-källor ändå köas.
- **.env** — alla nycklar måste finnas i `runtime/.env` / projektets `.env`.

## How to get to it (user POV)

Ingen UI. Operatören öppnar terminalen i repot och kör preflight före varje
nattlig körning — det är det första steget i `scripts/ingestion-cron.ts`
(preflight-steget i kedjan).

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify-preflight.mjs
node scripts/verify-env-integrity.mjs
```

`verify-preflight.mjs` svarar på "är världen värd att köra?" med hårda
kontroller (Redis, Supabase) och mjuka (Exa, Scrapingbee). Den skriver
`runtime/ingestion-cron/preflight-<TS>.json`.

## Gotchas

- **Preflight passerar inte "världen är klar"** — Redis svarar medan
  bull-jobben fortfarandeInitieras. Kedjan har en egen prefight med
  "världen redo"-kontroll (`scripts/lib/preflight.mjs`).
- **Mjuka kontroller (Exa/Scrapingbee) får inte blockera kedjan** — de loggas
  som `degraded`, kedjan går vidare. Men discovery ger då noll nya källor
  utan att kedjan blir röd.
- **`--env-file` vs `.env`**: kedjan laddar `.env` från projektroten. Kör
  alltid från `/Users/claudgashi/EventPulse`, annars hittar inte
  `dotenv.config()` filen.
- **Env-nyckeln har en dubblett i `.env`** (två `SUPABASE_PAT`-rader).
  `dotenv` laddar den första; den andra används aldrig.
