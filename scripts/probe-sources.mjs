#!/usr/bin/env node
/**
 * Kör universal-extraktorn mot varje aktiv källa i registret och
 * rapporterar: hur många events, och vilka titlar som är "smutsiga"
 * (börjar med datum/tid eller fotokredit).
 *
 * Syfte 1: klassificera om datum-prefix-mönstret är GENERELLT
 *           (flera orelaterade domäner → får rättas i C-lagret) eller
 *           ENKELT DOMÄNSPECIFIKT (då source-adapter, inte C-lager —
 *           Generalization Protection Rule).
 * Syfte 2: census av vilka källor som faktiskt ger events.
 *
 * Kör:  node scripts/probe-sources.mjs [maxPerSource]
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(process.cwd());
const { extractEvents } = await import(
  pathToFileURL(path.join(ROOT, '02-Ingestion/F-eventExtraction/universal-extractor.ts')).href
);

const MONTH =
  'januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec';
const LEADING_DATE_RX = new RegExp(
  '^\\s*(?:' +
    '\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}' +
    '|\\d{1,2}\\s*(?:' + MONTH + ')\\b\\.?\\s*,?\\s*\\d{4}?' +
    '|\\d{1,2}\\s*[-–]\\s*\\d{1,2}\\s*(?:' + MONTH + ')\\b\\.?' +
    '|(?:' + MONTH + ')\\b\\s+\\d{1,2},?\\s*\\d{4}?' +
  ')(?:\\s*[-–,]?\\s*\\d{1,2}[:.]\\d{2}(?:\\s*[-–]\\s*\\d{1,2}[:.]\\d{2})?)?\\s*',
  'i',
);
const LEADING_CREDIT_RX = /^\s*(?:foto|fotograf|photo|image|bild)\s*[:–-]\s*\S/i;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sourcesDir = path.join(ROOT, 'sources');
const files = fs
  .readdirSync(sourcesDir)
  .filter((f) => f.endsWith('.jsonl'))
  .sort();

const limit = Number(process.argv[2] || 0);
const results = [];

for (const file of files) {
  let src;
  try {
    src = JSON.parse(fs.readFileSync(path.join(sourcesDir, file), 'utf8').split('\n')[0]);
  } catch {
    continue;
  }
  if (!src?.url) continue;
  if (src.status === 'retired' || src.quarantined) continue;

  let html = '';
  let status = 0;
  try {
    const res = await fetch(src.url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    status = res.status;
    html = await res.text();
  } catch (e) {
    results.push({ id: src.id, url: src.url, status: 0, error: String(e.message).slice(0, 80), events: 0 });
    continue;
  }

  let events = [];
  let altText = 0;
  try {
    const r = extractEvents(html, src.id, src.url);
    events = r.events || [];
    altText = events.filter((e) => (e.confidence?.signals || []).includes('title-from-img-alt')).length;
  } catch (e) {
    results.push({ id: src.id, url: src.url, status, error: `extract: ${String(e.message).slice(0, 80)}`, events: 0 });
    continue;
  }

  const dirty = events.filter((e) => {
    const t = e.title || '';
    const stripped = t.replace(LEADING_DATE_RX, '').trim();
    return (
      (LEADING_DATE_RX.test(t) && stripped.length >= 3 && !/^[\d\s.,–-]*$/.test(stripped)) ||
      LEADING_CREDIT_RX.test(t)
    );
  });

  results.push({
    id: src.id,
    url: src.url,
    status,
    events: events.length,
    altText,
    dirty: dirty.map((e) => e.title.slice(0, 90)),
    sample: events.slice(0, 2).map((e) => (e.title || '').slice(0, 60)),
  });
  console.error(
    `${results.length}/${files.length} ${src.id.padEnd(46)} status=${status} events=${events.length} alt=${altText} dirty=${dirty.length}`,
  );
  if (limit && results.length >= limit) break;
}

fs.writeFileSync(path.join(ROOT, 'runtime/probe-sources.json'), JSON.stringify(results, null, 2));

const withEvents = results.filter((r) => r.events > 0);
const zero = results.filter((r) => r.events === 0);
const failed = results.filter((r) => r.status === 0 || r.status >= 400);
const dirtySources = results.filter((r) => r.dirty?.length);

console.log('\n================ SAMMANFATTNING ================');
console.log(`Källor kollade: ${results.length}`);
console.log(`Med events: ${withEvents.length}  (till ${withEvents.reduce((a, r) => a + r.events, 0)} events)`);
console.log(`Noll events: ${zero.length}`);
console.log(`Nätverksfel/4xx-5xx: ${failed.length}`);
console.log('');
console.log('--- Noll-event-källor (potentiella fel) ---');
for (const r of zero) console.log(`  ${r.id.padEnd(46)} status=${r.status} ${r.error || ''} ${r.url}`);
console.log('');
console.log('--- Smutsiga titlar per domän ---');
const byDomain = new Map();
for (const r of dirtySources) {
  let host = '';
  try {
    host = new URL(r.url).hostname.replace(/^www\./, '');
  } catch {}
  byDomain.set(host, (byDomain.get(host) || 0) + r.dirty.length);
}
for (const [host, n] of [...byDomain.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${host.padEnd(40)} ${n}`);
}
for (const r of dirtySources) {
  for (const t of r.dirty.slice(0, 3)) console.log(`    [${r.id}] ${t}`);
}
