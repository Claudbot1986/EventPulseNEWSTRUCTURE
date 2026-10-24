#!/usr/bin/env node
/**
 * requeue-sources.mjs — kör om spårade källor genom den RIKTIGA
 * ingestion-pipelinen.
 *
 * Bakgrund (2026-10-24). A-gatens filter är `status === 'never_run'`
 * (02-Ingestion/A-directAPI-networkGate/runA.ts:270). 289 spårade källor
 * står på `fail` — de körs aldrig igen, oavsett vad orsaken till felet var.
 * Det gör orsaksutredning omöjlig: en fix kan inte provas på en källa som
 * aldrig går igenom kedjan igen.
 *
 * Verktyget skriver sourceIds till `runtime/preA-queue.jsonl` — den
 * befintliga ingången som A-gaten läser med högst prioritet. Därifrån går
 * den vanliga vägen: A → B → C → D → importToEventPulse → drainQueue →
 * normalizer → Supabase. Ingen extraktion simuleras; detta är bara en
 * kö-inmatning.
 *
 * Användning:
 *   node scripts/requeue-sources.mjs --list
 *   node scripts/requeue-sources.mjs <id> [<id> ...]
 *   node scripts/requeue-sources.mjs --fail-all          # alla fail-källor
 *   node scripts/requeue-sources.mjs --fail-all --dry-run
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'sources');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const PREA_QUEUE = path.join(RUNTIME_DIR, 'preA-queue.jsonl');
const STATUS_FILE = path.join(RUNTIME_DIR, 'sources_status.jsonl');
const RETIRED_INDEX = path.join(SOURCES_DIR, '_retired', 'INDEX.json');
const QUARANTINE_INDEX = path.join(SOURCES_DIR, '_quarantine', 'INDEX.json');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const wantList = argv.includes('--list');
const wantAll = argv.includes('--fail-all');
const explicit = argv.filter((a) => !a.startsWith('--'));

if (argv.length === 0) {
  console.error('usage: node scripts/requeue-sources.mjs [--list] [--fail-all] [--dry-run] [sourceId ...]');
  process.exit(1);
}

/** Källa som redan ligger i preA-kön. */
function readQueue() {
  if (!existsSync(PREA_QUEUE)) return [];
  return readFileSync(PREA_QUEUE, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

/** Senaste statusrad per källa. */
function readStatuses() {
  const last = new Map();
  if (!existsSync(STATUS_FILE)) return last;
  for (const line of readFileSync(STATUS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.sourceId) last.set(d.sourceId, d);
    } catch { /* trasig rad hoppas över */ }
  }
  return last;
}

/** Spårade källor (sources/*.jsonl på toppnivå — inte _retired/_quarantine). */
function readTracked() {
  const out = new Map();
  for (const f of readdirSync(SOURCES_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const id = f.replace(/\.jsonl$/, '');
    try {
      const content = readFileSync(path.join(SOURCES_DIR, f), 'utf8').trim();
      if (!content) continue;
      // sources/ innehåller BÅDA radavgränsad JSON och pretty-printed JSON
      // (updateSourceUrl skriver pretty-printed). Hela filen först, sedan
      // radvis — samma ordning som sourceRegistry.ts.
      let d = null;
      try { d = JSON.parse(content); } catch { /* radvis nedan */ }
      if (!d) {
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try { d = JSON.parse(line); } catch { continue; }
          if (d) break;
        }
      }
      if (d && typeof d.url === 'string' && d.url.startsWith('http')) out.set(id, d);
    } catch { /* trasig fil hoppas över */ }
  }
  return out;
}

function readIndex(file) {
  const map = new Map();
  if (!existsSync(file)) return map;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.sources ?? []);
    for (const e of entries) {
      const id = typeof e === 'string' ? e : e.sourceId ?? e.id;
      if (id) map.set(id, e);
    }
  } catch { /* trasig index hoppas över */ }
  return map;
}

const queue = readQueue();
const queuedIds = new Set(queue.map((e) => e.sourceId));
const statuses = readStatuses();
const tracked = readTracked();
const retired = readIndex(RETIRED_INDEX);
const quarantined = readIndex(QUARANTINE_INDEX);

if (wantList) {
  console.log(`preA-queue: ${queue.length} rader\n`);
  for (const e of queue) {
    console.log(`  ${String(e.sourceId).padEnd(40)} ${e.addedBy ?? '?'}  ${e.reason ?? ''}`);
  }
  process.exit(0);
}

let targets = [];
if (wantAll) {
  for (const [id] of tracked) {
    const st = statuses.get(id);
    if (st && st.status === 'fail') targets.push(id);
  }
} else {
  targets = explicit;
}

if (targets.length === 0) {
  console.log('Inget att köra om.');
  process.exit(0);
}

const accepted = [];
const rejected = [];

for (const id of targets) {
  if (!tracked.has(id)) {
    rejected.push([id, 'finns inte i sources/ (begravd, karantän eller okänd)']);
    continue;
  }
  if (retired.has(id)) {
    rejected.push([id, 'begravd']);
    continue;
  }
  if (quarantined.has(id)) {
    rejected.push([id, 'karantän']);
    continue;
  }
  if (queuedIds.has(id)) {
    rejected.push([id, 'redan i preA-kön']);
    continue;
  }
  accepted.push(id);
}

const addedBy = process.env.USER || 'operator';
const reason = process.env.REQUEUE_REASON || 'manual requeue (orsaksutredning 2026-10-24)';
const now = new Date().toISOString();

if (accepted.length > 0 && !dryRun) {
  const lines = [
    ...queue.map((e) => JSON.stringify(e)),
    ...accepted.map((id) => JSON.stringify({ sourceId: id, addedAt: now, addedBy, reason, attempts: 0 })),
  ];
  writeFileSync(PREA_QUEUE, lines.join('\n') + '\n', 'utf8');
}

console.log(`${dryRun ? '[DRY-RUN] ' : ''}${accepted.length} källa/källor köas om genom A→B→C→D→import→drain`);
for (const id of accepted) console.log(`  + ${id}`);
if (rejected.length > 0) {
  console.log(`\n${rejected.length} hoppades över:`);
  for (const [id, why] of rejected) console.log(`  - ${id}: ${why}`);
}
