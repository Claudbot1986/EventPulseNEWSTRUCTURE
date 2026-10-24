#!/usr/bin/env node
/**
 * probe-render-gate.mjs — kan D-gatens render (ScrapingBee) ta sig förbi
 * bot-väggar som C-gatens plain HTTP inte kan?
 *
 * Bakgrund (2026-10-24). cirkus.se svarar 429 med `x-vercel-mitigated:
 * challenge` redan på första anropet, momentsapp.no svarar 403/429, och
 * dn.se svarar 406. Det är INTE rate-limiting — det är bot-skydd. C-gaten
 * begravde dessa källor som "fetch error".
 *
 * Frågan som avgör routingen: klarar ScrapingBee (riktig browser) dem?
 *   - Om ja → källan ska routas till D-renderGate, inte begravas.
 *   - Om nej → källan är död för oss och ska begravas.
 *
 * Verktyget gör riktiga render-anrop (kostar Scrapingbee-credits) och
 * skriver ingenting till produktionen.
 *
 * Användning: node scripts/probe-render-gate.mjs <url> [<url> ...]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Ladda .env manuellt (renderGate förväntar sig SCRAPINGBEE_API_KEY).
const envPath = path.join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const { renderPage } = await import(
  path.join(ROOT, '02-Ingestion/D-renderGate/renderGate.ts')
);

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('usage: node scripts/probe-render-gate.mjs <url> [<url> ...]');
  process.exit(1);
}

for (const url of urls) {
  const started = Date.now();
  const result = await renderPage(url, { behavior: 'auto', timeout: 30000 });
  const html = result.html ?? '';
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
  const isoDates = (html.match(/\d{4}-\d{2}-\d{2}/g) ?? []).length;
  console.log(
    `${url}\n  success=${result.success} bytes=${html.length} credits=${result.metrics?.creditsCharged ?? '?'} ` +
    `stealth=${result.metrics?.usedStealthFallback ?? false} ${Math.round((Date.now() - started) / 1000)}s`,
  );
  if (result.error) console.log(`  error: ${result.error}`);
  if (title) console.log(`  title: ${title.slice(0, 90)}`);
  console.log(`  iso-dates: ${isoDates}`);
  console.log('');
}
