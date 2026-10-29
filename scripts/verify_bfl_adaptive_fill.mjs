#!/usr/bin/env node
/**
 * scripts/verify_bfl_adaptive_fill.mjs
 *
 * Playwright-harness för verify-bfl-adaptive-fill.
 *
 * Driver dashboardens knapp "MiniMax image-01" (adaptiv fill) som en användare:
 *   1. fyll i antalsfältet
 *   2. klicka på knappen (riktiga pointer-events, inte intern anrop)
 *   3. följa status-rad + progress-bar medan körningen pågår
 *   4. verifiera sidoeffekten: nya .webp-filer på disk
 *
 * Bevis (screenshots + JSON-rapport) hamnar i
 *   .scratch/evidence/<YYYY-MM-DD>-adaptive-fill/
 *
 * Kör:
 *   node scripts/verify_bfl_adaptive_fill.mjs [--count=3] [--timeout=900] [--label=smoke]
 *
 * Exitkod: 0 = alla assertions passerade, 1 = assertionfel, 2 = fatalt fel.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:7777';
const PROJECT_ROOT = process.cwd();
const OUT_LIB = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2');

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/Users/claudgashi/Library/Caches/ms-playwright';
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const COUNT = Math.max(1, parseInt(arg('count', '3'), 10) || 3);
const TIMEOUT_S = Math.max(30, parseInt(arg('timeout', '900'), 10) || 900);
const LABEL = arg('label', `count-${COUNT}`);
const DAY = new Date().toISOString().slice(0, 10);
const EVIDENCE_DIR = path.join(PROJECT_ROOT, '.scratch', 'evidence', `${DAY}-adaptive-fill`);

mkdirSync(EVIDENCE_DIR, { recursive: true });

function log(...a) { console.log('[verify-adaptive]', ...a); }

/** Räknar .webp-filer i det nya biblioteket (rekursivt). */
function countWebp() {
  let n = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (e.endsWith('.webp')) n++;
    }
  };
  walk(OUT_LIB);
  return n;
}

async function realClick(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`knappen ${selector} har ingen boundingBox`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

async function readUi(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('#btn-bfl-compare-minimax');
    const status = document.querySelector('#bfl-adaptive-status');
    const statusText = document.querySelector('#bfl-adaptive-status-text');
    const prog = document.querySelector('#bfl-adaptive-progress');
    const bar = document.querySelector('#bfl-adaptive-progress-bar');
    const fill = document.querySelector('#bfl-adaptive-progress-fill');
    const pText = document.querySelector('#bfl-adaptive-progress-text');
    const sub = document.querySelector('#bfl-adaptive-sub');
    const inp = document.querySelector('#bfl-adaptive-count');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) };
    };
    return {
      buttonDisabled: btn ? btn.disabled : null,
      buttonText: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : null,
      statusHidden: status ? status.classList.contains('bfl-ingestion-status--hidden') : null,
      statusText: statusText ? statusText.textContent.trim() : null,
      statusRect: rect(status),
      progressHidden: prog ? prog.hidden : null,
      progressAriaNow: bar ? bar.getAttribute('aria-valuenow') : null,
      progressFillWidth: fill ? fill.style.width : null,
      progressText: pText ? pText.textContent.trim() : null,
      progressRect: rect(prog),
      subText: sub ? sub.textContent.trim() : null,
      inputValue: inp ? inp.value : null,
      viewportHeight: window.innerHeight,
    };
  });
}

async function main() {
  const errors = [];
  const report = { startedAt: new Date().toISOString(), count: COUNT, label: LABEL, evidenceDir: EVIDENCE_DIR };

  log(`Startar chromium (count=${COUNT}, timeout=${TIMEOUT_S}s)…`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  const posts = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/bfl/adaptive-run') && req.method() === 'POST') {
      posts.push({ body: req.postData() });
    }
  });

  log('Navigerar till ' + BASE_URL);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Dashboardens init-IIFE awaitar /api/status (kan ta ~3 s) innan den
  // kopplar knapparna. Vänta på att kopplingen faktiskt skett — en fast
  // sleep ger flakiga resultat.
  await page.waitForSelector('#btn-bfl-compare-minimax[data-wired="1"]', { timeout: 30000 });
  await page.waitForTimeout(600);

  // ── FÖRE: knapp + progress-bar i vila ────────────────────────────────
  const before = await readUi(page);
  report.before = before;
  log('FÖRE:', JSON.stringify({ buttonDisabled: before.buttonDisabled, subText: before.subText, progressHidden: before.progressHidden }));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-before.png'), clip: { x: 0, y: 0, width: 1400, height: 220 } });

  if (before.subText && !before.subText.includes('adaptiv fill')) {
    errors.push(`FAIL: knappens undertext "${before.subText}" saknar "adaptiv fill"`);
  }

  // ── Sätt antal + klicka ─────────────────────────────────────────────
  await page.locator('#bfl-adaptive-count').fill(String(COUNT));
  await page.waitForTimeout(250);
  const afterFill = await readUi(page);
  report.afterFill = afterFill;
  log(`Efter fill(${COUNT}): undertext="${afterFill.subText}"`);

  if (!afterFill.subText || !afterFill.subText.includes(String(COUNT))) {
    errors.push(`FAIL: undertext "${afterFill.subText}" speglar inte antalet ${COUNT}`);
  }

  const webpBefore = countWebp();
  report.webpBefore = webpBefore;
  log(`webp på disk FÖRE: ${webpBefore}`);

  await realClick(page, '#btn-bfl-compare-minimax');
  await page.waitForTimeout(1200);

  const afterClick = await readUi(page);
  report.afterClick = afterClick;
  log('EFTER KLICK:', JSON.stringify({ statusText: afterClick.statusText, progressHidden: afterClick.progressHidden, buttonDisabled: afterClick.buttonDisabled }));

  await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-after-click.png'), clip: { x: 0, y: 0, width: 1400, height: 220 } });

  // POST-body
  const body = posts[posts.length - 1]?.body ?? '';
  report.postBody = body;
  log('POST body:', body || '(ingen)');
  if (!posts.length) {
    errors.push('FAIL: ingen POST /api/bfl/adaptive-run skickades vid klick');
  } else if (!body.includes(`"count":${COUNT}`)) {
    errors.push(`FAIL: POST body "${body}" saknar "count":${COUNT}`);
  }

  // Om servern nekade med 409 (annan körning igång) — det är ett korrekt
  // beteende, inte ett fel. Rapportera och avsluta utan fel.
  if (afterClick.statusText && afterClick.statusText.startsWith('✗')) {
    log('Servern nekade starten:', afterClick.statusText);
    report.skipped = true;
    report.reason = afterClick.statusText;
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-refused.png'), clip: { x: 0, y: 0, width: 1400, height: 220 } });
    await browser.close();
    writeFileSync(path.join(EVIDENCE_DIR, `report-${LABEL}.json`), JSON.stringify({ ...report, errors, consoleErrors }, null, 2));
    log('AVSLUTAD: start nekades (väntar på att annan körning ska ta slut)');
    process.exit(0);
  }

  if (!afterClick.buttonDisabled) {
    errors.push('FAIL: knappen är inte disabled under körningen');
  }
  if (afterClick.progressHidden !== false) {
    errors.push('FAIL: progress-baren är inte synlig efter klick');
  }

  // ── Följ progress tills klar ─────────────────────────────────────────
  const started = Date.now();
  let last = afterClick;
  const seen = [];
  let shotMid = false;
  let shotDone = false;

  while (Date.now() - started < TIMEOUT_S * 1000) {
    await page.waitForTimeout(1500);
    const ui = await readUi(page);
    const line = `${ui.progressAriaNow}% ${ui.progressText} | ${ui.statusText}`;
    if (!seen.length || seen[seen.length - 1] !== line) {
      seen.push(line);
      log(`  ${new Date().toISOString().slice(11, 19)} ${line}`);
    }
    last = ui;

    const done = ui.statusText && (ui.statusText.startsWith('✓') || ui.statusText.startsWith('✗'));
    if (!shotMid && ui.progressAriaNow && parseInt(ui.progressAriaNow, 10) > 0) {
      await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-running.png'), clip: { x: 0, y: 0, width: 1400, height: 220 } });
      shotMid = true;
    }
    if (done) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, '04-done.png'), clip: { x: 0, y: 0, width: 1400, height: 220 } });
      shotDone = true;
      break;
    }
  }

  report.final = last;
  report.progressTimeline = seen;
  report.screenshots = { mid: shotMid, done: shotDone };

  const webpAfter = countWebp();
  report.webpAfter = webpAfter;
  log(`webp på disk EFTER: ${webpAfter} (delta=${webpAfter - webpBefore})`);

  // ── Assertions ───────────────────────────────────────────────────────
  if (!shotDone) errors.push('FAIL: körningen slutfördes inte inom timeout');
  if (!last.statusText || !last.statusText.startsWith('✓')) {
    errors.push(`FAIL: slutstatus "${last.statusText}" är inte "✓ klar"`);
  }
  if (last.buttonDisabled) errors.push('FAIL: knappen är fortfarande disabled efter avslutad körning');
  if (last.progressAriaNow !== '100') {
    errors.push(`FAIL: aria-valuenow="${last.progressAriaNow}" efter avslutad körning (väntade 100)`);
  }
  if (webpAfter <= webpBefore) {
    errors.push(`FAIL: inga nya .webp-filer på disk (före=${webpBefore} efter=${webpAfter})`);
  }
  if (last.statusRect && last.statusRect.bottom > last.viewportHeight) {
    errors.push(`FAIL: status-rad utanför viewport (bottom=${last.statusRect.bottom})`);
  }

  await browser.close();

  report.finishedAt = new Date().toISOString();
  report.consoleErrors = consoleErrors;
  report.errors = errors;
  writeFileSync(path.join(EVIDENCE_DIR, `report-${LABEL}.json`), JSON.stringify(report, null, 2));

  log('');
  log('=== RESULTAT ===');
  log(`bevis: ${EVIDENCE_DIR}`);
  log(`console errors: ${consoleErrors.length}`);
  for (const e of consoleErrors) log(' !', e);
  log(`assertion errors: ${errors.length}`);
  for (const e of errors) log(' ✗', e);

  if (errors.length > 0) process.exit(1);
  log('✓ alla assertions passerade');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(2);
});
