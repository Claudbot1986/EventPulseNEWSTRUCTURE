/**
 * Spara/favorite — bevis på hur det FAKTISKT fungerar.
 *
 * 2026-10-28 — filen `features/save-favorite.md` påstod att spara persisteras
 * lokalt och replikeras mot backend. Det stämmer INTE. Specen verifierar
 * därför **verkligeten**: UI:t flippar, men ingenting sparas.
 *
 * Att detta test PASSAR är ett bevis på en produktslucka — inte på att
 * funktionen fungerar. Om hjärtet börjar persisteras måste specen skrivas om.
 *
 *   cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/save-favorite.test.mjs
 */

import { test, expect } from '@playwright/test';
import { boot, collectErrors } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';

/** Öppna första eventkortet på Hem. */
async function openFirstCard(page) {
  await page.evaluate(() => {
    const home = document.querySelector('[data-testid="home-screen"]');
    if (!home) return;
    const card = Array.from(home.querySelectorAll('button, [role="button"]')).find((el) => {
      const r = el.getBoundingClientRect();
      const label = el.getAttribute('aria-label') || '';
      return r.width > 0 && r.height > 0 && label.includes(' — ');
    });
    if (!card) return;
    const opts = {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 1,
    };
    card.dispatchEvent(new PointerEvent('pointerdown', opts));
    card.dispatchEvent(new PointerEvent('pointerup', opts));
    card.dispatchEvent(new MouseEvent('click', opts));
  });
  await page.waitForTimeout(2_500);
}

/** Tryck på ett element via pointer-events (RN-web). */
async function tapLabel(page, label) {
  return page.evaluate((needle) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const el = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .find((n) => (n.getAttribute('aria-label') || '').trim() === needle);
    if (!el) return false;
    const opts = {
      bubbles: true,
      cancelable: true,
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 1,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }, label);
}

test.describe('Spara/favorite — verkligt beteende', () => {
  test.setTimeout(120_000);

  test('hjärtat flippar men ingenting persisteras', async ({ page }) => {
    const errors = collectErrors(page);
    const feedbackPosts = [];
    page.on('request', (req) => {
      if (req.url().includes('/agent/feedback') && req.method() === 'POST') {
        feedbackPosts.push(req.postData());
      }
    });

    await boot(page, BASE_URL);
    await openFirstCard(page);
    await expect(page.getByTestId('event-card-read-more')).toBeVisible();

    // 1. Spara-knappen finns.
    const save = page.locator('[aria-label="Spara"]');
    await expect(save).toHaveCount(1);

    // 2. Tryck → UI flippar till "Ta bort sparning".
    const tapped = await tapLabel(page, 'Spara');
    expect(tapped, 'gick inte att trycka på Spara').toBe(true);
    await page.waitForTimeout(1_500);
    await expect(page.locator('[aria-label="Ta bort sparning"]')).toBeVisible();

    // 3. Läs tillbaka persistens — det finns ingen.
    const storage = await page.evaluate(() => ({
      keys: Object.keys(window.localStorage),
      saveKey: window.localStorage.getItem('eventpulse.save-favorite.v1'),
      savedKey: window.localStorage.getItem('eventpulse.saved'),
    }));
    console.log(`\nlocalStorage-nycklar: ${JSON.stringify(storage.keys)}`);
    console.log(`eventpulse.save-favorite.v1 = ${storage.saveKey}`);
    console.log(`POST /agent/feedback under session: ${feedbackPosts.length}`);

    expect(
      storage.keys.filter((k) => /save|favorite|saved/i.test(k)),
      'inga spar-nycklar får finnas i localStorage',
    ).toEqual([]);
    expect(storage.saveKey).toBeNull();

    // 4. Ingen session → ingen feedback-POST (agentClient gate:ar på auth).
    const hasSession = await page.evaluate(() => !!window.localStorage.getItem('eventpulse.auth_session'));
    if (!hasSession) {
      expect(feedbackPosts, 'utan session ska ingen /agent/feedback skickas').toEqual([]);
    }

    expect(errors.filter((e) => !/429/.test(e.text))).toEqual([]);
  });

  test('efter att ha lämnat eventet är hjärtat osparat igen (inget sparades)', async ({ page }) => {
    await boot(page, BASE_URL);
    await openFirstCard(page);
    await expect(page.getByTestId('event-card-read-more')).toBeVisible();

    await tapLabel(page, 'Spara');
    await page.waitForTimeout(1_000);
    await expect(page.locator('[aria-label="Ta bort sparning"]')).toBeVisible();

    // Tillbaka + öppna samma event igen.
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('body *')).find(
        (n) => n.children.length === 0 && (n.textContent || '').trim() === '< Tillbaka',
      );
      if (!el) return;
      const opts = {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 1,
      };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    });
    await page.waitForTimeout(2_000);
    await openFirstCard(page);
    await page.waitForTimeout(2_000);

    // Hjärtsknappen ska vara tillbaka på "Spara" (osparat).
    await expect(page.locator('[aria-label="Spara"]')).toHaveCount(1);
    await expect(page.locator('[aria-label="Ta bort sparning"]')).toHaveCount(0);
  });
});
