# Event-detaljvy

## Sub-features

- **Bild + rubrik** — eventets bild, kategori, datum, tid.
- **Lokalnamn** — visar `venues.name` (kurerad) med `events.venue_full_name`
  (källans eget) som reserv. Här syns den koreanska lokalen i klartext.
- **Beskrivning** — `editorial_description` → `eventpulse_summary` →
  `description_sv/en` (prioritet i `06-UI/utils/descriptionFallback.js`).
- **Knapprad** — Spara, Visa karta, Lägg till i kalender, Dela, Fler.

## How to get to it (user POV)

Tryck ett eventkort på Hem, en träff i Utforska-listan eller en sökträff.

## Driving it with Playwright

```bash
node .cursor/skills/verify-eventpulse-text-integrity/scripts/text-integrity-scan.mjs \
  --language sv --search "VIKING" --screenshot
```

Drivaren öppnar första träffen i söklistan och scannar detaljvyn som ytan
`sok-detalj`. `surfaces[].opened` visar vilket event som öppnades.

## Gotchas

- **Detaljvyn är en overlay, inte en ny flik.** Tryck "Tillbaka" (texten är
  "< Tillbaka", inte `role=button`) och vänta in att
  `[data-testid="home-screen"]` syns igen — annars scannar nästa yta
  detaljvyn.
- `editorial_description` är AI-genererad text. Den har ibland innehåll i
  fel skript (t.ex. kinesiska tecken mitt i en svensk mening) — det är en
  artefakt i genereringen, inte källans text.
