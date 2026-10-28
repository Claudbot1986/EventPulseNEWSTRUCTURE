/**
 * Eventkortets knappar: varje knapp i ett öppnat eventkort ska tryckas
 * utan krasch och utan konsolfel, och kortet ska överleva trycken.
 *
 *   cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/event-detail-buttons.test.mjs
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { boot, collectErrors, tap, tapText } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';
const OUT = process.env.UI_EVIDENCE_DIR || `runtime/verification-reports/ui-verify-${new Date().toISOString().replace(/[:.]/g, '-')}`;

/** Öppna det första eventkortet på Hem och returnera detaljskärmen. */
async function openFirstCard(page) {
  await boot(page, BASE_URL);
  const aria = await page.evaluate(() => {
    const home = document.querySelector('[data-testid="home-screen"]');
    if (!home) return null;
    const card = Array.from(home.querySelectorAll('button, [role="button"]')).find((el) => {
      const r = el.getBoundingClientRect();
      const label = el.getAttribute('aria-label') || '';
      return r.width > 0 && r.height > 0 && label.includes(' — ');
    });
    if (!card) return null;
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
    return card.getAttribute('aria-label');
  });
  await page.waitForTimeout(2_500);
  return aria;
}

/** Alla synliga knappar i detaljskortet, med deras aria-label. */
async function cardButtons(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .map((el) => ({
        aria: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 60),
        testid: el.getAttribute('data-testid'),
        hasNested: !!el.querySelector('button'),
      }));
  });
}

test.describe('Eventkort — alla knappar', () => {
  // 6 knappar × (tryck + 1,5 s + screenshot) → översteg default-timeout.
  test.setTimeout(120_000);

  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('varje knapp i eventkortet kan tryckas utan fel', async ({ page }) => {
    const errors = collectErrors(page);
    const cardLabel = await openFirstCard(page);
    expect(cardLabel, 'hittade inget eventkort på Hem').toBeTruthy();

    await expect(page.getByTestId('event-card-read-more')).toBeVisible();
    await page.screenshot({ path: `${OUT}/eventkort-öppnat.png` });

    const buttons = await cardButtons(page);
    // Spara, karta, kalender, dela, mer, läs mer + kortets egen yta.
    const expected = ['Spara', 'Visa karta', 'Lägg till i kalender', 'Dela', 'Fler alternativ', 'Läs mer'];
    for (const label of expected) {
      expect(
        buttons.some((b) => (b.aria || '').includes(label)),
        `knappen "${label}" finns inte i eventkortet (fanns: ${buttons.map((b) => b.aria).join(' | ')})`,
      ).toBe(true);
    }

    const results = [];
    for (const label of expected) {
      const before = errors.length;
      const tapped = await tapText(page, label);
      await page.waitForTimeout(1_500);

      const newErrors = errors.slice(before);
      const stillAlive = await page.getByTestId('event-card-read-more').isVisible().catch(() => false);
      const bodyText = await page.locator('body').innerText();

      await page.screenshot({ path: `${OUT}/eventkort-${label.replace(/[^\w-]+/g, '_')}.png` });

      results.push({
        label,
        tapped: tapped.ok,
        newErrors: newErrors.map((e) => e.text.slice(0, 160)),
        detailStillOpen: stillAlive,
        toast: /sparad|kopierad|kunde inte|fel/i.test(bodyText),
      });

      // Stäng eventuella sheet/modal som öppnades, så nästa knapp kan testas.
      await tapText(page, 'Stäng').catch(() => {});
      await page.waitForTimeout(400);
    }

    console.log(`\nEventkort: ${cardLabel}`);
    console.log(JSON.stringify(results, null, 2));

    for (const r of results) {
      expect(r.tapped, `knappen "${r.label}" gick inte att trycka`).toBe(true);
      expect(r.detailStillOpen, `detaljskärmen stängdes av knappen "${r.label}"`).toBe(true);
    }

    // Inga konsolfel får slås upp av knapptrycken. 2026-10-28: nested-button-
    // varningen är FIXAD (NewEventCard renderar roten som View när onPress
    // saknas) och räknas därför inte längre undantagen — den skulle fångas
    // här om fixen gått sönder. 429 är agent-API:t rate limiter.
    const realErrors = errors.filter((e) => !/429/.test(e.text));
    expect(realErrors, `Konsolfel från knapptryck: ${JSON.stringify(realErrors, null, 2)}`).toEqual([]);
  });

  test('kortet innehåller inte kapslade knappar (HTML-validitet)', async ({ page }) => {
    await openFirstCard(page);
    const nested = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((b) => b.querySelector('button'))
        .map((b) => b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 60)),
    );
    console.log(`\nKnappar med kapslade knappar: ${nested.length ? nested.join(' | ') : 'inga'}`);
    expect(nested, 'eventkortet får inte innehålla kapslade <button>-element').toEqual([]);
  });

  test('"Tillbaka" stänger detaljskortet och Hem återkommer', async ({ page }) => {
    await openFirstCard(page);
    await expect(page.getByTestId('event-card-read-more')).toBeVisible();

    const back = await tapText(page, 'Tillbaka');
    expect(back.ok).toBe(true);
    await page.waitForTimeout(1_500);

    await expect(page.getByTestId('home-screen')).toBeVisible();
    await expect(page.getByTestId('event-card-read-more')).toHaveCount(0);
  });
});
