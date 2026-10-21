#!/usr/bin/env node
/**
 * scripts/snapshot_live.mjs
 *
 * Passiv screenshot-snapshot som tar skärmdumpar av dashboard varje sekund
 * UTAN att klicka på något. Använd för att bevaka en körning som startats via
 * curl i annan terminal — samlar samma evidens som verify_bfl_live men utan
 * att röra UI:t.
 *
 * Kör: node scripts/snapshot_live.mjs <label> [duration-seconds]
 *   label = godtycklig sträng för ut-mapp
 *   duration (default 120) = antal sekunder att köra
 *
 * Output:
 *   evidence/live/<label>/
 *     shot-<NNNN>.png    (varje sekund)
 *     status.jsonl       (en rad per sample)
 */
import { chromium } from 'playwright';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = 'http://localhost:7777';
const LABEL = process.argv[2] ?? `snapshot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const DURATION = parseInt(process.argv[3] ?? '120', 10);

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/Users/claudgashi/Library/Caches/ms-playwright';
}

const OUT_DIR = `evidence/live/${LABEL}`;
mkdirSync(OUT_DIR, { recursive: true });

console.log(`[snapshot] startar passiv snapshot i ${DURATION}s  ut=${OUT_DIR}`);

function writeStatus(line) {
  appendFileSync(join(OUT_DIR, 'status.jsonl'), line + '\n');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(1500);
  console.log(`[snapshot] dashboard loaded`);

  const t0 = Date.now();
  let frames = 0;
  const samples = [];

  while (true) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    const sample = await page.evaluate(() => {
      const status = document.querySelector('#bfl-zoom-status');
      const statusRect = status?.getBoundingClientRect();
      const text = status?.textContent?.trim() ?? null;
      const hidden = status?.classList?.contains('bfl-ingestion-status--hidden') ?? true;
      const color = status ? getComputedStyle(status).color : null;
      // Försök extrahera imageCount / count ur texten (regex)
      const m = text && text.match(/(\d+)\s*\/\s*(\d+)/);
      const m2 = text && text.match(/count[=: ]+(\d+)/i);
      return {
        statusText: text,
        statusHidden: hidden,
        statusColor: color,
        statusInViewport: statusRect ? statusRect.bottom <= 900 && statusRect.top >= 0 : null,
        extractedCompletedCount: m ? parseInt(m[1]) : null,
        extractedCount: m ? parseInt(m[2]) : null,
        extractedCountAuto: m2 ? parseInt(m2[1]) : null,
      };
    });

    const shotName = `shot-${String(frames).padStart(4, '0')}-t${String(elapsed).padStart(3, '0')}s.png`;
    await page.screenshot({ path: join(OUT_DIR, shotName), fullPage: false });

    const line = JSON.stringify({ t: elapsed, frame: frames, ...sample });
    writeStatus(line);
    samples.push(sample);

    if (elapsed >= DURATION) {
      console.log(`[snapshot] klar: ${elapsed}s, ${frames} samples, ${OUT_DIR}`);
      break;
    }
    frames++;
    await page.waitForTimeout(1000);
  }

  // Summary
  const transitions = samples.reduce((acc, s, i) => {
    if (i === 0) return acc;
    if (samples[i-1].statusText !== s.statusText) acc.push({ t: i, from: samples[i-1].statusText, to: s.statusText });
    return acc;
  }, []);

  appendFileSync(join(OUT_DIR, 'transitions.json'), JSON.stringify(transitions, null, 2));
  console.log(`[snapshot] antal status-övergångar: ${transitions.length}`);
  for (const t of transitions.slice(0, 10)) {
    console.log(`  t=${t.t}s: ${t.from?.slice(0, 50) ?? null} → ${t.to?.slice(0, 50) ?? null}`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(2);
});
