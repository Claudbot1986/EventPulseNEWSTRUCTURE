# Sök

## Sub-features

- Sök sker **i Utforska-fliken**, i en ruta högst upp (`data-testid="explore-search-input"`, textfältet `explore-search-textinput`).
- `06-UI/screens/SearchScreen.js` finns kvar men **monteras inte** — `App.js` kommenterar ut att SearchScreen byts mot in-söking i samma vy.
- Sökfrågan skickas till agent-API:t (`GET /agent/feed?q=<text>`), träffarna visas i samma lista som Utforska. Anropet bär **alltid** `?locale=<uiLanguage>`, vilket styr översättning och skript-skydd för titel och lokalnamn.
- **Sökfel visas inte för användaren** — `agentClient.js` fångar felet och returnerar `search.error`, UI:t visar inget.

## How to get to it (user POV)

Öppna Utforska → skriv i sökfältet → tryck enter/pil.

## Driving it with Playwright

Spec: `06-UI/e2e/search.test.mjs` (skrivet om 2026-10-28 — den gamla versionen assertade på den omonterade SearchScreen och kunde aldrig passera).

Nycklar:

- Fältet: `data-testid="explore-search-input"` (behållaren) / `explore-search-textinput"` (själva input-elementet).
- Submit: tryck Enter i fältet, eller tryck sökknappen i fältets högra kant.
- Resultatet listas i Utforska-listan; varje rad är `div[role="button"]` (inte `<button>`) med `aria-label="<titel> — <undertext>"`.

Recept: öppna Utforska → fyll i "konsert" → tryck Enter → vänta på att minst en rad har `aria-label` med en titel → öppna första raden → detaljskärmen ska visas.

## Gotchas

- **Harness-drift (fixat 2026-10-28):** den gamla `search.test.mjs` sökte efter `search-screen-input`, `search-date-button`, `search-filter-bar` och en `home-search-button` — ingen av dem existerar i den utskickade appen. Specen testade död kod.
- `data-testid="home-search-button"` finns **inte** i koden. Sökfältet är det enda sökvalet.
- `SearchScreen.js` är död kod som bör tas bort eller återkopplas — inte verifieras.
- Språket styr etiketterna: kör med `locale=sv-SE` (Playwright-configen gör det) annars blir texter engelska.
- Sökfel är tysta — en misslyckad sökning ser ut som "inga träffar". Detta är en produktlucka som bör rapporteras, inte workaroundas i specen.
