#!/usr/bin/env node
/**
 * probe-fail-sources.mjs — orsaksutredning av källor som failar OCH ger
 * noll events.
 *
 * Bakgrund (2026-10-24). 89 spårade källor har senaste status `fail`.
 * 23 av dem har ändå events i databasen — de är en falsk-fail-klass (B-gatens
 * statusrad skrivs före C-gatens extraktion). De 66 som failar OCH har noll
 * events är den verkliga arbetslistan.
 *
 * Skriptet delar dem i två grupper:
 *   DÖD       — domänen svarar inte alls (DNS, SSL, 404, 410).
 *                Kandidater för kyrkograv, MEN bara efter levande verifiering.
 *   LEVANDE   — sajten svarar (200/301/403/429). Dessa ger inga events av
 *                en riktig orsak: fel ingång, JS-rendering, eller att
 *                event-sidan inte hittas. De behöver genomgång i C-gaten.
 *
 * Detta är ett MÄTSKRIPT — det skriver ingenting i runtime eller databas.
 *
 * Användning: node scripts/probe-fail-sources.mjs [--json]
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readSourceFile } from './lib/readSourceFile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'sources');
const asJson = process.argv.includes('--json');
const TIMEOUT_MS = 15_000;

function envKey(key) {
  if (!existsSync(path.join(ROOT, '.env'))) return undefined;
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

/** Antal events per source i databasen. */
async function eventCounts() {
  const url = process.env.DATABASE_URL ?? envKey('DATABASE_URL');
  if (!url) throw new Error('DATABASE_URL saknas');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query('SELECT source, count(*)::int AS n FROM events GROUP BY source');
    return new Map(res.rows.map((r) => [r.source, r.n]));
  } finally {
    await client.end();
  }
}

/** Senaste statusrad per sourceId. */
function latestStatuses() {
  const file = path.join(ROOT, 'runtime', 'sources_status.jsonl');
  const last = new Map();
  if (!existsSync(file)) return last;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.sourceId) last.set(d.sourceId, d);
    } catch { /* trasig rad hoppas över */ }
  }
  return last;
}

function loadTracked() {
  const out = new Map();
  for (const f of readdirSync(SOURCES_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const d = readSourceFile(path.join(SOURCES_DIR, f));
    if (d && typeof d.url === 'string' && d.url.startsWith('http')) {
      out.set(d.id || f.replace(/\.jsonl$/, ''), d);
    }
  }
  return out;
}

async function probe(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
    });
    await res.text().catch(() => '');
    return { status: res.status, finalUrl: res.url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Klassificera ett HTTP-svar. */
function classify(status, error) {
  if (status === 0) {
    if (/ENOTFOUND|getaddrinfo/i.test(error || '')) return 'dead-dns';
    if (/SSL|certificate|self.signed|UNABLE_TO_VERIFY/i.test(error || '')) return 'dead-ssl';
    if (/ECONNREFUSED/i.test(error || '')) return 'dead-refused';
    if (/abort|timeout/i.test(error || '')) return 'timeout';
    return 'dead-other';
  }
  if (status === 404 || status === 410) return 'dead-404';
  if (status === 403) return 'blocked-403';
  if (status === 429) return 'rate-limited-429';
  if (status >= 500) return 'server-5xx';
  if (status >= 200 && status < 400) return 'alive';
  return 'other-' + status;
}

const counts = await eventCounts();
const statuses = latestStatuses();
const tracked = loadTracked();

const targets = [];
for (const [id, source] of tracked) {
  const st = statuses.get(id);
  if (!st || st.status !== 'fail') continue;
  if ((counts.get(id) || 0) > 0) continue; // falsk fail — har events
  targets.push({ id, url: source.url, preferredPath: source.preferredPath ?? null });
}

const results = [];
for (const t of targets) {
  const p = await probe(t.url);
  results.push({
    ...t,
    status: p.status,
    error: p.error ?? null,
    finalUrl: p.finalUrl ?? null,
    class: classify(p.status, p.error),
  });
}

const dead = results.filter((r) => r.class.startsWith('dead'));
const alive = results.filter((r) => !r.class.startsWith('dead'));

if (asJson) {
  console.log(JSON.stringify({ total: results.length, dead, alive }, null, 2));
} else {
  console.log(`Spårade, failar och ger noll events: ${results.length}\n`);
  console.log(`DÖDA (${dead.length}) — kyrkogravskandidater:`);
  for (const r of dead) {
    console.log(`  ${r.id.padEnd(36)} ${r.class.padEnd(14)} ${r.status || r.error}  ${r.url}`);
  }
  console.log(`\nLEVANDE MEN INGA EVENTS (${alive.length}) — orsaksutredning i C-gaten:`);
  for (const r of alive) {
    console.log(`  ${r.id.padEnd(36)} ${r.class.padEnd(14)} ${r.status || r.error}  ${r.url}`);
  }
}
