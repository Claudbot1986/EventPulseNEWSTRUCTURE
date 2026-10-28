#!/usr/bin/env node
/**
 * ui-probe.mjs — live diagnostic driver för verify-eventpulse-ui.
 *
 * Ägs av verification-skillen .cursor/skills/verify-eventpulse-ui/.
 *
 * Probe kör appen i Expo-webb-bundlen, samlar in ALLT som kan gå fel
 * (konsolfel, page errors, misslyckade nätverksanrop, 4xx/5xx-svar) och
 * skriver en DOM-inventering + skärmdumpar. Den gör inga assertioner —
 * assertioner ligger i 06-UI/e2e/*.test.mjs. Proben är för att LÄRA sig
 * DOM:en innan man skriver specar, och för att fånga fel som annars bara
 * syns i konsolen.
 *
 * Användning:
 *   node scripts/ui-probe.mjs --plan scripts/plans/tour.json [--out runtime/...]
 *
 * Plan-format (JSON):
 * {
 *   "baseUrl": "http://localhost:9090",
 *   "outDir": "runtime/verification-reports/ui-probe-<ts>",
 *   "steps": [
 *     { "action": "goto" },
 *     { "action": "wait", "ms": 6000 },
 *     { "action": "inventory", "label": "hem" },
 *     { "action": "shot", "label": "hem" },
 *     { "action": "tapTestId", "selector": "[data-testid=\"home-search-button\"]", "label": "sök" },
 *     { "action": "tapText", "text": "Utforska", "label": "utforska" },
 *     { "action": "tapNth", "selector": "[role=\"button\"]", "index": 0, "label": "kort-0" }
 *   ]
 * }
 */

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = { plan: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--plan') args.plan = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

/** Tryck som React Native Web vill ha: pointerdown + pointerup + click. */
async function pointerTap(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: 'not-found' };
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
    return { ok: true };
  }, selector);
}

/** Tryck på ett element som hittas via textinnehåll. */
async function textTap(page, text, exact = false) {
  return page.evaluate(
    ({ needle, exactMatch }) => {
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      const candidates = Array.from(
        document.querySelectorAll('button, [role="button"], [role="tab"], a, [data-testid]'),
      ).filter(isVisible);
      const matches = (el) => {
        const t = (el.textContent || '').trim();
        const label = el.getAttribute('aria-label') || '';
        return exactMatch ? t === needle || label === needle : t.includes(needle) || label.includes(needle);
      };
      // Välj det DJUPAST matchande elementet: en container som rymmer hela
      // sidan matchar också texten, men det är inte knappen användaren ser.
      let hits = candidates.filter(matches);
      if (!hits.length) {
        // Fallback: vissa trykbara ytor (t.ex. "< Tillbaka") är inte <button>.
        const all = Array.from(document.querySelectorAll('body *')).filter(isVisible);
        hits = all.filter((el) => {
          const t = (el.textContent || '').trim();
          return exactMatch ? t === needle : t.includes(needle);
        });
      }
      const hit = hits.find((el) => !hits.some((other) => other !== el && el.contains(other))) || hits[0];
      if (!hit) return { ok: false, reason: 'not-found' };
      const opts = {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 1,
      };
      hit.dispatchEvent(new PointerEvent('pointerdown', opts));
      hit.dispatchEvent(new PointerEvent('pointerup', opts));
      hit.dispatchEvent(new MouseEvent('click', opts));
      return { ok: true, text: (hit.textContent || '').trim().slice(0, 80) };
    },
    { needle: text, exactMatch: exact },
  );
}

async function nthTap(page, selector, index) {
  return page.evaluate(
    ({ sel, idx }) => {
      const list = Array.from(document.querySelectorAll(sel));
      const el = list[idx];
      if (!el) return { ok: false, reason: 'index-out-of-range', count: list.length };
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
      return {
        ok: true,
        count: list.length,
        text: (el.textContent || '').trim().slice(0, 120),
        aria: el.getAttribute('aria-label') || null,
      };
    },
    { sel: selector, idx: index },
  );
}

/** Fullständig inventering av det som en användare kan interagera med. */
async function inventory(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const label = (el) =>
      (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        label: label(el),
        testid: el.getAttribute('data-testid'),
        nestedButton: !!el.querySelector('button'),
        parentButton: !!el.parentElement?.closest('button'),
      }));

    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
      .filter(visible)
      .map((el) => ({
        label: label(el),
        selected: el.getAttribute('aria-selected'),
        testid: el.getAttribute('data-testid'),
      }));

    const testids = Array.from(
      new Set(
        Array.from(document.querySelectorAll('[data-testid]'))
          .filter(visible)
          .map((el) => el.getAttribute('data-testid')),
      ),
    ).sort();

    const bodyText = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

    return {
      url: location.href,
      title: document.title,
      tabs,
      testids,
      buttonCount: buttons.length,
      buttons: buttons.slice(0, 120),
      nestedButtonCount: buttons.filter((b) => b.nestedButton || b.parentButton).length,
      bodyText: bodyText.slice(0, 4000),
      bodyTextLength: bodyText.length,
    };
  });
}

/** Strukturdump: elementträd med roller, testid och etikett (för selector-skrivning). */
async function structure(page, maxDepth = 14) {
  return page.evaluate((depth) => {
    const out = [];
    const label = (el) =>
      (el.getAttribute('aria-label') || el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 70);
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const walk = (el, d) => {
      if (d > depth) return;
      const interesting =
        el.getAttribute('role') ||
        el.getAttribute('data-testid') ||
        ['BUTTON', 'A', 'INPUT', 'H1', 'H2', 'H3', 'TEXTAREA'].includes(el.tagName);
      if (interesting && visible(el)) {
        out.push({
          d,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role'),
          testid: el.getAttribute('data-testid'),
          aria: el.getAttribute('aria-label'),
          selected: el.getAttribute('aria-selected'),
          text: label(el),
        });
      }
      for (const child of el.children) walk(child, d + 1);
    };
    walk(document.body, 0);
    return out;
  }, maxDepth);
}

/** Textkarta: alla synliga textbärande element med koordinater, sorterad y→x. */
async function textmap(page) {
  return page.evaluate(() => {
    const rows = [];
    const seen = new Set();
    const all = Array.from(document.querySelectorAll('body *'));
    for (const el of all) {
      if (el.children.length > 0) continue; // bara leaf-noder
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = window.getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const key = `${Math.round(r.x)}:${Math.round(r.y)}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        x: Math.round(r.x),
        y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        testid: el.getAttribute('data-testid'),
        aria: el.getAttribute('aria-label'),
        text: text.slice(0, 90),
      });
    }
    return rows.sort((a, b) => a.y - b.y || a.x - b.x);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan) {
    console.error('Usage: node scripts/ui-probe.mjs --plan <plan.json> [--out <dir>]');
    process.exit(2);
  }

  const plan = JSON.parse(await (await import('node:fs/promises')).readFile(args.plan, 'utf8'));
  const baseUrl = plan.baseUrl || 'http://localhost:9090';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.out || plan.outDir || path.resolve(process.cwd(), `runtime/verification-reports/ui-probe-${stamp}`);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'sv-SE',
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const consoleLogs = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];

  page.on('console', (msg) => {
    const entry = { text: msg.text(), location: msg.location() };
    if (msg.type() === 'error') consoleErrors.push(entry);
    else if (msg.type() === 'warning') consoleWarnings.push(entry);
    else consoleLogs.push(entry);
  });
  page.on('pageerror', (err) => pageErrors.push({ message: err.message, stack: err.stack }));
  page.on('requestfailed', (req) =>
    failedRequests.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText || 'unknown',
    }),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push({ url: res.url(), status: res.status() });
  });

  const steps = [];
  let inventoryCount = 0;

  for (const step of plan.steps || []) {
    const label = step.label || step.action;
    const entry = { step: step.action, label };

    try {
      switch (step.action) {
        case 'goto': {
          await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
          entry.ok = true;
          break;
        }
        case 'wait': {
          await page.waitForTimeout(step.ms ?? 1000);
          entry.ok = true;
          break;
        }
        case 'tapTestId': {
          const res = await pointerTap(page, step.selector);
          entry.ok = res.ok;
          entry.detail = res;
          break;
        }
        case 'tapText': {
          const res = await textTap(page, step.text, step.exact === true);
          entry.ok = res.ok;
          entry.detail = res;
          break;
        }
        case 'tapNth': {
          const res = await nthTap(page, step.selector, step.index ?? 0);
          entry.ok = res.ok;
          entry.detail = res;
          break;
        }
        case 'shot': {
          const file = path.join(outDir, `${step.label || `shot-${inventoryCount}`}.png`);
          await page.screenshot({ path: file, fullPage: step.fullPage === true });
          entry.ok = true;
          entry.file = file;
          break;
        }
        case 'eval': {
          // step.js är en arrow-funktion som sträng: "(...) => {...}".
          const result = await page.evaluate(`(${step.js})()`);
          entry.ok = true;
          entry.detail = result;
          break;
        }
        case 'scroll': {
          // React Native Web scrollar i en egen container, inte i window.
          const info = await page.evaluate((y) => {
            const candidates = Array.from(document.querySelectorAll('body *')).filter((el) => {
              const st = window.getComputedStyle(el);
              return (
                (st.overflowY === 'auto' || st.overflowY === 'scroll') &&
                el.scrollHeight > el.clientHeight + 40
              );
            });
            const target = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
            if (target) {
              target.scrollTop = y;
              if (target.scrollTop === 0) {
                // Vissa RN-web-vyer (t.ex. DetailsScreen) scrollar i fönstret,
                // inte i en inre container → scrolla även documentet.
                window.scrollTo(0, y);
              }
              return {
                ok: true,
                containerScrollTop: target.scrollTop,
                windowScrollY: window.scrollY,
                scrollHeight: target.scrollHeight,
              };
            }
            window.scrollTo(0, y);
            return { ok: true, windowScrollY: window.scrollY };
          }, step.y ?? 0);
          await page.waitForTimeout(step.settle ?? 900);
          entry.ok = true;
          entry.detail = info;
          break;
        }
        case 'textmap': {
          const map = await textmap(page);
          inventoryCount += 1;
          const file = path.join(outDir, `${step.label || `textmap-${inventoryCount}`}.json`);
          await writeFile(file, JSON.stringify(map, null, 2));
          entry.ok = true;
          entry.file = file;
          entry.summary = { nodes: map.length };
          break;
        }
        case 'structure': {
          const tree = await structure(page, step.maxDepth ?? 14);
          inventoryCount += 1;
          const file = path.join(outDir, `${step.label || `structure-${inventoryCount}`}.json`);
          await writeFile(file, JSON.stringify(tree, null, 2));
          entry.ok = true;
          entry.file = file;
          entry.summary = { nodes: tree.length };
          break;
        }
        case 'inventory': {
          const inv = await inventory(page);
          inventoryCount += 1;
          const file = path.join(outDir, `${step.label || `inventory-${inventoryCount}`}.json`);
          await writeFile(file, JSON.stringify(inv, null, 2));
          entry.ok = true;
          entry.file = file;
          entry.summary = {
            buttonCount: inv.buttonCount,
            nestedButtonCount: inv.nestedButtonCount,
            tabs: inv.tabs.map((t) => `${t.label}${t.selected === 'true' ? '*' : ''}`),
            bodyTextLength: inv.bodyTextLength,
          };
          break;
        }
        default:
          entry.ok = false;
          entry.error = `unknown action ${step.action}`;
      }
    } catch (err) {
      entry.ok = false;
      entry.error = err.message;
    }

    steps.push(entry);
    console.log(`${entry.ok === false ? '✗' : '✓'} ${entry.step} ${label}${entry.error ? ` — ${entry.error}` : ''}`);
  }

  const report = {
    baseUrl,
    outDir,
    ranAt: new Date().toISOString(),
    steps,
    summary: {
      consoleErrors: consoleErrors.length,
      consoleWarnings: consoleWarnings.length,
      pageErrors: pageErrors.length,
      failedRequests: failedRequests.length,
      badResponses: badResponses.length,
    },
    consoleErrors,
    consoleWarnings,
    pageErrors,
    failedRequests,
    badResponses,
  };

  const reportFile = path.join(outDir, 'report.json');
  await writeFile(reportFile, JSON.stringify(report, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`\nReport: ${reportFile}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
