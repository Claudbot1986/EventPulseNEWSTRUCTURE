#!/usr/bin/env node
/**
 * scripts/verify_bfl_live.mjs
 *
 * Live-harness för BFL-knapparna som tar SKÄRMDUMPAR VARJE SEKUND under
 * hela körningen och loggar status-raden. Fångar det användaren beskriver:
 *   - röd text som fastnar på "0/N" trots att bilder genereras
 *   - status-rad som inte uppdateras live
 *   - pipeline som ser död ut men faktiskt jobbar
 *
 * Kör: node scripts/verify_bfl_live.mjs <knapp> <count>
 *   knapp = auto-fill | zoom-run   (default: auto-fill)
 *   count = input-rutans värde     (default: 10)
 *
 * Output:
 *   evidence/live/<knapp>-<count>-<runId>/
 *     shot-<NNNN>.png    (varje sekund)
 *     status.jsonl       (en rad per sample)
 *     summary.json       (runId + resultat)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = 'http://localhost:7777';
const KNAPP = process.argv[2] ?? 'auto-fill';
const COUNT = parseInt(process.argv[3] ?? '10', 10);

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/Users/claudgashi/Library/Caches/ms-playwright';
}

const runLabel = `${KNAPP}-c${COUNT}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const OUT_DIR = `evidence/live/${runLabel}`;
mkdirSync(OUT_DIR, { recursive: true });

console.log(`[live] startar: knapp=${KNAPP} count=${COUNT}  ut=${OUT_DIR}`);

function writeStatusLine(line) {
  appendFileSync(join(OUT_DIR, 'status.jsonl'), line + '\n');
}
function writeSummary(obj) {
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(obj, null, 2));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  // Console errors
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(1500);
  console.log(`[live] dashboard loaded (${consoleErrors.length} console errors so far)`);

  // Capture network POST for context
  let postBody = null;
  page.on('request', (req) => {
    if (req.url().includes('/api/bfl/zoom-run') && req.method() === 'POST') {
      postBody = req.postData();
    }
  });

  // Fyll input-rutan
  await page.locator('#bfl-count').fill(String(COUNT));
  await page.waitForTimeout(150);

  // Mät-baserat klick (använd page.click() med fallback till direkt JS-anrop)
  const btnSel = KNAPP === 'auto-fill' ? '#btn-bfl-zoom-auto' : '#btn-bfl-zoom-run';
  const fnName = KNAPP === 'auto-fill' ? 'startAutoZoomRun' : 'startZoomRun';
  const btnBox = await page.locator(btnSel).boundingBox();
  if (!btnBox) {
    console.error(`FAIL: knapp ${btnSel} har ingen boundingBox`);
    process.exit(2);
  }

  // Vänta in "klar"-attribut på input innan klick
  const beforeClick = await page.evaluate(() => {
    const inp = document.querySelector('#bfl-count');
    const status = document.querySelector('#bfl-zoom-status');
    return {
      inputValue: inp?.value,
      inputDisabled: inp?.disabled,
      btnDisabled: document.querySelector('#btn-bfl-zoom-auto')?.disabled,
      btn2Disabled: document.querySelector('#btn-bfl-zoom-run')?.disabled,
      statusText: status?.textContent?.trim() ?? null,
      statusHidden: status?.classList?.contains('bfl-ingestion-status--hidden') ?? true,
      fnExists: typeof window.startAutoZoomRun === 'function' && typeof window.startZoomRun === 'function',
    };
  });
  writeStatusLine(JSON.stringify({ t: 0, phase: 'before-click', ...beforeClick }));
  console.log(`[live] BEFORE CLICK: ${JSON.stringify(beforeClick)}`);

  // Direkt JS-anrop är mer tillförlitligt än page.click() i headless-läge.
  // Försök page.click() först; om status-raden inte döljs inom 800ms, fall tillbaka på direkt anrop.
  await page.locator(btnSel).click({ force: true });
  await page.waitForTimeout(800);

  const postClick = await page.evaluate(() => {
    const s = document.querySelector('#bfl-zoom-status');
    return { hidden: s?.classList?.contains('bfl-ingestion-status--hidden') ?? true };
  });

  if (postClick.hidden) {
    console.log(`[live] page.click() triggade inte — anropar ${fnName}() direkt`);
    const result = await page.evaluate(async (fn) => {
      if (typeof window[fn] !== 'function') return { error: fn + ' not global' };
      try { await window[fn](); return { ok: true }; }
      catch (e) { return { error: String(e) }; }
    }, fnName);
    console.log(`[live] direkt anrop: ${JSON.stringify(result)}`);
  } else {
    console.log(`[live] page.click() triggade ${fnName} korrekt`);
  }

  // Polling + screenshots varje sekund
  const t0 = Date.now();
  let frames = 0;
  let lastText = null;
  let sameTextSamples = 0;
  let runId = null;
  let finalStatus = null;
  const statusHistory = [];

  while (true) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const sample = await page.evaluate(() => {
      const status = document.querySelector('#bfl-zoom-status');
      const inp = document.querySelector('#bfl-count');
      const btnAuto = document.querySelector('#btn-bfl-zoom-auto');
      const btnRun = document.querySelector('#btn-bfl-zoom-run');
      const statusRect = status?.getBoundingClientRect();
      const btnRect = btnAuto?.getBoundingClientRect();
      return {
        statusText: status?.textContent?.trim() ?? null,
        statusHidden: status?.classList?.contains('bfl-ingestion-status--hidden') ?? true,
        statusColor: status ? getComputedStyle(status).color : null,
        statusInViewport: statusRect ? (statusRect.bottom <= 900 && statusRect.top >= 0) : null,
        statusTop: statusRect?.top ?? null,
        statusBottom: statusRect?.bottom ?? null,
        inputDisabled: inp?.disabled ?? null,
        btnAutoDisabled: btnAuto?.disabled ?? null,
        btnRunDisabled: btnRun?.disabled ?? null,
      };
    });

    const shotName = `shot-${String(frames).padStart(4, '0')}-t${String(elapsed).padStart(3, '0')}s.png`;
    await page.screenshot({ path: join(OUT_DIR, shotName), fullPage: false });

    const line = { t: elapsed, phase: 'sample', frames, ...sample };
    writeStatusLine(JSON.stringify(line));
    statusHistory.push(line);

    // Detect "stuck" på samma text
    if (sample.statusText === lastText) {
      sameTextSamples++;
    } else {
      sameTextSamples = 0;
      lastText = sample.statusText;
    }
    if (sameTextSamples > 0 && sameTextSamples % 10 === 0) {
      console.log(`[live] t=${elapsed}s status oförändrad ${sameTextSamples} samples: "${sample.statusText?.slice(0, 60)}"`);
    }

    // Fråga backend om run-status om vi inte redan har en runId
    if (!runId && sample.statusText?.includes('runId')) {
      const m = sample.statusText.match(/runId[=: ]+([\w-]+)/i);
      if (m) runId = m[1];
    }

    // Check om batch är klar — antingen via status-rad-orden eller backend
    const lower = (sample.statusText ?? '').toLowerCase();
    if (
      lower.includes('klar') ||
      lower.includes('success') ||
      lower.includes('failed') ||
      lower.includes('avbruten') ||
      lower.includes('fel') ||
      lower.includes(' klar ')
    ) {
      finalStatus = sample.statusText;
      console.log(`[live] DETECTED TERMINAL STATE vid t=${elapsed}s: "${finalStatus}"`);
      break;
    }

    if (elapsed > 600) { // 10 min hård gräns
      console.log(`[live] TIMEOUT efter 600s`);
      finalStatus = 'TIMEOUT';
      break;
    }

    frames++;
    await page.waitForTimeout(1000);
  }

  // Slutskärmdump + summary
  await page.screenshot({ path: join(OUT_DIR, 'shot-final.png'), fullPage: false });
  const summary = {
    runLabel,
    postBody,
    finalStatus,
    runId,
    statusHistoryLen: statusHistory.length,
    consoleErrors,
    finalHidden: statusHistory.at(-1)?.statusHidden,
    finalInViewport: statusHistory.at(-1)?.statusInViewport,
    finalBtnAutoDisabled: statusHistory.at(-1)?.btnAutoDisabled,
    finalBtnRunDisabled: statusHistory.at(-1)?.btnRunDisabled,
  };
  writeSummary(summary);
  console.log('');
  console.log('=== LIVE PASS SAMMANFATTNING ===');
  console.log(`knapp=${KNAPP} count=${COUNT}`);
  console.log(`samples=${statusHistory.length}  final="${finalStatus}"`);
  console.log(`consoleErrors=${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(` ! ${e}`);
  console.log(`evidence: ${OUT_DIR}/`);

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(2);
});
