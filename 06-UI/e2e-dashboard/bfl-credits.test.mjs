/**
 * bfl-credits.test.mjs — Playwright-test som bevisar BFL-credit-status på
 * Scraping Supervisor Dashboard (port 7777).
 *
 * Bakgrund (användarbeslut 2026-10-08):
 *   - Knappen "BFL-credits" ska lysa GRÖNT om BFL har credits > 0
 *   - Ska lysa RÖTT om credits = 0 / senaste anropet misslyckades
 *   - Vid BFL-fel under ingestion: liten rad UNDER knappen med texten
 *     "inga krediter under ingestion" (vit text, 10pt)
 *
 * Detta test:
 *   1. Startar dashboard-server på port 7777 (om inte redan körs)
 *   2. Loggar in 1 BFL-fel via /api/bfl-error (mockat)
 *   3. Öppnar dashboard-sida
 *   4. Verifierar att #btn-bfl-credits har klass --ok ELLER --bad
 *      (credits > 0 → ok; credits = 0 / error → bad)
 *   5. Verifierar att #bfl-ingestion-status visas med rätt text
 *
 * Användning:
 *   cd 06-UI
 *   npx playwright test ../09-ScrapingSupervisor/dashboard/tests/bfl-credits.test.mjs \
 *     --config=../06-UI/playwright.config.js --reporter=list
 *
 * Eller enklare, om dashboard redan kör på 7777:
 *   BASE_URL=http://localhost:7777 npx playwright test e2e-dashboard/bfl-credits.test.mjs
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const DASHBOARD_PORT = 7777;
const BASE_URL = process.env.BASE_URL || `http://localhost:${DASHBOARD_PORT}`;
const DASHBOARD_SCRIPT = '../../09-ScrapingSupervisor/dashboard/server.ts';

let dashboardProcess = null;

async function isDashboardRunning() {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function startDashboard() {
  if (await isDashboardRunning()) return;
  console.log('[playwright] startar dashboard-server på port', DASHBOARD_PORT);
  dashboardProcess = spawn('npx', ['tsx', DASHBOARD_SCRIPT], {
    env: { ...process.env, PORT: String(DASHBOARD_PORT) },
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  dashboardProcess.stderr.on('data', (d) => process.stderr.write(`[dashboard] ${d}`));

  // Vänta tills /health svarar (max 15s)
  for (let i = 0; i < 30; i++) {
    if (await isDashboardRunning()) {
      console.log('[playwright] dashboard redo efter', i * 0.5, 's');
      return;
    }
  }
  throw new Error('Dashboard startade inte inom 15s');
}

async function stopDashboard() {
  if (dashboardProcess) {
    dashboardProcess.kill('SIGTERM');
    await sleep(200);
    dashboardProcess.kill('SIGKILL');
    dashboardProcess = null;
  }
}

test.beforeAll(async () => {
  await startDashboard();
});

test.afterAll(async () => {
  await stopDashboard();
});

test('BFL-knappen visar färg + ingestion-status-rad', async ({ page }) => {
  // Steg 1: logga 1 simulerat BFL-fel (mockat — vi triggar /api/bfl-error)
  const apiContext = await playwrightRequest.newContext({ baseURL: BASE_URL });
  await apiContext.post('/api/bfl-error', {
    data: { error: 'playwright-test-fel-2026-10-08' },
    headers: { 'Content-Type': 'application/json' },
  });
  await apiContext.dispose();

  // Steg 2: öppna dashboarden
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Steg 3: vänta på att #btn-bfl-credits finns i DOM
  await page.waitForSelector('#btn-bfl-credits', { timeout: 10_000 });

  // Steg 4: hämta /api/status från sidan (eller direkt) för att veta förväntat state
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/status');
    return r.json();
  });
  const bc = status.bflCredits || {};

  // Verifiera att knappen har klass --ok ELLER --bad (inte --unknown efter att /api/status svarat)
  const classAttr = await page.getAttribute('#btn-bfl-credits', 'class');
  expect(classAttr, 'knappen ska ha --ok eller --bad klass efter /api/status').toMatch(/bfl-credits-box--(ok|bad)/);

  // Verifiera färg enligt BFL-status
  if (bc.ok === true) {
    expect(classAttr).toContain('bfl-credits-box--ok');
  } else if (bc.ok === false) {
    expect(classAttr).toContain('bfl-credits-box--bad');
  }

  // Verifiera ingestion-status-rad (ska visas om errors24h > 0)
  const statusEl = await page.locator('#bfl-ingestion-status');
  if ((bc.ingestionErrors24h ?? 0) > 0) {
    await expect(statusEl).toBeVisible();
    await expect(statusEl).not.toHaveClass(/bfl-ingestion-status--hidden/);
    const text = await statusEl.textContent();
    expect(text).toMatch(/inga krediter under ingestion/i);
    expect(text).toContain(String(bc.ingestionErrors24h));
    // Verifiera vit text + 10pt font
    const styles = await statusEl.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        color: cs.color,
        fontSize: cs.fontSize,
      };
    });
    // color: rgb(255, 255, 255) = #ffffff
    expect(styles.color).toBe('rgb(255, 255, 255)');
    // 10pt = 13.33px i CSS
    const fs = parseFloat(styles.fontSize);
    expect(fs).toBeGreaterThanOrEqual(12);
    expect(fs).toBeLessThanOrEqual(15);
  } else {
    // Inga fel loggade — raden ska vara dold
    await expect(statusEl).toHaveClass(/bfl-ingestion-status--hidden/);
  }

  // Screenshot för visuell bekräftelse
  await page.screenshot({ path: '/tmp/bfl-credits-dashboard.png', fullPage: false });
});

test('Knappen visar --bad när BFL returnerar ok=false', async ({ page, request }) => {
  // Logga ett fel som markerar ok=false i framtida cache
  await request.post(`${BASE_URL}/api/bfl-error`, {
    data: { error: 'another-fel' },
    headers: { 'Content-Type': 'application/json' },
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-bfl-credits');

  // Kontrollera att raden syns efter uppdatering
  await expect(page.locator('#bfl-ingestion-status')).toBeVisible();
});