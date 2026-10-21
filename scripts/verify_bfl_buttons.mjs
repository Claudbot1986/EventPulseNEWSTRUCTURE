#!/usr/bin/env node
/**
 * scripts/verify_bfl_buttons.mjs
 *
 * Playwright-harness för verify-bfl-zoom-pipeline.
 * Kör mot levande dashboard på :7777 och fångar:
 *  - klick → fetch-kedja (network assertion)
 *  - status-radens faktiska positionering (visual regression)
 *  - disabled-tillstånd (UI assertion)
 *
 * Referensdriver per SKILL.md §"Playwright-harness".
 * Kör: node scripts/verify_bfl_buttons.mjs [feature]
 *   feature = auto-fill | zoom-run | count-input | model-compare (default: alla)
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE_URL = 'http://localhost:7777';
const EVIDENCE_DIR = 'scripts/evidence';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/Users/claudgashi/Library/Caches/ms-playwright';
}

mkdirSync(EVIDENCE_DIR, { recursive: true });

function log(...args) { console.log('[verify]', ...args); }

async function clickAndInspect(page, buttonSelector, statusSelector, expectedText) {
  const status = page.locator(statusSelector);
  const text = page.locator(`${statusSelector}-text`);

  // FÖRE
  const before = await page.evaluate(({ sel }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      hidden: el.classList.contains('bfl-ingestion-status--hidden'),
      text: el.textContent.trim(),
      rect: { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom },
      position: getComputedStyle(el).position,
    };
  }, { sel: statusSelector });

  // KLICK via RIKTIGA pointer events (page.locator().click() är opålitligt här)
  const btnBox = await page.locator(buttonSelector).boundingBox();
  if (!btnBox) {
    return { before, after: null, errors: [`FAIL: knapp ${buttonSelector} har ingen boundingBox`] };
  }
  await page.mouse.move(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(800);

  // EFTER
  const after = await page.evaluate(({ sel }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      hidden: el.classList.contains('bfl-ingestion-status--hidden'),
      text: el.textContent.trim(),
      rect: { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom },
      inViewport: r.bottom <= window.innerHeight && r.top >= 0,
      parentPosition: getComputedStyle(el.parentElement).position,
    };
  }, { sel: statusSelector });

  log(`  status INNAN: hidden=${before.hidden}, rect=${JSON.stringify(before.rect)}, text="${before.text}"`);
  log(`  status EFTER: hidden=${after.hidden}, rect=${JSON.stringify(after.rect)}, inViewport=${after.inViewport}, text="${after.text}"`);
  log(`  status.parent position: ${after.parentPosition}`);

  // Assertions
  const errors = [];
  if (after.hidden) errors.push('FAIL: status är fortfarande hidden efter klick');
  if (!after.text.includes(expectedText)) errors.push(`FAIL: text "${after.text}" saknar "${expectedText}"`);
  if (!after.inViewport) errors.push(`FAIL: status-rad utanför viewport (bottom=${after.rect.bottom}, viewport.height=${(await page.viewportSize()).height})`);
  return { before, after, errors };
}

async function verifyAutoFill(page) {
  log('--- Feature #2: auto-fill ---');
  const apiCalls = [];
  const onRequest = (req) => {
    if (req.url().includes('/api/bfl/zoom-run') && req.method() === 'POST') {
      apiCalls.push({ body: req.postData() });
    }
  };
  page.on('request', onRequest);

  const r = await clickAndInspect(page, '#btn-bfl-zoom-auto', '#bfl-zoom-status', 'auto-fill');
  await page.screenshot({ path: `${EVIDENCE_DIR}/auto-fill-after.png`, clip: { x: 0, y: 0, width: 1400, height: 200 } });

  page.off('request', onRequest);
  log(`  POST body: ${JSON.stringify(apiCalls[0])}`);
  const errs = [...r.errors];
  if (!apiCalls[0]?.body?.includes('"auto":true')) errs.push('FAIL: POST body saknar auto:true');
  return errs;
}

async function verifyZoomRun(page) {
  log('--- Feature #1: zoom-variation ---');
  await page.locator('#bfl-zoom-count').fill('5');
  const r = await clickAndInspect(page, '#btn-bfl-zoom-run', '#bfl-zoom-status', 'startar');
  await page.screenshot({ path: `${EVIDENCE_DIR}/zoom-run-after.png`, clip: { x: 0, y: 0, width: 1400, height: 200 } });
  return r.errors;
}

async function verifyCountInput(page) {
  log('--- Feature #3: count-input cap ---');
  const apiCalls = [];
  const onReq = (req) => {
    if (req.url().includes('/api/bfl/zoom-run') && req.method() === 'POST') {
      apiCalls.push({ body: req.postData() });
    }
  };
  page.on('request', onReq);
  await page.locator('#bfl-zoom-count').fill('9999');
  const btnBox = await page.locator('#btn-bfl-zoom-run').boundingBox();
  await page.mouse.move(btnBox.x + btnBox.width/2, btnBox.y + btnBox.height/2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(500);
  page.off('request', onReq);
  const body = apiCalls[apiCalls.length - 1]?.body;
  log(`  POST body vid input=9999: ${body}`);
  const errors = [];
  if (!body?.includes('"count":500')) errors.push(`FAIL: input=9999 skickade ${body} istället för count=500`);
  return errors;
}

async function verifyModelCompare(page, model) {
  log(`--- Feature #${model === 'bfl-flux-2-pro' ? '4' : '5'}: model-compare ${model} ---`);
  const sel = `#btn-bfl-compare-${model === 'bfl-flux-2-pro' ? 'flux2' : 'minimax'}`;
  const r = await clickAndInspect(page, sel, '#bfl-compare-status', model);
  await page.screenshot({ path: `${EVIDENCE_DIR}/model-compare-${model}-after.png`, clip: { x: 0, y: 0, width: 1400, height: 200 } });
  return r.errors;
}

async function main() {
  log('Startar chromium…');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  log('Navigerar till ' + BASE_URL);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(1500);

  // Helbild FÖRE
  await page.screenshot({ path: `${EVIDENCE_DIR}/dashboard-before.png`, fullPage: false });

  const allErrors = [];

  // Reload mellan features för att undvika disabled-state pollution från föregående körning
  async function reload() {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(2500);
  }

  const feature = process.argv[2];
  if (!feature || feature === 'auto-fill') {
    await reload();
    allErrors.push(...(await verifyAutoFill(page)));
  }
  if (!feature || feature === 'zoom-run') {
    await reload();
    allErrors.push(...(await verifyZoomRun(page)));
  }
  if (!feature || feature === 'count-input') {
    await reload();
    allErrors.push(...(await verifyCountInput(page)));
  }
  if (!feature || feature === 'model-compare') {
    await reload();
    allErrors.push(...(await verifyModelCompare(page, 'bfl-flux-2-pro')));
    await reload();
    allErrors.push(...(await verifyModelCompare(page, 'minimax-image-01')));
  }

  await browser.close();

  log('');
  log('=== RESULTAT ===');
  log(`console errors: ${consoleErrors.length}`);
  for (const e of consoleErrors) log(' !', e);
  log(`assertion errors: ${allErrors.length}`);
  for (const e of allErrors) log(' ✗', e);

  if (allErrors.length > 0) {
    process.exit(1);
  } else {
    log('✓ alla assertions passerade');
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(2);
});