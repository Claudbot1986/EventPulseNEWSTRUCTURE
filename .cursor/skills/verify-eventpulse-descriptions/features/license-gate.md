# Grind A — licensgrind: rå källtext syns inte i appen

**Kommando:** `node --env-file=.env --import tsx scripts/verify-description-rights.ts`

## Sub-features

- **A1 — vyn exponerar ingen råtext.** `events_public` (det appen läser) ska
  ha `description_sv`/`description_en` = NULL för alla rader.
- **A2 — ingen tillåtande licens.** `events.description_license` ska vara
  `unknown` (default = no-go) eller NULL. Ingen rad får ha `pressbild`,
  `copyright-with-attribution`, `partner-licensed` eller `public-domain`
  utan att det är medvetet beslutat.
- **A2b — inga okända licensvärden.** `description_license` får bara vara
  de fyra tillåtande värdena, `unknown` eller NULL. Ett värde som `foo`
  skulle passera A2 men ändå blockeras av vyn — det är ett
  datakvalitetsfynd, inte ett fungerande licensvärde.
- **A3 — ingen bypass-väg.** Läsvägar som läser **bas-tabellen `events`**
  (inte vyn) måste ha en egen gate.

## How to get to it (user POV)

Öppna appen, gå till Hem, tryck på ett event. Beskrivningen under titeln ska
vara en riktig beskrivning (AI-prosa eller faktmall) — **aldrig** källans
egen text. Samma i Utforska och i sökresultatet.

Om det står "No description available from <källa>" är det **inte** ett
licensbrott — det betyder att resolutionen inte nådde något steg. Det är
grind E.

## Driving it with `scripts/verify-description-rights.ts`

Headless, ingen app behövs. Läser live-Supabase.

Exit 0 = **alla nio kontrollerna** gröna (A1, A2, A2b, A3, B1, C1, D1, D2,
E1) — inte bara licensdelen. Bevis i
`runtime/verification-reports/description-rights-<ts>.json` under `checks[]`.

## Gotchas

- **Vyn är `events_public`, inte `events`.** Kod som läser bas-tabellen
  bypassar vyns filter. Sök både efter `.from('events')` **och** efter
  rå REST-anrop: `/rest/v1/events` (i `eventsCanonical.js`/`.cjs` byggs
  URL:en med `params.set('select', EVENT_SELECT)` — `from('events')` hittar
  bara count-queryn). Varje sådan väg måste gate:a själv.
  (2026-11-02: `06-UI/services/eventsCanonical.js` gjorde detta. Nu gate:ad
  + regressionstest. `08-Agent/services/imageGen.ts` läser också bas-
  tabellen men är en intern worker, inte användarvänd.)
- **Vägen är inte helt död.** `eventsCanonical.js` når `eventServiceClient.js`
  → `App-Api.js` (importeras inte av något) och `EventTotalContext.js`
  (räknar bara events, läser inga beskrivningar). `.cjs`-spegeln når
  `api-server.cjs`. Gate:ad = försvar i djup, inte bara att stänga dörren.
- **`description_license` NULL är inte samma som tillåtande.** Vyns
  CASE WHEN tillåter bara de fyra namngivna licenserna; NULL faller igenom
  som "ej tillåtande".
- **Sätt aldrig en tillåtande licens på en riktig rad för att "testa".**
  Då exponeras råtext publikt. Använd en scratch-rad, eller läs
  `descriptionLicense.ts` i stället.
- **Att 0 rader har tillåtande licens är det förväntade tillståndet just
  nu.** Det betyder att råtexten är helt blockerad — inte att något är
  fel.
