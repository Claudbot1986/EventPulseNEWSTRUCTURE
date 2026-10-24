#!/usr/bin/env node
/**
 * probe-root-fallback.mjs — mäter hur många spårade källor som har en URL
 * som INTE svarar medan domänroten lever.
 *
 * Varför (2026-10-24). C0 (`discoverEventCandidates`) avslutar med 0
 * kandidater så snart rot-URL:en inte kan hämtas — och det sker FÖRE
 * sitemap-discovery. En källa vars URL pekar på en död sökväg (t.ex. /kalender
 * som ger 404) dör alltså även om domänroten är fullt levande och har en
 * sitemap med eventsidor.
 *
 * Det här skriptet är BARA en mätning — ingen produktionskod. Det ger
 * beviset som Generalization Protection Rule kräver: en C0-ändring får
 * bara implementeras om mönstret syns på flera ORELATERADE domäner.
 *
 * Användning: node scripts/probe-root-fallback.mjs [--json]
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceFile } from './lib/readSourceFile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'sources');
const asJson = process.argv.includes('--json');
const TIMEOUT_MS = 12_000;

async function probe(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'EventPulse-verify/1.0 (+probe)' },
    });
    const body = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, bytes: body.length, finalUrl: res.url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, bytes: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function loadSources() {
  if (!existsSync(SOURCES_DIR)) return [];
  return readdirSync(SOURCES_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => readSourceFile(path.join(SOURCES_DIR, f)))
    .filter((s) => s && typeof s.url === 'string' && s.url.startsWith('http'));
}

const sources = loadSources();
const results = [];

for (const s of sources) {
  let origin;
  try {
    origin = new URL(s.url).origin;
  } catch {
    continue;
  }
  const urlProbe = await probe(s.url);
  const rootProbe = origin === s.url.replace(/\/$/, '') ? urlProbe : await probe(origin);
  results.push({
    id: s.id,
    url: s.url,
    origin,
    preferredPath: s.preferredPath ?? null,
    urlStatus: urlProbe.status,
    urlOk: urlProbe.ok,
    urlError: urlProbe.error ?? null,
    rootStatus: rootProbe.status,
    rootOk: rootProbe.ok,
    rootError: rootProbe.error ?? null,
    rescuedByRoot: !urlProbe.ok && rootProbe.ok,
  });
}

const rescued = results.filter((r) => r.rescuedByRoot);
const brokenBoth = results.filter((r) => !r.urlOk && !r.rootOk);

if (asJson) {
  console.log(JSON.stringify({ total: results.length, rescued, brokenBoth }, null, 2));
} else {
  console.log(`Spårade källor: ${results.length}`);
  console.log(`\nDÖD URL men LEVANDE ROT (fixen skulle rädda): ${rescued.length}`);
  for (const r of rescued) {
    console.log(`  ${r.id.padEnd(34)} url=${r.urlStatus || r.urlError}  root=${r.rootStatus}  ${r.url}`);
  }
  console.log(`\nDÖD PÅ BÅDA (helt död domän): ${brokenBoth.length}`);
  for (const r of brokenBoth) {
    console.log(`  ${r.id.padEnd(34)} ${r.urlStatus || r.urlError}  ${r.url}`);
  }
}
