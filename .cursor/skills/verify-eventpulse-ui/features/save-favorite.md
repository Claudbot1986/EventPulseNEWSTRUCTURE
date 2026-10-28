# Save / favorite (♡ Spara)

> **Status 2026-10-28: den här filen var tidigare felaktig.** Varje påstående nedan
> är nu verifierat mot källan. Det som tidigare stod som "sparas lokalt" och
> "replikeras mot backend" gäller **inte** i den utskickade appen.

## Sub-features

- Detaljskortets hjärta (`aria-label="Spara"`) togglar **bara lokal `useState`** i `NewEventCard`. `saved`-propen skickas aldrig in från `App.js` → hjärtet är en bild i skärmminnet och försvinner när skärmen avmonteras.
- `onSave` → `App.js handleSaveToggle` → analytics + toast + `recordEventInteraction({ eventId, interaction:'save' })`.
- `recordEventInteraction` är **auth-gated**: utan Supabase-session returnerar den `{ok:false, warning:'auth'}` **utan** att göra något nätanrop.
- "Spara"-raden i ⋯-bladet är en **no-op**: `App.js` ignorerar `save`-actionen explicit.
- `06-UI/features/save-favorite/feature.api.js` implementerar lokal persistens (`eventpulse.save-favorite.v1`) men **importeras ingenstans** — död modul, bara testad av vitest.
- Avmarkering ("Ta bort sparning") rapporteras aldrig till backend.

## How to get to it (user POV)

Öppna ett event → tryck ♡ i kortets ikonrad.

## Driving it with Playwright

Spec: `06-UI/e2e/save-favorite.test.mjs` (skapa den utifrån receptet nedan).

Recept:

1. Öppna Hem → öppna första eventkortet → `event-card-read-more` syns.
2. Assera att `aria-label="Spara"` finns (1 st).
3. Tryck den → `aria-label="Ta bort sparning"` ska synas (UI:et flippar).
4. **Läs tillbaka persistens**: `localStorage` ska **inte** innehålla någon nyckel som matchar `/save|favorite/i`, och `eventpulse.save-favorite.v1` ska vara `null`.
5. Nätverket: utan session ska **något** `POST /agent/feedback` inte ha skickats.
6. Gå tillbaka och öppna eventet igen → hjärtet ska vara **osparat** igen (bevis på att inget sparades).

## Gotchas

- Det som verifieras här är **hur det faktiskt fungerar**, inte hur det borde fungera. Att steg 4–6 håller är ett **bevis på en produktslucka**: spara fungerar inte för användaren.
- `recordEventInteraction` tar `{ eventId, interaction }` — inte `{ event_id }` (den äldre filen angav fel signatur).
- Request-body till `/agent/feedback` är `{ session_id, event_id, interaction, reject_reason, query_text, metadata }`.
- Accentfärgen för sparat hjärta är `#FF759E`, inte `#FFB454` (den senare är generell accent).
- `feature.api.js` använder **relativ** URL (`/agent/feedback`) och fältet `interaction_type` — båda fel mot servern. Modulen får inte kopplas in utan att den rättas först.
- Det finns ingen `testID` på hjärtsknappen eller på bladets "Spara"-rad — välj på `aria-label`.
