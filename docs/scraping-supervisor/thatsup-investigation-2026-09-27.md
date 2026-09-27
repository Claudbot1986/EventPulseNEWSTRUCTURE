# Thatsup — Investigation 2026-09-27

## Slutsats

**`thatsup-stockholm-events` har inga events.** Sajten är enbart artikel/blogg-baserad.

Adapter-resultatet `validationPassed: false / validationNotes: "containers=1; titles=0; dates=0"`
är korrekt. Källan kan inte producera events från sin seed URL.

## Bakgrund

| Källa | Status | Events i DB |
|---|---|---|
| `thatsup-stockholm-events` | ❌ inga events i URL:en | 0 |
| `thatsup-stockholm-articles` | ✅ aktiv, 272 events | 272 |

`thatsup-stockholm-articles` är en annan source som extraherar artiklar från
`/stockholm/article/{slug}/`-sidor och gör om dem till events via
artikel-innehåll (article publication date + title). Den fungerar — den
producerar 272 events med framtida datum (ofta löpande serie).

## Vad vi har testat

1. **Seed URL** `https://thatsup.se/stockholm/events/` — 200, 438 kB HTML, 100 `<article>`-taggar.
   - Innehåll: navigations-filter + 99 nyhetsartiklar (t.ex. "Helgprovning på Folii", "Yung Lean ställer ut konst på Gasverket", "Green Action Week").
   - Inget JSON-LD, inga `<time datetime>`, inga "Köp biljetter"-strängar.
2. **C-htmlGate auto-discovery** (batch-202 trace):
   - `c0WinnerUrl: https://thatsup.se/blog/thatsupevent/` (density=25)
   - C2 verdict: "promising" (score=46)
   - C3 universal-extractor: 0 events
   - C3 AI: failed
   - Slutstatus: `EXTRACTION_ZERO_C3_AI_ZERO`
3. **Andra URL:er testade**:
   - `/stockholm/calendar` → 404
   - `/stockholm/kalender` → 404
   - `/stockholm` → 200, 494 kB, top URL-segment: `/stockholm/guide` (50 st), `/stockholm/explore` (34 st), `/stockholm/guides` (24 st) — alla blog/artikel-pattern.

## Slutsats — vad gör vi

1. **Markera `thatsup-stockholm-events` som permanent otillgänglig.**
   Skriv en ny adapter som returnerar `validationPassed: false` permanent
   + `validationNotes: "site-has-no-events-only-blog-content"` så A-spår
   inte lägger tid på den.
2. **Behåll `thatsup-stockholm-articles` som den fungerande källan** —
   den producerar 272 events som faktiskt är korrekt extraherade.
3. **Inget behov av rewrite** — rätt åtgärd är att dokumentera att
   källan inte har events och sluta slösa cron-tid på den.

## Åtgärd tagen

- `runtime/adapters/thatsup-stockholm-events.json` uppdaterad med
  `validationPassed: false (final)`, `validationNotes: "site-has-no-events..."`,
  och `deprecationReason`-fält.