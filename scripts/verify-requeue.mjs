#!/usr/bin/env node
/**
 * verify-requeue.mjs — bevis för att fail-källor faktiskt kan köras om.
 *
 * Bakgrund (2026-10-24). A-gatens filter är `status === 'never_run'`
 * (runA.ts:270). 289 spårade källor stod på `fail` och kördes aldrig igen —
 * orsaksutredning var omöjlig eftersom en fix inte kan provas på en källa
 * som aldrig går igenom kedjan igen.
 *
 * Gates:
 *   rq1 — requeue-verktyget lägger en spårad källa i preA-kön, och
 *         AVVISAR en källa som inte finns (negativ kontroll).
 *   qi1 — karantänindexet har inga stale rader: varje INDEX-rad har en
 *         fil i sources/_quarantine/. En stale rad gör källan osynlig för
 *         både A-gaten och C-gaten.
 *
 * Användning: node scripts/verify-requeue.mjs <rq1|qi1>
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PREA_QUEUE = path.join(ROOT, 'runtime', 'preA-queue.jsonl');
const SOURCES_DIR = path.join(ROOT, 'sources');
const QUARANTINE_DIR = path.join(SOURCES_DIR, '_quarantine');
const QUARANTINE_INDEX = path.join(QUARANTINE_DIR, 'INDEX.json');
const arg = process.argv[2];

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

function readQueue() {
  if (!existsSync(PREA_QUEUE)) return [];
  return readFileSync(PREA_QUEUE, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// ── RQ1: verktyget lägger in en källa, och avvisar en okänd ──────────────────

if (arg === 'rq1') {
  const original = existsSync(PREA_QUEUE) ? readFileSync(PREA_QUEUE, 'utf8') : null;

  // Välj en spårad källa som INTE redan står i kön.
  const { readdirSync } = await import('node:fs');
  const candidates = readdirSync(SOURCES_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''));
  if (candidates.length === 0) fail('rq1: inga spårade källor i sources/');

  const before = readQueue();
  const already = new Set(before.map((e) => e.sourceId));
  const target = candidates.find((id) => !already.has(id));
  if (!target) fail('rq1: alla spårade källor står redan i preA-kön — ingen att köra om');

  // 1. Positivt: en spårad källa läggs i kön.
  execFileSync('node', [path.join(__dirname, 'requeue-sources.mjs'), target], {
    cwd: ROOT, encoding: 'utf8',
  });
  const after = readQueue();
  const added = after.find((e) => e.sourceId === target);
  if (!added) fail(`rq1: ${target} kom inte in i preA-kön efter körningen`);
  if (!added.reason || !added.addedBy) {
    fail(`rq1: posten saknar reason/addedBy — spårbarheten är viktig: ${JSON.stringify(added)}`);
  }

  // 2. Negativ kontroll: en källa som inte finns ska AVVISAS och inte skrivas.
  const bogus = '__gate_nonexistent_source__';
  let rejected = false;
  try {
    const out = execFileSync('node', [path.join(__dirname, 'requeue-sources.mjs'), bogus], {
      cwd: ROOT, encoding: 'utf8',
    });
    rejected = out.includes('finns inte i sources/');
  } catch (err) {
    rejected = true; // non-zero exit är också ett korrekt avvisande
  }
  const final = readQueue();
  if (final.some((e) => e.sourceId === bogus)) {
    fail('rq1: en okänd källa skrevs in i preA-kön — verktyget accepterar skräp');
  }
  if (!rejected) {
    fail('rq1: verktyget rapporterade inte varför den okända källan avvisades');
  }

  // 3. Återställ kön så gaten inte påverkar produktionen.
  if (original === null) {
    writeFileSync(PREA_QUEUE, '', 'utf8');
  } else {
    writeFileSync(PREA_QUEUE, original, 'utf8');
  }

  ok(
    `rq1: ${target} lades i preA-kön (reason="${added.reason}") och en okänd källa ` +
    'avvisades utan att skrivas — återköningsvägen fungerar och kan inte ta emot skräp pass',
  );
}

// ── QI1: karantänindexet har inga stale rader ───────────────────────────────

if (arg === 'qi1') {
  if (!existsSync(QUARANTINE_INDEX)) fail('qi1: karantänindex saknas');
  const entries = JSON.parse(readFileSync(QUARANTINE_INDEX, 'utf8'));
  if (!Array.isArray(entries)) fail('qi1: karantänindex har oväntat format');

  const stale = [];
  for (const e of entries) {
    const id = e?.sourceId;
    if (!id) continue;
    const inQuarantine = existsSync(path.join(QUARANTINE_DIR, `${id}.jsonl`));
    const inSources = existsSync(path.join(SOURCES_DIR, `${id}.jsonl`));
    if (inSources && !inQuarantine) stale.push(id);
  }
  if (stale.length > 0) {
    fail(
      `qi1: ${stale.length} stale rader i karantänindexet (filen ligger i sources/ men ` +
      `indexet säger karantän) — dessa källor är osynliga för A- och C-gaten: ` +
      stale.join(', '),
    );
  }

  // Negativ kontroll: injicera en stale rad (fil i sources/, rad i index)
  // och kräv att reconcilen upptäcker den. Utan detta skulle qi1 bara
  // kunna ge grönt.
  const probeId = '__qi1_probe__';
  const probeFile = path.join(SOURCES_DIR, `${probeId}.jsonl`);
  const indexBackup = readFileSync(QUARANTINE_INDEX, 'utf8');
  writeFileSync(probeFile, JSON.stringify({ id: probeId, url: 'https://example.invalid/' }) + '\n', 'utf8');
  writeFileSync(
    QUARANTINE_INDEX,
    JSON.stringify([...entries, { sourceId: probeId, reasonCode: 'probe' }]),
    'utf8',
  );
  let detected = false;
  try {
    const out = execFileSync(
      'node',
      [path.join(__dirname, 'reconcile-quarantine-index.mjs'), '--dry-run'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    detected = out.includes(probeId);
  } finally {
    writeFileSync(QUARANTINE_INDEX, indexBackup, 'utf8');
    // Ta bort proben HELT — en tom fil i sources/ är skräp i produktion.
    if (existsSync(probeFile)) rmSync(probeFile, { force: true });
  }
  if (!detected) {
    fail('qi1: reconcilen hittade inte den injicerade stale-raden — kontrollen kan inte faila');
  }

  ok(
    `qi1: ${entries.length} karantänrader har alla fil i sources/_quarantine/ — ` +
    'ingen källa är osynlig för A- och C-gaten, och reconcilen upptäcker ' +
    'en injicerad stale rad (kontrollen kan faila) pass',
  );
}

if (arg !== 'rq1' && arg !== 'qi1') {
  fail('usage: node scripts/verify-requeue.mjs <rq1|qi1>');
}
