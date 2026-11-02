# Grind C — icke-kopia: utdata liknar inte källtexten

**Kommando:** `node --env-file=.env --import tsx scripts/verify-description-rights.ts --sample=300`

## Sub-features

- **C1 — pipeline-måttet.** För varje event med både `editorial_description`
  och rå källtext körs `checkIndependence` — **samma funktion pipelinen
  använder**, med `profile` och `event` medskickade. Grinden är röd om
  `max_similarity` > 0,5 **eller** om grinden inte passerar (`pass=false`,
  dvs. någon matchad kreativ fras).

## How to get to it (user POV)

Användaren ser bara en text. Rättsligt är det denna text som måste vara
*egen* — byggd ur fakta och öppen data, inte en omskrivning av källans
egen beskrivning. Om similarity-scoren är hög har vi gjort en parafras, och
det är precis det beslutet förbjuder.

## Driving it with `scripts/verify-description-rights.ts`

Headless, ingen LLM. Gaten hämtar ett urval events ur databasen (där både
`editorial_description` och `raw_description` finns) och kör
`checkIndependence` på varje rad.

Exit 0 = ingen rad över 0,5. Beviset innehåller max/medel-similarity och
matchade fraser för de rader som överstiger.

## Gotchas

- **`checkIndependence` filtrerar bort skyddad vokabulär** (artistnamn,
  genrer, datum, "konsert", "scen" …). Det är korrekt — fakta får upprepas.
  Scoret mäter *kreativ* överlappning, alltså det som faktiskt skulle kunna
  vara en parafras.
- **`profile` + `event` måste vara med.** Utan dem stängs profilens
  extra skydd av artist-/verk-/platsnamn av, och grinden mäter mindre än
  pipelinen gör. (Drift hittad 2026-11-02 av maintain-passen — gaten
  skickade inte med dem, bara `max_similarity`.)
- **Tvärsnittet 0,5 är pipelinjens egen tröskel**
  (`DEFAULT_SIMILARITY_THRESHOLD`). Ändra den i pipelinen utan att ändra
  gaten, eller vice versa — då mäter de olika saker.
- **Ändra inte gaten för att den ska bli grön.** Om en rad överstiger
  tröskeln är det *utdata* som är problemet, inte mätningen.
- **Kör med `--sample=300` innan du drar slutsatser.** 40 rader ger ett
  grovt intervall; 300 ger en bild som håller.
- **`raw_description` raderas efter 30 dagar (grind D).** Ju äldre sample,
  desto större chans att källtexten saknas — då hoppar gaten över raden.
