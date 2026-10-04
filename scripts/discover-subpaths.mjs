#!/usr/bin/env node
/**
 * discover-subpaths.mjs — Auto-discover event subpaths per source.
 *
 * För varje source-fil: testar 12 kända event-subpaths och returnerar de som
 * har JSON-LD events. Resultat sparas till data/subpath-discovery-results.jsonl.
 *
 * Användning:
 *   node scripts/discover-subpaths.mjs
 *   node scripts/discover-subpaths.mjs --max-sources=20
 */

import 'dotenv/config';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const SUBPATHS = [
  '/events', '/events', '/evenemang', '/event', '/program',
  '/kalender', '/calendar', '/forestallning', '/forestallningar',
  '/konsert', '/konserter', '/show', '/shows', '/agenda',
  '/pagar', '/whatson', '/whats-on', '/utstallning',
];

const RATE_LIMIT_MS = 500;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function probe(baseUrl, subpath) {
  const url = `${baseUrl.replace(/\/$/, '')}${subpath}`;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 6000);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0', Accept: 'text/html' },
      signal: c.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const body = await r.text();
    if (body.length < 1000) return null;
    // Count events
    const jsonLd = (body.match(/"@type"\s*:\s*"Event"/g) || []).length;
    const micro = (body.match(/itemtype="https:\/\/schema\.org\/Event"/g) || []).length;
    const events = jsonLd + micro;
    return events > 0 ? { url, events, jsonLd, micro } : null;
  } catch { return null; }
}

async function main() {
  const args = process.argv.slice(2);
  const maxSources = parseInt((args.find((a) => a.startsWith('--max-sources=')) ?? '--max-sources=999').split('=')[1], 10);

  // Load sources
  const sourceFiles = readdirSync('sources').filter((f) => f.endsWith('.jsonl') && !f.startsWith('_'));
  const sources = [];
  const seen = new Set();
  for (const f of sourceFiles) {
    try {
      const lines = readFileSync(join('sources', f), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const d = JSON.parse(line);
        if (d.url && !seen.has(d.id) && d.id) {
          seen.add(d.id);
          sources.push({ slug: d.id, url: d.url });
          break;
        }
      }
    } catch {}
  }
  const selected = sources.slice(0, maxSources);
  console.log(`Subpath discovery — ${selected.length} sources`);

  const results = [];
  for (const src of selected) {
    console.log(`\n--- ${src.slug} (${src.url}) ---`);
    const findings = [];
    for (const sub of SUBPATHS) {
      await sleep(RATE_LIMIT_MS);
      const r = await probe(src.url, sub);
      if (r && r.events > 0) {
        findings.push(r);
        console.log(`  ${sub}: ${r.events} events`);
      }
    }
    results.push({ slug: src.slug, baseUrl: src.url, findings, ts: new Date().toISOString() });
    if (findings.length === 0) console.log(`  (no event subpaths found)`);
  }

  writeFileSync('data/subpath-discovery-results.jsonl', results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const withFindings = results.filter((r) => r.findings.length > 0);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Sources probed: ${results.length}`);
  console.log(`Sources with event subpaths: ${withFindings.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });