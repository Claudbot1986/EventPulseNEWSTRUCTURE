/**
 * App-skalet: alla fem flikar ska öppnas utan krasch, och Hem ska vara
 * tillbaka efteråt. Detta är grundpassertet innan feature-specar körs.
 *
 *   cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/app-tabs.test.mjs
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { boot, collectErrors, tapTab } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';
const OUT = process.env.UI_EVIDENCE_DIR || `runtime/verification-reports/ui-verify-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const TABS = ['Hem', 'Utforska', 'Karta', 'Notiser', 'Profil'];

test.describe('App-skalet — flikar', () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('alla fem flikar öppnas utan konsolfel', async ({ page }) => {
    const errors = collectErrors(page);
    await boot(page, BASE_URL);

    for (const tab of TABS) {
      const res = await tapTab(page, tab);
      expect(res.ok, `fliken "${tab}" hittades inte`).toBe(true);
      await page.waitForTimeout(3_000);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText.length, `fliken "${tab}" renderade inget`).toBeGreaterThan(20);
      expect(bodyText, `fliken "${tab}" visar ett render-fel`).not.toMatch(/Render Error|doesn't exist/i);

      await page.screenshot({ path: `${OUT}/flik-${tab.toLowerCase()}.png` });
    }

    // Tillbaka till Hem.
    await tapTab(page, 'Hem');
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId('home-screen')).toBeVisible();

    const realErrors = errors.filter((e) => !/429/.test(e.text));
    expect(realErrors, `Konsolfel under flikbyten: ${JSON.stringify(realErrors, null, 2)}`).toEqual([]);
  });

  test('appen laddar events från agent-API:t (ingen tom feed)', async ({ page }) => {
    const feedRequests = [];
    const feedResponses = [];
    page.on('request', (req) => {
      if (req.url().includes('/agent/feed')) feedRequests.push(req.url());
    });
    page.on('response', (res) => {
      if (res.url().includes('/agent/feed')) feedResponses.push({ url: res.url(), status: res.status() });
    });

    await boot(page, BASE_URL);
    await page.waitForTimeout(3_000);

    const bodyText = await page.locator('body').innerText();
    const cards = await page.evaluate(
      () => document.querySelectorAll('[data-testid="home-screen"] button, [data-testid="home-screen"] [role="button"]').length,
    );

    console.log(`\nFeed-anrop: ${feedRequests.length}`);
    feedResponses.slice(0, 5).forEach((r) => console.log(`  ${r.status} ${r.url.slice(0, 120)}`));
    console.log(`Eventkort på Hem: ${cards}`);

    expect(feedRequests.length, 'ingen feed-anrop gjordes').toBeGreaterThan(0);
    expect(
      feedResponses.some((r) => r.status >= 200 && r.status < 300),
      `feed-svar: ${JSON.stringify(feedResponses)}`,
    ).toBe(true);
    expect(cards, 'inga eventkort renderades').toBeGreaterThan(3);
    expect(bodyText).not.toMatch(/Failed to load events|Kunde inte ladda/i);
  });
});
