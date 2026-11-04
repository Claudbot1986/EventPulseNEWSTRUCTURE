/**
 * Demo-inloggning för App Store-granskning (guideline 2.1).
 *
 * Kräver att bygget har EXPO_PUBLIC_ENABLE_DEMO_LOGIN=true och
 * EXPO_PUBLIC_DEMO_EMAIL/_PASSWORD i omgivningen (ligger i 06-UI/.env).
 * Utan flaggan ska demodelen INTE finnas i UI:t — testet täcker båda fallen.
 *
 *   cd 06-UI && BASE_URL=http://localhost:9090 npx playwright test e2e/demo-login.test.mjs
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { boot, collectErrors, tap, tapTab, tapText } from './helpers/ui.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:9090';
const OUT = process.env.UI_EVIDENCE_DIR || `runtime/verification-reports/ui-verify-${new Date().toISOString().replace(/[:.]/g, '-')}`;

/**
 * Metro laddar 06-UI/.env (`scripts/launch-metro.sh` gör `. ./.env`) — appen
 * under test ser alltså de flaggor som står i filen. Playwright-processen gör
 * det inte, så specen läser samma fil själv. Utan det här trodde specen att
 * flaggan var AV medan appen hade den PÅ, och det negativa fallet föll.
 */
function readDotEnv(file) {
  try {
    const out = {};
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const dotEnv = readDotEnv(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
);
const envValue = (key) => process.env[key] ?? dotEnv[key];

const DEMO_EMAIL = envValue('EXPO_PUBLIC_DEMO_EMAIL');
const DEMO_PASSWORD = envValue('EXPO_PUBLIC_DEMO_PASSWORD');
const DEMO_ENABLED = envValue('EXPO_PUBLIC_ENABLE_DEMO_LOGIN') === 'true';

async function openLogin(page) {
  await tapTab(page, 'Profil');
  await page.waitForTimeout(2_000);
  const res = await tapText(page, 'Lägg till e-post');
  expect(res.ok, 'kunde inte öppna inloggningen från Profil').toBe(true);
  await page.waitForTimeout(1_500);
}

test.describe('Demologin för App Review', () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  test('demologinen syns i inloggningen när flaggan är på', async ({ page }) => {
    test.skip(!DEMO_ENABLED, 'flaggan EXPO_PUBLIC_ENABLE_DEMO_LOGIN är inte satt');
    test.skip(!DEMO_EMAIL || !DEMO_PASSWORD, 'demo-uppgifter saknas i miljön');

    const errors = collectErrors(page);
    await boot(page, BASE_URL);
    await openLogin(page);

    const emailField = page.locator('[data-testid="demo-login-email"]');
    const passwordField = page.locator('[data-testid="demo-login-password"]');
    const submit = page.locator('[data-testid="demo-login-submit"]');

    await expect(emailField, 'demofältet för email saknas').toBeVisible();
    await expect(passwordField, 'demofältet för lösenord saknas').toBeVisible();
    await expect(submit, 'demoknappen saknas').toBeVisible();

    await page.screenshot({ path: `${OUT}/demo-login-form.png` });

    const realErrors = errors.filter((e) => !/429/.test(e.text));
    expect(realErrors, `Konsolfel: ${JSON.stringify(realErrors, null, 2)}`).toEqual([]);
  });

  test('inloggning med demo-konto ger en signerad session', async ({ page }) => {
    test.skip(!DEMO_ENABLED, 'flaggan EXPO_PUBLIC_ENABLE_DEMO_LOGIN är inte satt');
    test.skip(!DEMO_EMAIL || !DEMO_PASSWORD, 'demo-uppgifter saknas i miljön');

    const errors = collectErrors(page);
    await boot(page, BASE_URL);
    await openLogin(page);

    await page.locator('[data-testid="demo-login-email"]').fill(DEMO_EMAIL);
    await page.locator('[data-testid="demo-login-password"]').fill(DEMO_PASSWORD);
    await tap(page, '[data-testid="demo-login-submit"]');
    await page.waitForTimeout(6_000);

    await page.screenshot({ path: `${OUT}/demo-login-result.png` });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText, 'demo-inloggningen misslyckades — felmeddelande i UI:t').not.toMatch(
      /Kunde inte logga in som demo|Could not sign in as demo/,
    );
    expect(bodyText, 'kontot visas inte som inloggat').toMatch(/Inloggad|Signed in|Accesso effettuato/i);

    const realErrors = errors.filter((e) => !/429/.test(e.text));
    expect(realErrors, `Konsolfel: ${JSON.stringify(realErrors, null, 2)}`).toEqual([]);
  });

  test('utan flaggan finns ingen demodel i UI:t', async ({ page }) => {
    test.skip(DEMO_ENABLED, 'flaggan är på — fallet täcks av testet ovan');

    await boot(page, BASE_URL);
    await openLogin(page);

    await expect(
      page.locator('[data-testid="demo-login-submit"]'),
      'demologin syns trots att flaggan är av',
    ).toHaveCount(0);
  });
});
