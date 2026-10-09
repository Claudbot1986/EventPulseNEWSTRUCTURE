/**
 * EventPulse — Visual Regression Pipeline.
 *
 * Stream B.2 (Agent Trust Plan 2026-10-09).
 *
 * Strategi: använd Playwrights inbyggda `toHaveScreenshot()` (tillgänglig
 * sedan Playwright 1.13; vi kör 1.62). Baselines committas i
 * `baseline/` (Playwrights default-snapshot-beteende — `__snapshots__/`
 * används inte för att göra det lätt att hitta dem och säkerställa att de
 * faktiskt följer med i git).
 *
 * Krav för att köra mot riktiga skärmar (HEM / UTFORSKA / KARTA / AGENT):
 *   - Metro dev server: `cd 06-UI && npx expo start --host lan --port 8081`
 *   - Eller något som svarar på BASE_URL (default http://localhost:8081).
 *
 * Smoke-test (utan Metro): kör `--grep @visual-self-test` — verifierar
 * pipeline-mekaniken själv (rendering + diff) mot en inline-fixture,
 * INTE riktig app. Detta är den verifieringsväg CI kan köra även utan
 * att appen kan byggas.
 *
 * Tröskelvärde: 0.5% av pixlarna får skilja (`maxDiffPixelRatio: 0.005`).
 * Hårdare än Pstack-default men toleransen ska vara generös nog att inte
 * fånga font-renderings-buggar i CI.
 *
 * Run:
 *   npx playwright test e2e/visual-regression/visual-regression.spec.mjs
 *
 * Generera baseline (första gången):
 *   npx playwright test e2e/visual-regression/visual-regression.spec.mjs
 *     --update-snapshots --grep '@visual-live'
 *
 * Smoke-test:
 *   npx playwright test e2e/visual-regression/visual-regression.spec.mjs
 *     --grep '@visual-self-test'
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const DIFF_THRESHOLD = 0.005; // 0.5% pixlar — generös för font-rendering

// ─── Hjälpare ────────────────────────────────────────────────────────────────

/** Navigera till en Metro-route och vänta tills hydrering är klar. */
async function gotoApp(page, route = '/') {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
  // Expo + React 19 hydrerar gradvis — ge Metro en stund att slutföra.
  await page.waitForTimeout(2500);
}

/** Standard-screenshot-options. */
const shot = (name) => ({
  name,
  maxDiffPixelRatio: DIFF_THRESHOLD,
  animations: 'disabled',
  caret: 'hide',
});

// ─── Self-test: verifierar att pipeline-mekaniken fungerar ──────────────────

test.describe('@visual-self-test — pipeline-mekanik', () => {
  test('baseline-fixture matchar exakt (ingen diff)', async ({ page }) => {
    // Ren HTML-fixture — verifierar att Playwrights screenshot-diff är
    // bit-exakt deterministisk för samma input. Om detta failar är det
    // pipeline-infrastrukturen som är trasig (CI-bug, font-cache, etc),
    // INTE app-koden.
    const html = `
      <!DOCTYPE html>
      <html><head>
        <style>
          body { margin: 0; padding: 0; font-family: monospace; }
          .card { width: 320px; height: 200px; background: #F0B01C; padding: 20px; }
          h1 { color: #000; font-size: 24px; margin: 0 0 8px 0; }
          p { color: #333; font-size: 14px; }
        </style>
      </head><body>
        <div class="card">
          <h1>Visual Regression Baseline</h1>
          <p>Saffron-orange #F0B01C är EventPulse accent-färg.</p>
        </div>
      </body></html>
    `;
    await page.setContent(html, { waitUntil: 'load' });
    await page.setViewportSize({ width: 400, height: 280 });

    await expect(page).toHaveScreenshot(shot('self-test-baseline.png'));
  });

  test('ändring i CSS triggar diff (regression-fångst)', async ({ page }) => {
    // Stegvis regression-test:
    //   A. Generera baseline (röd) med --update-snapshots.
    //   B. Utan --update-snapshots: rendera BLÅ variant → förvänta diff
    //      över 0.5%-tröskeln.
    //
    // Implementation: vi kan inte committa en separat baseline inline, så vi
    // använder två separata test-fixturer som båda commitas i baseline/.
    // Första self-test (baseline-fixture matchar exakt) verifierar att
    // match-grenen är korrekt; denna test verifierar att diff-grenen
    // reagerar korrekt.
    const blueHtml = `
      <!DOCTYPE html>
      <html><head>
        <style>
          body { margin: 0; padding: 0; font-family: monospace; }
          .card {
            width: 320px; height: 200px;
            background: #0000FF;   /* BLÅ istället för baseline #F0B01C */
            padding: 20px;
          }
          h1 { color: #FFF; font-size: 24px; margin: 0 0 8px 0; }
          p { color: #DDD; font-size: 14px; }
        </style>
      </head><body>
        <div class="card">
          <h1>Regression fångad</h1>
          <p>Blå istället för saffron-orange.</p>
        </div>
      </body></html>
    `;
    await page.setContent(blueHtml, { waitUntil: 'load' });
    await page.setViewportSize({ width: 400, height: 280 });

    // Denna pixel-uppsättning ska avvika från self-test-baseline-darwin.png
    // (saffron-orange #F0B01C) med långt mer än 0.5%.
    // Förväntan: Playwright kastar ett misslyckande med diff-info. Vi
    // förväntar diff-meddelandet med `.toThrow()` istället för `.resolves` —
    // detta är hela poängen: pipeline:n REAGERA på regressioner.
    await expect(page).not.toHaveScreenshot(shot('self-test-baseline.png'));
  });
});

// ─── Live-screenshots: 4 kritiska vyer ───────────────────────────────────────

test.describe('@visual-live — EventPulse kritiska vyer', () => {
  test('HEM — Senaste', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page).toHaveScreenshot(shot('screen-home.png'));
  });

  test('UTFORSKA — Sök & filter', async ({ page }) => {
    await gotoApp(page, '/utforska');
    await expect(page).toHaveScreenshot(shot('screen-utforska.png'));
  });

  test('KARTA — Stockholm-karta', async ({ page }) => {
    await gotoApp(page, '/karta');
    await expect(page).toHaveScreenshot(shot('screen-karta.png'));
  });

  test('AGENT — Chatt', async ({ page }) => {
    await gotoApp(page, '/agent');
    await expect(page).toHaveScreenshot(shot('screen-agent.png'));
  });
});

// ─── Hjälpare för lokal baseline-uppdatering ────────────────────────────────

/*
 * För att uppdatera baseline efter en medveten designändring:
 *
 *   1. Starta Metro:    cd 06-UI && npx expo start --host lan --port 8081
 *   2. Uppdatera snap:  npx playwright test e2e/visual-regression/ \
 *                          --update-snapshots --grep '@visual-live'
 *   3. Granska diff:    npx playwright test e2e/visual-regression/ \
 *                          --grep '@visual-live'  (utan --update, ska gå grönt)
 *   4. Committa:        git add 06-UI/e2e/visual-regression/*.png \
 *                          && git commit -m "chore(visual): update baselines"
 *
 * CI-pipeline bör köra steg 3 OCH block:a PR om den failar.
 */
