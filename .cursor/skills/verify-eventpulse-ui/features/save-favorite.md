# save-favorite — feature #1 (live)

Speglar `06-UI/FEATURE_MAP.md` § 1. UI-flödet där användaren markerar ett event som sparat. Persisteras lokalt via AsyncStorage och replikeras mot backend via `POST /agent/feedback` med `interaction: 'save'`.

## Sub-features

- **Toggle-save från bottom-sheet** — ⋯-meny på ett event-kort i Utforska/Hem-flödet. UI-trigger: `06-UI/components/UtforskaEventActionSheet.js` rad 1+ (Spotify-stil bottom-sheet, drag-handle, slide-up). Save-raden är en toggle.
- **API-koppling** — `agentClient.recordEventInteraction({ interaction: 'save', event_id })` postar till `POST /agent/feedback` (se `06-UI/services/agentClient.js:237` och `06-UI/services/agentClient.js:255`).
- **Persistens** — togglen speglas i `06-UI/services/storage.js` AsyncStorage-skiktet. Cross-cutting — används av flera features men specifikt utfall för save-favorite är `EVENTPULSE_SAVED_KEY` eller motsvarande.
- **Optimistisk update** — UI:t flippar tillstånd omedelbart, network call följer i bakgrunden. Båda måste konvergera i slutläge (annars är feature trasig).
- **Visual indicator** — hjärt-ikon (♡/♥) på event-kortet, accent-färg `#FFB454` när aktivt.

## How to get to it (user POV)

1. Öppna appen i webbläsaren (`http://localhost:9090`).
2. Vänta tills Hem-skärmen laddats. Onboarding kan behöva klaras av — sätt `window.localStorage.setItem('eventpulse.onboarding_complete', '1')` i `addInitScript` om du vill skippa. Befintliga spec:er gör detta i `e2e/search.test.mjs:43-45`.
3. Navigera till **Utforska**-tabben (`[role="tab"]` med text "Utforska").
4. Scrolla ner till en event-rad (eller hem-tile). Varje kort har en **⋯**-knapp (tre prickar, vanligen höger sida av kortet).
5. Klicka ⋯ → bottom-sheet öppnas. Sheet-innehåll: Spara-toggle, Följ/-sluta-följ-rader, Inte intresserad, Mindre av kategori, Dela, Öppna i Ticketmaster.
6. Tryck **Spara**. Ikonen flippar från ♡ till ♥. Sheet stängs.

Steg 5–6 har två assertions:
- **UI-state assertion:** hjärt-ikonen är accent-färgad efter tryck (eller innehåller "Sparad"-text i tillgänglighetsnamnet).
- **Network assertion:** `POST /agent/feedback` avfyrades med body `{ interaction: 'save', event_id: <uuid>, client_user_id: <uuid> }`. Med Playwright: `page.on('request', …)` och filtrera på `/agent/feedback` + `request.postDataJSON().interaction === 'save'`.

## Driving it with Playwright

**Helper-redo:** återanvänd `tap()` från `06-UI/e2e/search.test.mjs:15-25`. Skicka `pointerdown` + `pointerup` + `click` i sekvens — `.click()` ensamt räcker inte för `Pressable`.

Spec-skelett att utöka `06-UI/e2e/save-favorite.test.mjs` med:

```javascript
import { test, expect } from '@playwright/test';

async function tap(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }, selector);
}

test.describe('Save-favorite flödet', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('eventpulse.onboarding_complete', '1');
    });
    await page.goto(process.env.BASE_URL || 'http://localhost:9090', { waitUntil: 'networkidle' });
    await page.waitForTimeout(4_000);
  });

  test('toggle-save skickar POST /agent/feedback med interaction=save', async ({ page }) => {
    const feedbackRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/agent/feedback') && req.method() === 'POST') {
        feedbackRequests.push(req.postDataJSON());
      }
    });

    await page.goto((process.env.BASE_URL || 'http://localhost:9090') + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(4_000);

    // navigera till Utforska-tabben
    const utforskaTab = page.locator('[role="tab"]').filter({ hasText: 'Utforska' });
    await utforskaTab.click();
    await page.waitForTimeout(1_500);

    // öppna ⋯-menyn på första event-kortet
    const moreBtn = page.locator('[data-testid*="more"]').first();
    await moreBtn.click();
    await page.waitForTimeout(800);

    // toggla Save
    await tap(page, '[data-testid="action-save"]');
    await page.waitForTimeout(1_500);

    expect(feedbackRequests.length).toBeGreaterThan(0);
    const saveCall = feedbackRequests.find((b) => b.interaction === 'save');
    expect(saveCall).toBeDefined();
    expect(saveCall.event_id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
```

Kör:

```bash
cd 06-UI
BASE_URL=http://localhost:9090 npx playwright test e2e/save-favorite.test.mjs
```

## Gotchas

**Bottom-sheet selector ännu inte låst.** `UtforskaEventActionSheet.js` har action-stubbar — kommentar i toppen av filen nämner att `agentClient.recordEventInteraction` ska kopplas in. Om `[data-testid="action-save"]` inte finns i DOM är feature-filen fortfarande valid, men spec:en behöver antingen vänta på att stubarna blir riktiga, eller använda text-baserade selektorer (`text="Spara"` i roll=button). Drift här = harness gap, fixas i spec:en, inte i feature-filen.

**`EXPO_PUBLIC_AGENT_URL` måste peka på agent-API.** Annars kommer `recordEventInteraction` returnera `{ ok: false, warning: 'config' }` och ingen POST skickas. Bekräfta via Doctor-steget i `SKILL.md` innan du kör.

**Supabase-baserad assertion:** `agent_interactions`-tabellen (om den finns i ditt schema) är där `interaction: 'save'` persisteras. Innan live-drive, bekräfta tabellnamn via en SELECT — driver-side kan då verifiera row count före/efter drive.

**Auth-gate bakom `requireUser`.** Backend-endpointen `/agent/feedback` är user-scoped i `08-Agent/server.ts` (Phase 1). Web drive med anonym användare (`getOrCreateAnonUserId`) → 401. Två sätt att hantera det i drive:
1. Logga in via email-OTP-flödet först (driver-side, dyrt).
2. Generera en test-JWT och bifoga som `Authorization: Bearer <jwt>` — kräver service-role eller test-injector.
3. Annotera testet som `verified-partial`: UI-state flippar (assertion OK), network-anrop går ut men får 401 (bevisar hooken är kopplad).

Välj alternativ 3 om Supabase-inlogg i web drive är för tungt. Kommentera i spec:en *vilken* auth-strategi som används så det inte är dolt.

**toggle-animationen kan lura `.click()`-timingen.** Sheet slide-up tar ~300 ms. Lägg till `await page.waitForTimeout(500)` efter bottom-sheet-öppning innan du tappar Save.

**Race mot agent-hälsokontroll.** UI pingar `/agent/health` i bakgrunden — förväntade console.error-CORS-fel från agent-endpointen. Filtrera bort dem i `page.on('console')` (se mönstret i `06-UI/e2e/search.test.mjs:48-57`).
