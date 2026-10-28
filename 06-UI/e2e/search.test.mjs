/**
 * Live-sök i Utforska.
 *
 * 2026-10-28 — SKRIVEN OM. Den gamla specen testade `SearchScreen`
 * (`search-screen-input`, `search-filter-bar`, `search-date-button`), en skärm
 * som inte längre monteras — alla dess assertioner träffade död kod och
 * kunde aldrig passera. Live-sökningen sker nu INLINE i Utforska: skriv ≥3
 * tecken → servernsök (`/agent/feed?q=`) → karusellerna byts mot en vertikal
 * träfflista med eyebrow "Sökresultat för "<q>"".
 *
 *   cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/search.test.mjs
 */

import { test, expect } from '@playwright/test';
import { boot, collectErrors, tapTab } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';

test.describe('Utforska — live-sök', () => {
  test.setTimeout(120_000);

  test('sökrutan finns i Utforska (och inte på Hem)', async ({ page }) => {
    await boot(page, BASE_URL);

    // Hem har ingen sökknapp — sökfältet bor i Utforska.
    expect(await page.getByTestId('home-search-button').count()).toBe(0);

    await tapTab(page, 'Utforska');
    await page.waitForTimeout(2_500);

    const input = page.getByTestId('explore-search-input');
    await expect(input).toBeVisible();
  });

  test('≥3 tecken triggar serversök och listan byts mot träffar', async ({ page }) => {
    const errors = collectErrors(page);
    const feedRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/agent/feed')) feedRequests.push(req.url());
    });

    await boot(page, BASE_URL);
    await tapTab(page, 'Utforska');
    await page.waitForTimeout(2_500);

    const field = page.getByTestId('explore-search-textinput');
    await expect(field).toBeVisible();
    await field.fill('jazz');
    await page.waitForTimeout(6_000);

    const qCalls = feedRequests.filter((u) => /[?&]q=/.test(u));
    console.log(`\nfeed-anrop: ${feedRequests.length}, varav med q=: ${qCalls.length}`);
    qCalls.slice(0, 3).forEach((u) => console.log('  ' + u.slice(0, 160)));

    expect(qCalls.length, 'ingen serversök med q-parametern skickades').toBeGreaterThan(0);
    expect(
      qCalls.some((u) => /q=jazz/i.test(u)),
      `q=jazz hittades inte i: ${JSON.stringify(qCalls)}`,
    ).toBe(true);

    // Resultatlistan ersätter karusellerna: eyebrow "Sökresultat för "jazz"".
    const bodyText = await page.locator('body').innerText();
    const hasResults = /Sökresultat för/i.test(bodyText);
    console.log(`\nSökresultat-eyebrow synligt: ${hasResults}`);
    console.log(`Body (första 400): ${bodyText.slice(0, 400).replace(/\n/g, ' / ')}`);

    // Antingen träffar (eyebrow synligt) eller ett ärligt tomt läge —
    // aldrig en krasch.
    expect(hasResults || /Inga träffar/i.test(bodyText)).toBe(true);
    expect(bodyText).not.toMatch(/Render Error|doesn't exist/i);

    const realErrors = errors.filter((e) => !/429/.test(e.text));
    expect(realErrors, `Konsolfel under sökningen: ${JSON.stringify(realErrors, null, 2)}`).toEqual([]);
  });

  test('att rensa fältet återför karusellerna', async ({ page }) => {
    await boot(page, BASE_URL);
    await tapTab(page, 'Utforska');
    await page.waitForTimeout(2_500);

    const field = page.getByTestId('explore-search-textinput');
    await field.fill('jazz');
    await page.waitForTimeout(6_000);

    await field.fill('');
    await page.waitForTimeout(3_000);

    const bodyText = await page.locator('body').innerText();
    // Efter rensning ska karusellerna (t.ex. "Musik") vara tillbaka.
    expect(bodyText).toMatch(/Musik|Kategori|Kategorier/i);
  });
});
