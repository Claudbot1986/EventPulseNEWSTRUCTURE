# Sök

## Sub-features

- Sök sker **i Utforska-fliken**, i en ruta högst upp (`data-testid="explore-search-input"`, textfältet `explore-search-textinput`, behållaren har `role="search"`).
- `06-UI/screens/SearchScreen.js` finns kvar men **monteras inte** — `App.js` kommenterar ut att SearchScreen byts mot in-söking i samma vy. Det är **död kod**.
- **Live-sök, ingen submit.** Det finns ingen `onSubmitEditing` och ingen sökknapp. Fältets högra kant har antingen en **rensningsknapp** (`explore-search-clear`) eller en dekorativ chevron (`App.js:1407-1421`).
- **Tröskelvärdet är 3 tecken** (`App.js:1236-1243`), med **350 ms debounce** (`App.js:1245`). Under 3 tecken skickas inget.
- Sökfrågan skickas till agent-API:t (`GET /agent/feed?q=<text>&limit=100&offset=0&days=365`) — `from` utelämnas, servern sätter dagens datum (`08-Agent/server.ts:312-314`). Anropet bär `?locale=<uiLanguage>` **villkorligt** (`if (uiLocale)`, `agentClient.js:764-765`).
- Servern matchar `q` med OR över `title_sv/title_en/description_sv/description_en` **bara** (`08-Agent/tools/feed_events.ts:216-221`).
- Resultaten **ersätter** karusellerna/kategorirutorna med en `UtforskaSection` och eyebrow **`Sökresultat för "<q>"`** (`App.js:1499-1510`, `UtforskaSection.js:398-402`). `searchActive` kräver ≥3 tecken **och** minst en träff (`App.js:1305-1308`).
- Rader visar dessutom en **tvåraders beskrivningsförhandsvisning** (prosa, `UtforskaSection.js:261-272`).
- **Sökfel visas inte för användaren** — fångstället ligger i `App.js:1253-1257` (inte i `agentClient.js`; nyckeln `explore.search.error` används bara av den döda `SearchScreen.js:688`). UI:t ser precis ut som "inga träffar".

## How to get to it (user POV)

Öppna Utforska → skriv minst 3 tecken. Sökningen sker medan du skriver — du behöver inte trycka Enter.

## Driving it with Playwright

Spec: `06-UI/e2e/search.test.mjs` (om-skriven 2026-10-28 — den gamla versionen assertade på den omonterade SearchScreen och kunde aldrig passera). 3 tester gröna 2026-11-04.

Nycklar:

- Fältet: `data-testid="explore-search-input"` (behållaren) / `explore-search-textinput` (själva input-elementet).
- **Ingen submit** — fyll i fältet och vänta ~6 s.
- Resultatlistan: `[data-testid="utforska-section-screen"]` med eyebrow `Sökresultat för "<q>"`.
- Raderna är `<button>` med `aria-label="<titel> — <datum·tid · venue·area>"` (verifierat live 2026-11-04) plus en `⋯`-knapp med `aria-label="Fler alternativ"`.

Recept: öppna Utforska → fyll i "konsert" (tryck **inte** Enter) → vänta på `utforska-section-screen` → assert texten `/Sökresultat för "konsert"/i` → öppna första raden → detaljskärmen ska visas. Regression: fyll i "ab" (2 tecken) → inget `/agent/feed?q=`-anrop inom 2 s.

## Gotchas

- **Harness-drift (fixat 2026-10-28):** den gamla `search.test.mjs` sökte efter `search-screen-input`, `search-date-button`, `search-filter-bar` och en `home-search-button` — ingen av dem existerar i den utskickade appen. Specen testade död kod.
- `data-testid="home-search-button"` finns **inte** i koden. Sökfältet är det enda sökvalet.
- **Rättat 2026-11-04:** "tryck Enter / tryck sökknappen" fanns inte — det finns ingen submit. Sökningen är live efter 350 ms.
- **Rättat 2026-11-04:** "≥3 tecken" saknades i kartan. Under 3 tecken händer ingenting.
- `SearchScreen.js` är död kod som bör tas bort eller återkopplas — inte verifieras.
- Språket styr etiketterna: kör med `locale=sv-SE` (Playwright-configen gör det) annars blir texter engelska.
- Sökfel är tysta — en misslyckad sökning ser ut som "inga träffar". Detta är en produktlucka som bör rapporteras, inte workaroundas i specen.
- **Produktlucka (hittad 2026-11-04):** servern söker bara i `description_sv/en`, medan listan visar prosa ur `editorial_description` ⇒ ord som syns i appen kan sakna träff. DB-täckningen är inte mätt.
