# Beskrivningstäckning — audit 2026-11-02

> Genererad av `scripts/_audit_description_coverage.mjs` (read-only, ingen DB-skrivning).
> Beskrivnings-resolutionen är importerad från den äkta UI-modulen
> `06-UI/utils/descriptionFallback.js` — auditen kan inte glida ifrån appens beteende.

## Mätvärden

| Mätning | Antal | Andel av 11323 |
|---|---:|---:|
| Events i `events_public` (det appen läser) | 11323 | 100 % |
| **Saknar beskrivning i Hem-flödet** | **0** | 0.0 % |
| **Saknar beskrivning i Agent/Utforska-flödet** | **0** | 0.0 % |
| **Saknar beskrivning i Sök-läget** | **0** | 0.0 % |
| Saknar beskrivning i BÅDA Hem och Agent | 0 | 0.0 % |
| Har beskrivning i Hem men inte i Agent | 0 | 0.0 % |
| Har bara `eventpulse_summary` → förlorar rad-preview i Sök | 0 | 0.0 % |

## Hem-flödets select-listor (lästa ur HomeScreen.js vid körning)

Fälten nedan är verifierade genom att select-listorna **läses ur koden vid körning** —
inte påstådda. En ändring i HomeScreen.js ändrar därför tabellen automatiskt.

Antal select()-listor i HomeScreen.js: 10

| Fält | finns i Hem-select? | betyder |
|---|---|---|
| `editorial_description` | JA | resolution steg 1 (primär) |
| `eventpulse_summary` | JA | resolution steg 2 |
| `description_license` | JA | gate för steg 3 |
| `venue_name` | **NEJ** | gate för steg 4 (faktarad) |
| `description_sv` / `description_en` | JA | steg 3 (men licens-gated) |

## Sök-läget (`mapAgentEventToRow` i `rowMapping.js`)

Sök-läget mappar sökresultat via `mapAgentEventToRow`. Mappen forwardar
`editorial_description`, `eventpulse_summary` (sedan 2026-11-02) och `description_license`.

| Mätning | Antal |
|---|---:|
| Saknar beskrivning i Sök-läget | 0 |
| Har bara `eventpulse_summary` (ingen editorial) → saknar rad-preview | 0 |

## Fördelning per källa — saknar beskrivning i Hem-flödet

| Källa | Antal |
|---|---:|

## Fördelning per källa — saknar beskrivning i Agent/Utforska-flödet

| Källa | Antal |
|---|---:|

## Rotorsaksklassning — de 0 events som saknar beskrivning överallt

| Rotorsak | Antal | Betydelse |
|---|---:|---|

## Komplett lista — saknar beskrivning i BÅDA flödena

Fullständig lista med rotorsak per rad: `docs/audit/data/events-without-description-2026-11-02.csv` (0 rader).

| # | Titel | Källa | Start | Rotorsak | Råtext-len | Licens | Bokningslänk? |
|---:|---|---|---|---|---:|---|---|

## Hem-flödet — komplett lista

Eftersom Hem-selecten saknar `editorial_description`, `eventpulse_summary`, `description_license` och `venue_name`, saknar **alla 11323** events beskrivning i Hem-flödet.
Komplett lista: `docs/audit/data/events-without-description-HEM-flow-2026-11-02.csv` (0 rader).
