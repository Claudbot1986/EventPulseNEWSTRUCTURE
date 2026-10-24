#!/usr/bin/env node
/**
 * probe-listing-links.mjs — mät hur många event-länkar en renderad
 * listningssida faktiskt innehåller.
 *
 * Bakgrund (2026-10-24). D-listing-crawl (runD-listing-crawl.ts) hittade
 * 3 event-URL:er per kategori för billetto 2026-10-24 03:37. En direkt
 * probe med samma mönster gav 0 — vilket antyder att renderresultatet
 * varierar (bot-vägg, olika JS-timing). Mätningen ska skilja på:
 *   - sidan svarade inte alls (blockad/tom)
 *   - sidan svarade men har 0 event-länkar
 *   - sidan svarade och har N event-länkar
 *
 * Användning:
 *   npx tsx scripts/probe-listing-links.mjs <url> [<url> ...]
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const envPath = path.join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const { renderPage } = await import(path.join(ROOT, '02-Ingestion/D-renderGate/renderGate.ts'));
const cheerio = await import('cheerio');

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('usage: npx tsx scripts/probe-listing-links.mjs <url> [<url> ...]');
  process.exit(1);
}

const EVENT_RE = /\/e\/[a-z0-9-]+/i;
const BILJETTER_RE = /\/e\/[a-z0-9-]+-biljetter-\d+/i;

for (const url of urls) {
  const rendered = await renderPage(url, { behavior: 'auto', timeout: 30000 });
  if (!rendered.success || !rendered.html) {
    console.log(`${url}\n  RENDER FAILED: ${rendered.error}\n`);
    continue;
  }
  const $ = cheerio.load(rendered.html);
  const all = new Set();
  const bil = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (EVENT_RE.test(href)) all.add(href);
    if (BILJETTER_RE.test(href)) bil.add(href);
  });
  const scripts = $('script[type="application/ld+json"]').length;
  console.log(
    `${url}\n  bytes=${rendered.html.length} credits=${rendered.metrics?.creditsCharged ?? '?'} ` +
      `a[href]=$($('a[href]').length} /e/=${all.size} -biljetter-=${bil.size} ` +
      `ldjson-blocks=${scripts}`,
  );
  console.log(`  sample: ${Array.from(all).slice(0, 3).join(' | ') || '(inga)'}`);
  console.log(`  head: ${rendered.html.slice(0, 160).replace(/\s+/g, ' ')}\n`);
}
