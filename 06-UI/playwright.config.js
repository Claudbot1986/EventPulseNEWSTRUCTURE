/**
 * Playwright E2E configuration for EventPulse Expo app.
 *
 * Run E2E tests:
 *   npx playwright test                  # run all test files
 *   npx playwright test e2e/home.test.mjs  # run home screen tests only
 *
 * Visual regression (Stream B.2): baselines sparas under
 * e2e/visual-regression/baseline/ via snapshotPathTemplate. Standard-sökvägen
 * `<spec>-snapshots/` är svår att hitta i kodgranskning; vi peggar
 * baselinen på en förutsägbar plats som täcks av FEATURE_MAP.
 *
 * The Metro dev server must be running on port 8081 before running tests:
 *   cd 06-UI && npx expo start --host lan --port 8081
 *
 * Or set BASE_URL to point at any running EventPulse instance:
 *   BASE_URL=http://localhost:8081 npx playwright test
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // 2026-10-28 — Appen läser språk från enhetens locale. Utan detta läge
    // renderar RN-web den engelska fallback-texten ("Music", "Save", "Back")
    // och alla svenska selektorer i e2e-specarna träffar ingenting.
    // EventPulse är en svensk produkt → verifiera mot svensk locale.
    locale: process.env.UI_LOCALE || 'sv-SE',
    timezoneId: 'Europe/Stockholm',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Stream B.2 (Agent Trust Plan 2026-10-09): pegga visual-regression
  // baselines under e2e/visual-regression/baseline/. {arg} = namnet i
  // expect(page).toHaveScreenshot('name'); {platform} = 'darwin' etc.
  //   Resultat: e2e/visual-regression/baseline/<name>-darwin.png
  // Om du flyttar filen, glöm inte att committa både spec + baseline.
  snapshotPathTemplate:
    'e2e/visual-regression/baseline/{arg}-{platform}{ext}',
});
