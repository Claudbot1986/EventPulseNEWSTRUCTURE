#!/usr/bin/env node
/**
 * scripts/_verify_description_rendering.mjs
 *
 * VERIFIERING — read-only mot den riktiga appen (Expo-webb :8081).
 *
 * Målet: bevisa vad appen FAKTISKT visar som beskrivning för ett event
 * i Hem-flödet (events_public direkt) jämfört med Utforska-flödet
 * (agent-API). Vi öppnar ett eventkort, går in i DetailsScreen och läser
 * av den text som renderas under titeln.
 *
 * Kör: node scripts/_verify_description_rendering.mjs [--url=http://localhost:8081]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.argv.find((a) => a.startsWith('--url='))?.slice(6) || 'http://localhost:8081';
const OUT = path.join(process.cwd(), '.scratch', 'evidence', '2026-11-01-description-rendering');
mkdirSync(OUT, { recursive: true });

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/Users/claudgashi/Library/Caches/ms-playwright';
}

const FALLBACK_MARKERS = [
  'No description available',
  'Ingen beskrivning',
  'ingen beskrivning',
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = await ctx.newPage();

async function tapFirst(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const o = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return true;
  }, selector);
}

async function tapByText(needle) {
  return page.evaluate((n) => {
    const all = Array.from(document.querySelectorAll('body *'));
    const hit = all
      .filter((el) => (el.textContent || '').trim().includes(n))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
    if (!hit) return false;
    const o = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    hit.dispatchEvent(new PointerEvent('pointerdown', o));
    hit.dispatchEvent(new PointerEvent('pointerup', o));
    hit.dispatchEvent(new MouseEvent('click', o));
    return true;
  }, needle);
}

/** Tryck på första eventkort (role="button" i en karusell-lista). */
async function tapFirstEventCard() {
  return page.evaluate(() => {
    const lists = Array.from(document.querySelectorAll('[role="list"]'));
    const btns = lists
      .flatMap((l) => Array.from(l.querySelectorAll('[role="button"]')))
      .filter((b) => (b.getAttribute('aria-label') || '').length > 3);
    const el = btns[0];
    if (!el) return false;
    const o = { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return true;
  });
}

const report = { url: BASE_URL, hem: null, utforska: null };

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: path.join(OUT, '01-start.png') });

// ── Hem-flödet ────────────────────────────────────────────────────────────
// Öppna första eventkortet på Hem. Korten renderas som role="button".
const cardSelectors = [
  '[data-testid="event-card"]',
  '[data-testid="event-card-latest"]',
  '[data-testid="event-pulse-card"]',
  '[data-testid="new-event-card"]',
];
let clicked = null;
for (const sel of cardSelectors) {
  if (await tapFirst(sel)) { clicked = sel; break; }
}
if (!clicked) {
  clicked = await tapFirstEventCard();
}
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(OUT, '02-after-card-tap.png'), fullPage: false });

const bodyText = await page.evaluate(() => document.body.innerText);
const hasFallback = FALLBACK_MARKERS.find((m) => bodyText.includes(m));
const detailsOpen = /Tillbaka|Back/i.test(bodyText);
report.hem = {
  clickedSelector: clicked,
  detailsScreenOpen: detailsOpen,
  fallbackMarkerFound: hasFallback ?? null,
  bodyTextSample: bodyText.slice(0, 3200),
};
writeFileSync(path.join(OUT, 'hem.json'), JSON.stringify(report.hem, null, 2));

// ── Utforska-flödet ────────────────────────────────────────────────────────
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);
await tapByText('Utforska');
await page.waitForTimeout(6000);
await page.screenshot({ path: path.join(OUT, '03-utforska.png'), fullPage: false });

const exploreText = await page.evaluate(() => document.body.innerText);
report.utforska = {
  bodyTextSample: exploreText.slice(0, 2600),
};
writeFileSync(path.join(OUT, 'utforska.json'), JSON.stringify(report.utforska, null, 2));

console.log(JSON.stringify({
  hemDetailsOpen: report.hem.detailsScreenOpen,
  hemFallbackMarker: report.hem.fallbackMarkerFound,
  hemSample: report.hem.bodyTextSample.slice(0, 1500),
}, null, 2));

await browser.close();
