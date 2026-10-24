#!/usr/bin/env node
/**
 * probe-render-extract.mjs — kan D-gatens HELA väg (render + extraktion)
 * få events ur en bot-väggad källa?
 *
 * renderGate svarar "success" är inte nog — D-gatens extraktion måste
 * också hitta events, annars går källan till postD-man (begravning).
 *
 * Detta kör D-gatens riktiga renderPage + universal-extractor på samma sätt
 * som runD-scrapingbee.ts gör. Inga skrivningar till produktionen.
 *
 * Användning: node scripts/probe-render-extract.mjs <url> [<url> ...]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

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
const { extractFromHtml } = await import(
  path.join(ROOT, '02-Ingestion/F-eventExtraction/universal-extractor.ts')
);

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('usage: node scripts/probe-render-extract.mjs <url> [<url> ...]');
  process.exit(1);
}

for (const url of urls) {
  const started = Date.now();
  const rendered = await renderPage(url, { behavior: 'auto', timeout: 30000 });
  if (!rendered.success || !rendered.html) {
    console.log(`${url}\n  render FAILED: ${rendered.error}\n`);
    continue;
  }

  const extracted = extractFromHtml(rendered.html, url);
  const events = extracted.events ?? extracted.extractedEvents ?? [];
  console.log(
    `${url}\n  bytes=${rendered.html.length} credits=${rendered.metrics?.creditsCharged ?? '?'} ` +
    `events=${events.length} methods=[${(extracted.methodsUsed ?? []).join(', ')}] ` +
    `${Math.round((Date.now() - started) / 1000)}s`,
  );
  for (const e of events.slice(0, 3)) {
    console.log(`   - ${e.title ?? e.name ?? '(utan titel)'} @ ${e.date ?? e.startDate ?? '?'}`);
  }
  console.log('');
}
