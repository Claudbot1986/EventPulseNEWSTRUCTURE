# Grind D — time-box: råtext raderas efter 30 dagar

**Kommando:** `node --env-file=.env --import tsx scripts/verify-description-rights.ts`

## Sub-features

- **D1 — ingen råtext äldre än 30 dagar.** Inga rader i `events` får ha
  `raw_description` med `raw_description_captured_at` äldre än 30 dagar.
- **D2 — workern körs.** Steget `raw-description-retention` ska finnas i
  `scripts/ingestion-cron.ts` och köra
  `04-Normalizer/rawDescriptionRetentionWorker.ts`.

## How to get to it (user POV)

Ingen synlig skillnad — men beslutet (2026-10-05) är att källans råa text
ska försvinna ur databasen 30 dagar efter att den fångades. Det är skillnaden
mellan "vi förstår" och "vi får visa", och den är en del av
upphovsrätts-separationen: ju längre råtexten ligger kvar, desto större
yta för ett fel.

## Driving it with `scripts/verify-description-rights.ts`

Headless. Läser `events` och nattkedjans stegdefinition.

För att se **vilka** rader som skulle rensas (utan att radera):

```bash
npx tsx 04-Normalizer/rawDescriptionRetentionWorker.ts --dry-run
npx tsx 04-Normalizer/rawDescriptionRetentionWorker.ts --retention-days 1 --dry-run
```

`--retention-days 1` flyttar cut-offen så att urvalslogiken kan bevisas
utan att vänta 30 dagar.

## Gotchas

- **Workern raderar `raw_description` + `raw_description_captured_at` och
  inget annat.** Ingen annan kolumn påverkas.
- **Idempotent.** Körs flera gånger samma dag raderas inget extra.
- **Den rör `events`, inte `events_public`.** Vyn exponerar ändå inte
  `raw_description`.
- **Det är en per-rad UPDATE i en loop** (`limit` 1 000 per körning). Vid
  stora backloggar tar det flera nätter — det är medvetet, för att inte
  blockera databasen.
- **2026-11-02:** workern hade ingen anropare alls. Ingen nattkedja, ingen
  launchd, ingen plist — purge-plisten kör `purge_yesterday_events.ts`, en
  helt annan sak. Nu är steget in i `scripts/ingestion-cron.ts`.
