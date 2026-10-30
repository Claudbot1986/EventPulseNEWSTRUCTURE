#!/usr/bin/env node
/**
 * text-integrity-scan.mjs — app-omfattande teckenkontroll i den RIKTIGA appen.
 *
 * Driver: Playwright mot Expo-webb (Metro). Går igenom varje yta i appen,
 * samlar ALL synlig text, och rapporterar varje del som innehåller tecken
 * från ett skript som inte hör hemma i appens visningsspråk.
 *
 * Skanningen görs med samma modul som DB-skriptet och UI-skyddet använder
 * (packages/shared/src/text/scriptScan.js) — en sanningskälla, inte tre.
 *
 * Ytor som scannas (justera SURFACES om appen får nya):
 *   hem            — startsidan, inkl. karuseller och sektionsrubriker
 *   hem-detalj     — en event-detaljvy (öppnad från Hem)
 *   utforska       — Utforska-flödet (kategori-tiles + lista)
 *   sok            — sökresultat
 *   karta          — kartvyn
 *   notiser        — notiser
 *   profil         — profil (menyer, språkväljare)
 *
 * Användning:
 *   node .cursor/skills/verify-eventpulse-text-integrity/scripts/text-integrity-scan.mjs
 *   BASE_URL=http://localhost:9090 node .../text-integrity-scan.mjs --language sv
 *   node .../text-integrity-scan.mjs --out 06-UI/runtime/verification-reports/text-integrity-<ts>
 *
 * Exit: 0 = rent, 1 = fynd, 2 = körfel.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { findForeignScriptRuns, summarizeText } from '../../../../packages/shared/src/text/scriptScan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');

// Playwright ligger i 06-UI/node_modules (appens egen installation), inte i
// repo-roten. ESM-resolvrar söker uppåt från SKriptets mapp, så vi pekar
// require-resolutionen på 06-UI/package.json i stället för att installera om.
const require = createRequire(path.join(REPO_ROOT, '06-UI/package.json'));
const { chromium } = require('@playwright/test');
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const BASE_URL = argValue('--base-url', process.env.BASE_URL || 'http://localhost:9090');
const LANGUAGE = argValue('--language', 'sv');
const EVENT_TITLE = argValue('--event-title', null);
const SEARCH_TERM = argValue('--search', 'konsert');
const OUT_DIR = argValue('--out', path.join(REPO_ROOT, '06-UI/runtime/verification-reports', `text-integrity-${Date.now()}`));
const SCREENSHOT = args.includes('--screenshot');

/** Flikarn i appen, i den ordning de ska scannas. */
const TABS = [
  { surface: 'utforska', label: 'Utforska' },
  { surface: 'karta', label: 'Karta' },
  { surface: 'notiser', label: 'Notiser' },
  { surface: 'profil', label: 'Profil' },
];

/**
 * Hämta all synlig text med position. Körs i browsern; själva
 * skript-analysen görs i Node med scriptScan-modulen.
 */
async function collectVisibleText(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (Number(style.opacity) === 0) return false;
      return true;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    let node = walker.nextNode();
    while (node) {
      const text = (node.nodeValue || '').trim();
      if (text) {
        const parent = node.parentElement;
        if (parent && isVisible(parent)) {
          const rect = parent.getBoundingClientRect();
          out.push({
            text,
            tag: parent.tagName.toLowerCase(),
            aria: parent.getAttribute('aria-label') || null,
            role: parent.getAttribute('role') || null,
            x: Math.round(rect.x),
            y: Math.round(rect.y + window.scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
      node = walker.nextNode();
    }
    return out;
  });
}

/** Rubriken till den sektion som texten ligger under (Hem-sidan). */
async function sectionHeadings(page) {
  return page.evaluate(() => {
    const home = document.querySelector('[data-testid="home-screen"]');
    if (!home) return [];
    return Array.from(home.querySelectorAll('div'))
      .filter((d) => d.children.length === 0)
      .map((d) => ({ text: (d.textContent || '').trim(), y: Math.round(d.getBoundingClientRect().y + window.scrollY) }))
      .filter((d) => d.text.length > 0 && d.text.length < 40)
      .sort((a, b) => a.y - b.y);
  });
}

/** Scrolla igenom den scrollbara containern så fler kort renderas. */
async function scrollThrough(page, steps = 6) {
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('body *')).filter((n) => {
        const style = window.getComputedStyle(n);
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 40;
      });
      const target = containers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (target) target.scrollTop += Math.floor(target.clientHeight * 0.8);
    });
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

function analyse(entries, language, surface, headings) {
  const findings = [];
  for (const entry of entries) {
    const runs = findForeignScriptRuns(entry.text, language);
    if (runs.length === 0) continue;
    const summary = summarizeText(entry.text, language);
    const heading = headings
      .filter((h) => h.y <= entry.y)
      .sort((a, b) => b.y - a.y)[0];
    findings.push({
      surface,
      section: heading?.text ?? null,
      text: entry.text.slice(0, 160),
      runs: runs.map((r) => r.text),
      scripts: summary.scripts.map((s) => ({ id: s.id, label: s.label, group: s.group, count: s.count })),
      tag: entry.tag,
      aria: entry.aria,
      role: entry.role,
      y: entry.y,
    });
  }
  return findings;
}

async function tapTab(page, label) {
  return page.evaluate((needle) => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const tabs = Array.from(document.querySelectorAll('[role="tab"], button')).filter(isVisible);
    const tab = tabs.find((t) => (t.getAttribute('aria-label') || t.textContent || '').trim().toLowerCase().includes(needle.toLowerCase()));
    if (!tab) return { ok: false };
    const opts = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    tab.dispatchEvent(new PointerEvent('pointerdown', opts));
    tab.dispatchEvent(new PointerEvent('pointerup', opts));
    tab.dispatchEvent(new MouseEvent('click', opts));
    return { ok: true };
  }, label);
}

async function openFirstEventDetail(page, wantedTitle) {
  return page.evaluate((wanted) => {
    const home = document.querySelector('[data-testid="home-screen"]');
    const scope = home || document.body;
    const candidates = Array.from(scope.querySelectorAll('button, [role="button"]')).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    // Riktiga eventkort har en a11y-label som "<datum> — <titel>".
    // Vi väljer helst ett kort vars titel matchar det sökta namnet,
    // annars det första kortet med den formen.
    const labelled = candidates.filter((el) => {
      const aria = el.getAttribute('aria-label') || '';
      return aria.includes('—') || aria.includes(' - ');
    });
    const pool = labelled.length > 0 ? labelled : candidates;

    let card = pool[0];
    if (wanted) {
      const needle = wanted.toLowerCase();
      const hit = pool.find((el) =>
        (el.getAttribute('aria-label') || el.textContent || '').toLowerCase().includes(needle),
      );
      if (hit) card = hit;
    }
    if (!card) return { ok: false, reason: 'no-card' };

    const opts = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    card.dispatchEvent(new PointerEvent('pointerdown', opts));
    card.dispatchEvent(new PointerEvent('pointerup', opts));
    card.dispatchEvent(new MouseEvent('click', opts));
    return { ok: true, aria: card.getAttribute('aria-label') || (card.textContent || '').trim().slice(0, 100) };
  }, wantedTitle ?? null);
}

/**
 * Öppna första sökträffen. Träffrader i Utforska är trykbara rader med
 * "<kategori> — <titel>" som a11y-label — samma form som på Hem.
 */
async function openFirstResult(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]')).filter(isVisible);
    const withLabel = candidates.filter((el) => {
      const aria = el.getAttribute('aria-label') || '';
      return aria.includes('—') || aria.includes(' - ');
    });
    const card = withLabel[0] || candidates[0];
    if (!card) return { ok: false, reason: 'no-result' };
    const opts = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    card.dispatchEvent(new PointerEvent('pointerdown', opts));
    card.dispatchEvent(new PointerEvent('pointerup', opts));
    card.dispatchEvent(new MouseEvent('click', opts));
    return { ok: true, aria: card.getAttribute('aria-label') || (card.textContent || '').trim().slice(0, 100) };
  });
}

async function goBack(page) {
  const result = await page.evaluate(() => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    // "Tillbaka" renderas ofta som "< Tillbaka" (med chevron) i en vanlig
    // <div> (TouchableOpacity utan role). Därför matchar vi på "innehåller"
    // och tar det djupaste träffen — samma strategi som e2e-hjälparna.
    const all = Array.from(document.querySelectorAll('body *')).filter(isVisible);
    const hits = all.filter((el) => {
      const text = (el.textContent || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      return text.includes('Tillbaka') || aria.includes('Tillbaka')
        || text.includes('Back') || aria.includes('Back');
    });
    if (!hits.length) return { ok: false, reason: 'no-back-button' };
    const target = hits.find((el) => !hits.some((other) => other !== el && el.contains(other))) || hits[0];
    const opts = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));
    return { ok: true, text: (target.textContent || '').trim().slice(0, 40) };
  });

  // Vänta in att Hem faktiskt syns igen — annars fortsätter nästa yta
  // att scanna detaljvyn i stället för den flik vi avsåg.
  await page.waitForTimeout(1500);
  try {
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="home-screen"]')),
      { timeout: 8000 },
    );
    result.homeVisible = true;
  } catch {
    result.homeVisible = false;
  }
  return result;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push({ type: 'pageerror', text: err.message }));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (text.includes('agent/health') && text.includes('CORS')) return;
    if (text === 'Failed to load resource: net::ERR_FAILED' && /agent\/(health|feed)/.test(text)) return;
    consoleErrors.push({ type: 'console', text });
  });

  const allFindings = [];
  const surfaces = [];

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(6_000);

    // ── Hem (inkl. karuseller och sektioner) ───────────────────────────────
    await scrollThrough(page);
    const homeEntries = await collectVisibleText(page);
    const homeHeadings = await sectionHeadings(page);
    allFindings.push(...analyse(homeEntries, LANGUAGE, 'hem', homeHeadings));
    surfaces.push({ surface: 'hem', text_nodes: homeEntries.length, sections: homeHeadings.length });
    if (SCREENSHOT) await page.screenshot({ path: path.join(OUT_DIR, 'hem.png'), fullPage: false });

    // ── Event-detaljvy (öppnad från Hem) ─────────────────────────────────
    const opened = await openFirstEventDetail(page, EVENT_TITLE);
    if (opened.ok) {
      await page.waitForTimeout(3_500);
      const detailEntries = await collectVisibleText(page);
      allFindings.push(...analyse(detailEntries, LANGUAGE, 'hem-detalj', []));
      surfaces.push({ surface: 'hem-detalj', text_nodes: detailEntries.length, opened_card: opened.aria });
      if (SCREENSHOT) await page.screenshot({ path: path.join(OUT_DIR, 'hem-detalj.png') });
      const back = await goBack(page);
      surfaces[surfaces.length - 1].back = back;
    } else {
      surfaces.push({ surface: 'hem-detalj', error: opened.reason ?? 'not-opened' });
    }

    // ── Övriga flikar ─────────────────────────────────────────────────────
    for (const tab of TABS) {
      const tapped = await tapTab(page, tab.label);
      if (!tapped.ok) {
        surfaces.push({ surface: tab.surface, error: 'tab-not-found' });
        continue;
      }
      await page.waitForTimeout(3_500);
      await scrollThrough(page, 4);
      const entries = await collectVisibleText(page);
      allFindings.push(...analyse(entries, LANGUAGE, tab.surface, []));
      surfaces.push({ surface: tab.surface, text_nodes: entries.length });
      if (SCREENSHOT) await page.screenshot({ path: path.join(OUT_DIR, `${tab.surface}.png`) });
    }

    // ── Sök → öppna träff → detaljvy ─────────────────────────────────────
    await tapTab(page, 'Utforska');
    await page.waitForTimeout(3_000);
    const searched = await page.evaluate((term) => {
      // Appen använder en testid på sökfältet (utforska). Fallback till
      // första input om testid-versionen inte finns.
      const input = document.querySelector('[data-testid="explore-search-input"]')
        || document.querySelector('input');
      if (!input) return { ok: false, reason: 'no-input' };
      // React skriver value via den naturliga setters prototypen. Vi hämtar
      // sättaren från elementets EGEN prototyp — testid-elementet är inte
      // alltid en <input>, och en setter från fel prototyp ger
      // "Illegal invocation".
      const proto = Object.getPrototypeOf(input);
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (descriptor && descriptor.set) {
        descriptor.set.call(input, term);
      } else {
        input.value = term;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, tag: input.tagName, placeholder: input.getAttribute('placeholder') || input.getAttribute('aria-label') };
    }, SEARCH_TERM);
    if (searched.ok) {
      await page.waitForTimeout(5_000);
      const entries = await collectVisibleText(page);
      allFindings.push(...analyse(entries, LANGUAGE, 'sok', []));
      surfaces.push({ surface: 'sok', text_nodes: entries.length, query: SEARCH_TERM });
      if (SCREENSHOT) await page.screenshot({ path: path.join(OUT_DIR, 'sok.png') });

      // Öppna första träffen — det är där lokal och beskrivning visas.
      const openedResult = await openFirstResult(page);
      if (openedResult.ok) {
        await page.waitForTimeout(3_500);
        const detailEntries = await collectVisibleText(page);
        allFindings.push(...analyse(detailEntries, LANGUAGE, 'sok-detalj', []));
        surfaces.push({ surface: 'sok-detalj', text_nodes: detailEntries.length, opened: openedResult.aria });
        if (SCREENSHOT) await page.screenshot({ path: path.join(OUT_DIR, 'sok-detalj.png') });
        const back = await goBack(page);
        surfaces[surfaces.length - 1].back = back;
      } else {
        surfaces.push({ surface: 'sok-detalj', error: openedResult.reason ?? 'not-opened' });
      }
    } else {
      surfaces.push({ surface: 'sok', error: searched.reason });
    }
  } finally {
    await browser.close();
  }

  // ── Rapport ────────────────────────────────────────────────────────────
  const bySurface = {};
  const byScript = {};
  const bySection = {};
  for (const finding of allFindings) {
    bySurface[finding.surface] = (bySurface[finding.surface] ?? 0) + 1;
    const sectionKey = finding.section ? `${finding.surface}/${finding.section}` : finding.surface;
    bySection[sectionKey] = (bySection[sectionKey] ?? 0) + 1;
    for (const script of finding.scripts) {
      byScript[script.id] = (byScript[script.id] ?? 0) + script.count;
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    language: LANGUAGE,
    findings: allFindings.length,
    by_surface: bySurface,
    by_section: bySection,
    by_script: byScript,
    surfaces,
    console_errors: consoleErrors,
    details: allFindings,
  };

  const reportPath = path.join(OUT_DIR, 'text-integrity-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n[text-integrity] ${allFindings.length} fynd (språk=${LANGUAGE}, url=${BASE_URL})`);
  console.log(`[text-integrity] per yta: ${JSON.stringify(bySurface)}`);
  console.log(`[text-integrity] per sektion: ${JSON.stringify(bySection)}`);
  console.log(`[text-integrity] per skript: ${JSON.stringify(byScript)}`);
  if (consoleErrors.length > 0) {
    console.log(`[text-integrity] konsolfel: ${consoleErrors.length}`);
  }
  console.log(`[text-integrity] rapport: ${reportPath}`);

  for (const finding of allFindings.slice(0, 40)) {
    console.log(
      `  - [${finding.surface}${finding.section ? `/${finding.section}` : ''}] ` +
        `${finding.scripts.map((s) => `${s.label}×${s.count}`).join(', ')} — "${finding.text.slice(0, 90)}"`,
    );
  }
  if (allFindings.length > 40) console.log(`  … och ${allFindings.length - 40} till.`);

  process.exit(allFindings.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[text-integrity] fatal:', error?.message || error);
  process.exit(2);
});
