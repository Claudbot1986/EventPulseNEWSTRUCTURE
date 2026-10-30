# Databasen och ingestion

## Sub-features

- **Post-ingestion-kontroll** — `scripts/check_asian_chars.ts` skannar alla
  publicerade events efter varje ingestion.
- **Reparation** — `scripts/repair_asian_text.ts` kopplar om felaktiga
  lokalkopplingar och genererar om summary deterministiskt.
- **Översättning** — `scripts/translate_foreign_titles.mjs` översätter titlar
  som är på ett annat språk (MiniMax M3) till `event_translations`.

## How to get to it (user POV)

Detta är operatörsytan, inte en appyta. Den körs efter en ingestion-körning,
inte av användaren.

## Driving it with it

```bash
# Kontroll
npx tsx --env-file=.env scripts/check_asian_chars.ts --within-days 365 \
  --json runtime/text-integrity/scan.json

# Reparation (först dry-run)
npx tsx --env-file=.env scripts/repair_asian_text.ts --dry-run
npx tsx --env-file=.env scripts/repair_asian_text.ts --apply

# Översättning av främmande titlar
node --env-file=.env scripts/translate_foreign_titles.mjs --languages sv,en --dry-run
node --env-file=.env scripts/translate_foreign_titles.mjs --languages sv,en --apply
```

## Gotchas

- **PostgREST kapar vid 1 000 rader.** Ett skript som inte paginerar ser
  bara de första 1 000 raderna och rapporterar felaktigt "rent".
- **Klassificeringen är viktig.** `defect` = främmande skript i text vi
  genererat (`eventpulse_summary`, `editorial_description`) eller i
  lokaldata. `source-content` = främmande skript i källans egen titel.
  Raderar du fel klass försvinner legitimt innehåll.
- **Översättning kostar pengar.** `translate_foreign_titles.mjs` har
  samma faktureringsskydd som `11-Translation/translate-batch.mjs`:
  HTTP 402 eller "insufficient funds" avbryter omedelbart, exit 3, aldrig
  retry.
- **`repair_asian_text.ts` kopplar loss `venue_id`** när källans lokalnamn
  inte matchar en kurerad lokal. Agentens feed har då en reserv:
  `venue_full_name` används i stället för en tom sträng.
