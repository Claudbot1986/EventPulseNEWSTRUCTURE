# Save / favorite (♡ Spara)

> **Status 2026-10-28: den här filen var tidigare felaktig.** Varje påstående nedan
> är nu verifierat mot källan. Det som tidigare stod som "sparas lokalt" och
> "replikeras mot backend" gäller **inte** i den utskickade appen.

## Sub-features

- Detaljskortets hjärta (`aria-label="Spara"`) togglar **bara lokal `useState`** i `NewEventCard`. `saved`-propen skickas aldrig in från `App.js` → hjärtet är en bild i skärmminnet och försvinner när skärmen avmonteras.
- `onSave` → `App.js handleSaveToggle` → analytics + toast + `recordEventInteraction({ eventId, interaction:'save' })`.
- `recordEventInteraction` är **auth-gated** — men i den utskickade appen finns **alltid** en session: `AppShell.js:395` → `bootstrapSession()` → `signInAnonymously()` sparar `eventpulse.auth_session`. Så `isAuthenticated()` är `true` även för gäster, och **POST `/agent/feedback` skickas** vid varje spara-flip.
- "Spara"-raden i ⋯-bladet är en **no-op**: `App.js` ignorerar `save`-actionen explicit (`App.js:1723-1735`). Bladet flippar dock sin egen etikett visuellt (`UtforskaEventActionSheet.js:294-299`).
- `06-UI/features/save-favorite/feature.api.js` implementerar lokal persistens (`eventpulse.save-favorite.v1`) men **kopplas inte in i appen** — `feature.ui.js:10` och `feature.test.ts:67` importerar den, men ingen app-ruta använder trädet. Död modul, bara testad av vitest.
- Avmarkering ("Ta bort sparning") rapporteras aldrig till backend.

## How to get to it (user POV)

Öppna ett event → tryck ♡ i kortets ikonrad.

## Driving it with Playwright

Spec: `06-UI/e2e/save-favorite.test.mjs` (**finns redan** — 2 tester, gröna 2026-11-04).

Recept:

1. Öppna Hem → öppna första eventkortet → `event-card-read-more` syns.
2. Assera att `aria-label="Spara"` finns (1 st).
3. Tryck den → `aria-label="Ta bort sparning"` ska synas (UI:et flippar).
4. **Läs tillbaka persistens**: `localStorage` ska **inte** innehålla någon nyckel som matchar `/save|favorite|saved/i`, och `eventpulse.save-favorite.v1` ska vara `null`.
5. Nätverket: det skickas **ett** `POST /agent/feedback` med `interaction:"save"` (den anonyma bootstrap-sessionen räcker). Ett **andra** flip tillbaka ska **inte** skicka något — och det finns ingen `interaction:"unsave"`.
6. Gå tillbaka och öppna eventet igen → hjärtet ska vara **osparat** igen (bevis på att inget sparades).

## Gotchas

- Det som verifieras här är **hur det faktiskt fungerar**, inte hur det borde fungera. Att steg 4 och 6 håller är ett **bevis på en produktslucka**: spara fungerar inte för användaren.
- `recordEventInteraction` tar `{ eventId, interaction }` — inte `{ event_id }` (den äldre filen angav fel signatur).
- Request-body till `/agent/feedback` är `{ session_id, event_id, interaction, reject_reason, query_text, metadata }`.
- Accentfärgen för sparat hjärta är `#FF759E`, inte `#FFB454` (den senare är generell accent).
- `feature.api.js` använder **relativ** URL (`/agent/feedback`) och fältet `interaction_type` — båda fel mot servern. Modulen får inte kopplas in utan att den rättas först.
- `getAuthHeader()` är **async** (`agentClient.js:58`) — `feature.api.js:78` gör `...(getAuthHeader())`, vilket sprider ett Promise. Modulen får inte kopplas in utan att den rättas först.
- Det finns ingen `testID` på hjärtsknappen eller på bladets "Spara"-rad — välj på `aria-label`.
- **2026-11-04:** demologin (`EXPO_PUBLIC_ENABLE_DEMO_LOGIN` + `EXPO_PUBLIC_DEMO_EMAIL`) ger en permanent session → samma enstaka POST, men med inloggad session.
