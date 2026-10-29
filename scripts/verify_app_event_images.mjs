#!/usr/bin/env node
/**
 * scripts/verify_app_event_images.mjs
 *
 * Verifierar att EventPulses events faktiskt VISAR bilder i appen — inte bara
 * att DB-raderna har en image_url.
 *
 * Kör den riktiga Expo-appen i webbläsaren (port 8081), scrollar igenom
 * feeden och samlar:
 *   - eventkort som har en LADDAD bild (React Native Web renderar Image
 *     som ett element med background-image)
 *   - eventkort som visar platshållare (trasig URL)
 *   - de unika bild-URL:erna
 *
 * Varje unik URL hämtas sedan i Node och kontrolleras:
 *   - HTTP 200 + content-type image/webp
 *   - faktiska pixeldimensioner → aspect 1.5 (3:2), som användaren bestämde
 *
 * Bevis (screenshots + JSON-rapport):
 *   .scratch/evidence/<YYYY-MM-DD>-app-images/
 *
 * Kör:
 *   node scripts/verify_app_event_images.mjs [--sample=300] [--timeout=600]
 *
 * Exitkod: 0 = minst `--sample` bilder laddade och verifierade, 1 = fel,
 * 2 = fatalt fel.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';
const PROJECT_ROOT = process.cwd();

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/Users/claudgashi/Library/Caches/ms-playwright';
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const SAMPLE = Math.max(1, parseInt(arg('sample', '300'), 10) || 300);
const TIMEOUT_S = Math.max(60, parseInt(arg('timeout', '600'), 10) || 600);
const DAY = new Date().toISOString().slice(0, 10);
const EVIDENCE_DIR = path.join(PROJECT_ROOT, '.scratch', 'evidence', `${DAY}-app-images`);

mkdirSync(EVIDENCE_DIR, { recursive: true });

function log(...a) { console.log('[verify-app]', ...a); }

/** Samlar bild-URL:er och platshållare från DOM:en. */
async function collectFrames(page) {
  return page.evaluate(() => {
    const frames = Array.from(
      document.querySelectorAll('[data-testid="event-card-image"], [data-testid="event-card-image-latest"]'),
    );
    const urls = [];
    let placeholders = 0;
    for (const frame of frames) {
      let found = null;
      for (const el of frame.querySelectorAll('*')) {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') continue;
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m && m[1] && !m[1].startsWith('data:')) {
          found = m[1];
          break;
        }
      }
      if (found) urls.push(found);
      else placeholders += 1;
    }
    return { total: frames.length, urls, placeholders };
  });
}

/** Scrollar alla scrollbara containrar + fönstret, så fler kort laddas. */
async function scrollDown(page) {
  return page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('body *')).filter((n) => {
      const st = getComputedStyle(n);
      return (st.overflowY === 'auto' || st.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 40;
    });
    let moved = 0;
    for (const c of containers) {
      const before = c.scrollTop;
      c.scrollTop = Math.min(c.scrollTop + c.clientHeight * 0.9, c.scrollHeight);
      if (c.scrollTop !== before) moved += 1;
    }
    window.scrollBy(0, window.innerHeight * 0.9);
    if (moved === 0) {
      // Ingen container rörde sig — vi är troligen i slutet.
      return { moved: 0, atEnd: true };
    }
    return { moved, atEnd: false };
  });
}

async function main() {
  const errors = [];
  const report = { startedAt: new Date().toISOString(), baseUrl: BASE_URL, sample: SAMPLE, evidenceDir: EVIDENCE_DIR };

  log(`Startar chromium mot ${BASE_URL} (mål: ${SAMPLE} bilder)…`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const brokenWarnings = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    if (m.type() === 'warning' && m.text().includes('onError')) brokenWarnings.push(m.text());
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(8_000);

  const unique = new Set();
  let frames = { total: 0, urls: [], placeholders: 0 };
  let maxPlaceholders = 0;
  const started = Date.now();
  let scrolls = 0;
  let stuck = 0;

  while (unique.size < SAMPLE && Date.now() - started < TIMEOUT_S * 1000) {
    frames = await collectFrames(page);
    for (const u of frames.urls) unique.add(u);
    maxPlaceholders = Math.max(maxPlaceholders, frames.placeholders);
    scrolls += 1;
    if (scrolls % 5 === 0) {
      log(`  scroll ${scrolls}: kort=${frames.total} unika bilder=${unique.size} platshållare=${frames.placeholders}`);
    }
    const r = await scrollDown(page);
    if (r.atEnd) {
      stuck += 1;
      if (stuck >= 3) break;
    } else {
      stuck = 0;
    }
    await page.waitForTimeout(700);
  }

  frames = await collectFrames(page);
  for (const u of frames.urls) unique.add(u);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-feed.png'), fullPage: false });
  log(`samlat: kort=${frames.total} unika bild-URL:er=${unique.size} platshållare=${frames.placeholders}`);

  // Hämta och dimensionera varje unik URL.
  const urls = [...unique];
  const checked = [];
  const byStatus = {};
  let ok = 0;
  let badStatus = 0;
  let wrongAspect = 0;
  let failedFetch = 0;

  for (const u of urls) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
      const status = res.status;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (!res.ok) {
        badStatus += 1;
        checked.push({ url: u, status, ok: false });
        continue;
      }
      const ct = res.headers.get('content-type') ?? '';
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const aspect = meta.width && meta.height ? meta.width / meta.height : null;
      const dev = aspect ? Math.abs(aspect - 1.5) / 1.5 : 1;
      const isOk = ct.includes('image/webp') && dev <= 0.01;
      if (isOk) ok += 1;
      else wrongAspect += 1;
      checked.push({
        url: u,
        status,
        contentType: ct,
        width: meta.width,
        height: meta.height,
        aspect: aspect ? Number(aspect.toFixed(4)) : null,
        bytes: buf.length,
        ok: isOk,
      });
    } catch (e) {
      failedFetch += 1;
      checked.push({ url: u, status: 'ERR', error: String(e.message ?? e), ok: false });
    }
  }

  const aspects = checked.map((c) => c.aspect).filter((a) => typeof a === 'number');
  const aspectSpread = aspects.length ? Math.max(...aspects) - Math.min(...aspects) : null;

  report.final = {
    cards: frames.total,
    placeholders: frames.placeholders,
    uniqueUrls: unique.size,
    checked: checked.length,
    ok,
    badStatus,
    wrongAspect,
    failedFetch,
    byStatus,
    aspectSpread,
    scrolls,
  };
  report.checked = checked;
  report.consoleErrors = consoleErrors;
  report.brokenWarnings = brokenWarnings.slice(0, 20);

  await browser.close();

  // Assertions
  if (unique.size < SAMPLE) {
    errors.push(`FAIL: bara ${unique.size} unika bilder hittades i appen (mål ${SAMPLE})`);
  }
  if (ok !== checked.length) {
    errors.push(`FAIL: ${checked.length - ok} av ${checked.length} bilder är inte giltiga 3:2-WebP (HTTP 200 + aspect 1.5)`);
  }
  if (frames.placeholders > 0) {
    errors.push(`FAIL: ${frames.placeholders} eventkort visar platshållare istället för bild`);
  }
  if (aspectSpread !== null && aspectSpread > 0.02) {
    errors.push(`FAIL: bildernas aspect sprider ${aspectSpread.toFixed(3)} (> 0.02)`);
  }
  if (brokenWarnings.length > 0) {
    errors.push(`FAIL: ${brokenWarnings.length} onError-varningar i konsolen (trasiga bild-URL:er)`);
  }

  report.finishedAt = new Date().toISOString();
  report.errors = errors;
  writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), JSON.stringify(report, null, 2));

  log('');
  log('=== RESULTAT ===');
  log(`bevis: ${EVIDENCE_DIR}`);
  log(`kort=${frames.total} platshållare=${frames.placeholders} unika URL:er=${unique.size}`);
  log(`HTTP-status: ${JSON.stringify(byStatus)}`);
  log(`giltiga 3:2-WebP: ${ok}/${checked.length} · fel status=${badStatus} · fel aspect=${wrongAspect} · fetch-fel=${failedFetch}`);
  log(`aspect-spridning: ${aspectSpread === null ? 'n/a' : aspectSpread.toFixed(4)}`);
  log(`onError-varningar: ${brokenWarnings.length}`);
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
