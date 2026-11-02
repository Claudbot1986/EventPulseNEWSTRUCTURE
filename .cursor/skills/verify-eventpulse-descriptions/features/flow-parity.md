# Grind E — paritet: Hem, Utforska och Sök visar samma beskrivning

**Kommando:** `node --env-file=.env scripts/_audit_description_coverage.mjs`

## Sub-features

- **E1 — samma antal utan beskrivning i alla tre flöden.** Hem (direkt
  `events_public`-läsning), Utforska (agent-API) och Sök (agent-API +
  `mapAgentEventToRow`) ska visa identisk täckning.
- **E2 — samma prioritetsordning.** Alla tre flöden ska använda
  `getDetailsDescription` från `06-UI/utils/descriptionFallback.js`.

## How to get to it (user POV)

Samma event, tre vägar in i appen. Användaren ska se **samma beskrivning**
och **samma platsrad** oavsett väg. Om Hem saknar beskrivning men Utforska
visar en — så ser det ut som att vissa events saknar beskrivning, när det
i själva verket är en trasig select-lista.

## Driving it with `scripts/_audit_description_coverage.mjs`

Headless. Skriptet:

1. importerar den **ärkta** `getDetailsDescription` ur
   `06-UI/utils/descriptionFallback.js`,
2. läser Hem:s select-listor ur `HomeScreen.js` **vid körning**,
3. bygger tre payloads (Hem / Agent / Sök) på samma sätt som appen,
4. kör resolutionen på varje rad och räknar.

Skriver `docs/audit/description-coverage-<datum>.md` + fyra CSV-filer under
`docs/audit/data/`.

**Invarianten (2026-11-02): 89 / 89 / 89.** Före fixen: 11 932 / 95 / 218.

## Gotchas

- **Skillnaden före fixen kom från fyra fält**, inte från en enda bugg:
  `editorial_description`, `eventpulse_summary`, `description_license` och
  `venue_name`. Alla fyra saknades i Hem:s select-listor.
- **`venue_full_name` ≠ `venue_name`.** Vyn heter `venue_full_name`; koden
  läste `venue_name`. Fältet hämtades men kastades bort. Kommentaren på
  `HomeScreen.js:147-150` sade "venue_name finns inte i events_public" —
  det var sant då, och blev falskt när vyn ändrades.
- **`getDetailsDescription` läser `category_slug`, inte `category`.** En
  payload som bara har `category` tappar steg 4 (faktaraden).
- **Steg 2 läser `eventpulse_summary`, steg 3 läser `description_license`.**
  Utan dem är resolutionen alltid `null`.
- **Agent-flödet hämtar `venue_name` från `venues.name` (curerad) med
  `venue_full_name` som reserv** — via `guardDisplayTextWithFallback`, som
  också filtrerar bort skript. Hem-flödet har ingen curerad join — där är
  `venue_full_name` det enda.
