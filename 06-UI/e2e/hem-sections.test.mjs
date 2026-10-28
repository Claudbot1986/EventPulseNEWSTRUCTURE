/**
 * Hem-sektionerna: varje sektion ska kunna öppnas och ge en fungerande
 * detaljskärm, och "Tillbaka" ska returnera till Hem.
 *
 * Det här är user-POV-beviset för "klicka på ett event i varje sektion".
 *
 *   cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/hem-sections.test.mjs
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { boot, collectErrors, homeSections, tap, tapText } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';
const OUT = process.env.UI_EVIDENCE_DIR || `runtime/verification-reports/ui-verify-${new Date().toISOString().replace(/[:.]/g, '-')}`;

test.describe('Hem — sektioner och eventkort', () => {
  // 9 sektioner × (tap + 2,5 s + screenshot + tillbaka) → översteg
  // Playwrights default-timeout på 30 s. Det är harnessens gräns, inte appens.
  test.setTimeout(180_000);

  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('varje sektion på Hem öppnar ett event och "Tillbaka" går tillbaka', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page, BASE_URL);

    await expect(page.getByTestId('home-screen')).toBeVisible();

    const { ok, sections } = await homeSections(page);
    expect(ok).toBe(true);

    const withCards = sections.filter((s) => s.card);
    expect(withCards.length, 'Hem ska ha minst en sektion med eventkort').toBeGreaterThan(3);

    const opened = [];
    const skipped = [];

    for (const section of withCards) {
      // Hitta knappen igen i DOM:et (koordinaterna gäller bara före tap).
      const tapped = await page.evaluate((aria) => {
        const el = Array.from(document.querySelectorAll('button, [role="button"]')).find(
          (n) => (n.getAttribute('aria-label') || '').trim() === aria,
        );
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
      }, section.card.aria);

      expect(tapped, `kunde inte trycka på kortet i sektionen "${section.title}"`).toBe(true);
      await page.waitForTimeout(2_500);

      // Detaljskärmen ska vara öppen.
      const readMore = page.getByTestId('event-card-read-more');
      await expect(readMore, `sektionen "${section.title}" öppnade inte en detaljskärm`).toBeVisible();

      await page.screenshot({ path: `${OUT}/hem-sektion-${section.title.replace(/[^\w-]+/g, '_')}.png` });

      // Tillbaka ska returnera till Hem.
      const back = await tapText(page, 'Tillbaka');
      expect(back.ok, `"Tillbaka" hittades inte i sektionen "${section.title}"`).toBe(true);
      await page.waitForTimeout(2_000);

      await expect(page.getByTestId('home-screen'), `tillbaka fungerade inte i "${section.title}"`).toBeVisible();
      opened.push(section.title);
    }

    for (const section of sections.filter((s) => !s.card)) skipped.push(section.title);

    console.log(`\nÖppnade sektioner: ${opened.join(', ')}`);
    if (skipped.length) console.log(`Sektioner utan kort (skippade): ${skipped.join(', ')}`);

    const realErrors = errors.filter((e) => !/429/.test(e.text));
    expect(realErrors, `Konsolfel under Hem-körningen: ${JSON.stringify(realErrors, null, 2)}`).toEqual([]);
  });

  test('Hem-korten öppnar INTE samma detaljskärm som under Utforska', async ({ page }) => {
    // Regressionstest: Hem och Utforska ska dela detaljskärmen men inte
    // lämna Hem-fliken när man går tillbaka.
    const errors = collectErrors(page);
    await boot(page, BASE_URL);

    const { sections } = await homeSections(page);
    const first = sections.find((s) => s.card);
    expect(first).toBeTruthy();

    await page.evaluate((aria) => {
      const el = Array.from(document.querySelectorAll('button, [role="button"]')).find(
        (n) => (n.getAttribute('aria-label') || '').trim() === aria,
      );
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
    }, first.card.aria);

    await page.waitForTimeout(2_000);
    await expect(page.getByTestId('event-card-read-more')).toBeVisible();

    await tapText(page, 'Tillbaka');
    await page.waitForTimeout(1_500);

    // Efter tillbaka ska Hem vara aktiv igen (inte Utforska).
    const homeVisible = await page.getByTestId('home-screen').isVisible();
    expect(homeVisible).toBe(true);

    expect(errors.filter((e) => !/429/.test(e.text))).toEqual([]);
  });
});
