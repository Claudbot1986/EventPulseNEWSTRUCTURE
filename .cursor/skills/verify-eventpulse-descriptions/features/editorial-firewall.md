# Grind B — brandvägg: källtext når inte writer-modellen

**Kommando:** `node --env-file=.env --import tsx scripts/verify-description-rights.ts`

## Sub-features

- **B1 — brandväggen kastar.** `compileWriterInputs()` i
  `04-Normalizer/editorial/textualFirewall.ts` ska **kasta ett fel** om
  writer-inputen innehåller `source_description`, `raw_description`,
  `original_title`, `html_source` eller `scraped_copy`.

## How to get to it (user POV)

Det här är inte synligt för användaren — det är villkoret för att beskrivningen
över huvud taget får finnas. Om brandväggen läcker, så är *varje* AI-beskrivning
i appen potentiellt en parafras av källans text, och då är det inte längre
"fakta + öppen data" utan "kopia".

## Driving it with `scripts/verify-description-rights.ts`

Headless. Gaten anropar `compileWriterInputs()` med en `raw_description` i
event-objektet och kräver att den kastar. Exit 0 = grön.

## Gotchas

- **Brandväggen är på INGÅEN, inte på utgången.** Utgångssidan skyddas av
  grind C (icke-kopia). Båda behövs: B gör att modellen aldrig *ser*
  källtexten, C gör att resultatet inte *lika* källtexten.
- **`assertFirewallClean()` kör nu i produktion** (2026-11-02). Tidigare var
  den importerad men bara anropad i tester — den andra försvarslinjen fanns
  i teorin men inte i verkligheten. `runEditorialPipeline` anropar den på
  `writerInputs` före modellanropet.
- **Båda skydden hoppar över null/''.** Ett fält som finns men är tomt
  kastar inte. Det är avsiktligt (tomt = inget att skydda) — men betyder
  att `raw_description: null` passerar, vilket är korrekt.
- **`assertFirewallClean()` är ettandra försvarslinje-lager.** Den fångar
  förbjudna fält i ett godtyckligt objekt. Den är inte samma sak som
  `compileWriterInputs()` — gaten testar den senare.
- **Förbjudda fält:** `source_description`, `raw_description`, `original_title`,
  `html_source`, `scraped_copy`. Lägg inte till nya fält utan att också
  utvidga listan — en ny fältnamn som läcker förbi listan är ett hål.
- **`event_profile` får inte innehålla källprosa heller.** Profilen byggs
  ur strukturerade fält + öppen data (curerad gazetteer, Wikidata,
  MusicBrainz) — men ALSO ur `raw_description` via entitetsextraktion
  (`eventUnderstanding.ts` → `semanticExtractor.ts`). Den extraktionen
  plockar **entiteter och siffror** (performers, ensemble, verk, koncept) —
  inga prosa meningar. Det är därför brandväggen håller: källtexten kan
  bidra med *namn*, aldrig med *text*. Om någon börjar lägga rå meningar i
  profilen kringgår brandväggen, eftersom profilen *skickas* till writer.
- **Den synkrona profilbyggaren använder bara curerade cachar** — inte
  live-uppslag mot Wikidata/MusicBrainz. Live-enrichmenten är en separat,
  asynkron väg.
