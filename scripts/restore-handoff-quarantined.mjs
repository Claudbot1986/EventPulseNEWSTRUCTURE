#!/usr/bin/env node
/**
 * restore-handoff-quarantined.mjs — återställ källor som felaktigt
 * auto-karantänades för att de lämnades över till nästa gate.
 *
 * Bakgrund (2026-10-24). B-gaten skrev `success: false` UTAN error-sträng när
 * den lämnade över en källa till C-gaten. status-maskinen föll i generiska
 * felgrenen → consecutiveFailures++ → auto-quarantine vid 5. 56 källor
 * begravdes alltså innan C-gaten ens körde dem. Buggen är fixad i
 * `02-Ingestion/tools/sourceRegistry.ts` (handoff → status 'routed').
 *
 * Detta verktyg vänder på felet: det identifierar de rader som auto-
 * karantänades MED HANDOFF-SIGNATUR (`lastError` börjar med "postB-preC:")
 * och flyttar tillbaka deras filer, tar bort index-raden och nollställer
 * felräknaren (den räknade handoffs som fel — den siffran är inte sann).
 *
 * Källor som karantänades av en ÄKTA orsak (http.404, http.403, timeout …)
 * lämnas orörda — de är döda på riktigt.
 *
 * Användning:
 *   node scripts/restore-handoff-quarantined.mjs --dry-run
 *   node scripts/restore-handoff-quarantined.mjs --apply
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'sources');
const QUARANTINE_DIR = path.join(SOURCES_DIR, '_quarantine');
const QUARANTINE_INDEX = path.join(QUARANTINE_DIR, 'INDEX.json');
const STATUS_FILE = path.join(ROOT, 'runtime', 'sources_status.jsonl');

const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';

/**
 * Signaturen för handoff-felet: auto-quarantine (inte mänsklig karantän) +
 * ett felmeddelande från B-gatens kö-hop. B lämnade alltid över källan vidare
 * till C, så båda formerna är handoffs:
 *   "postB-preC: …"    — skriven av addToPostBPreCQueue (sista skrivningen)
 *   "toolB(preB): …"   — skriven av B-gatens egen statusrad
 */
function isHandoffBug(entry) {
  const note = String(entry?.note ?? '');
  const lastError = String(entry?.lastError ?? '');
  if (!note.startsWith('auto-quarantine:')) return false;
  return /^(postB-preC:|toolB\(preB\))/.test(lastError);
}

if (!existsSync(QUARANTINE_INDEX)) {
  console.error(`karantänindex saknas: ${QUARANTINE_INDEX}`);
  process.exit(1);
}

const entries = JSON.parse(readFileSync(QUARANTINE_INDEX, 'utf8'));
if (!Array.isArray(entries)) {
  console.error('karantänindex har oväntat format (förväntas en array)');
  process.exit(1);
}

const buggy = entries.filter(isHandoffBug);
const genuine = entries.filter((e) => !isHandoffBug(e));

console.log(`INDEX: ${entries.length} rader — ${buggy.length} med handoff-signatur, ${genuine.length} ärliga karantäner\n`);

if (buggy.length === 0) {
  console.log('Inget att återställa.');
  process.exit(0);
}

for (const e of buggy) {
  const inQuarantine = existsSync(path.join(QUARANTINE_DIR, `${e.sourceId}.jsonl`));
  console.log(
    `  ${String(e.sourceId).padEnd(38)} ${inQuarantine ? 'fil i karantän' : 'FIL SAKNAS — hoppas över'}` +
    `  ${String(e.lastError ?? '').slice(0, 60)}`,
  );
}

if (mode === 'dry-run') {
  console.log('\n[DRY-RUN] inget skrivet. Kör med --apply för att återställa.');
  process.exit(0);
}

// ── Återställ filer + index ────────────────────────────────────────────────
const restored = [];
const skipped = [];

for (const e of buggy) {
  const from = path.join(QUARANTINE_DIR, `${e.sourceId}.jsonl`);
  const to = path.join(SOURCES_DIR, `${e.sourceId}.jsonl`);
  if (!existsSync(from)) {
    skipped.push([e.sourceId, 'filen finns inte i karantän']);
    continue;
  }
  if (existsSync(to)) {
    skipped.push([e.sourceId, 'filen finns redan i sources/']);
    continue;
  }
  try {
    renameSync(from, to);
    restored.push(e.sourceId);
  } catch (err) {
    skipped.push([e.sourceId, `kunde inte flytta: ${err instanceof Error ? err.message : err}`]);
  }
}

// Skriv indexet om utan de återställda raderna.
const kept = entries.filter((e) => !restored.includes(e.sourceId));
const tmpIndex = `${QUARANTINE_INDEX}.tmp.${process.pid}`;
writeFileSync(tmpIndex, JSON.stringify(kept, null, 2) + '\n', 'utf8');
renameSync(tmpIndex, QUARANTINE_INDEX);

// ── Nollställ felräknaren för de återställda källorna ──────────────────────
// consecutiveFailures räknade handoffs som fel — siffran är inte sann.
if (existsSync(STATUS_FILE) && restored.length > 0) {
  const restoredSet = new Set(restored);
  const lines = readFileSync(STATUS_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean)
    .map((row) => {
      if (!restoredSet.has(row.sourceId)) return row;
      return {
        ...row,
        status: 'routed',
        ingestionStage: 'pending',
        consecutiveFailures: 0,
        lastError: undefined,
        pendingNextTool: 'C-htmlGate',
        lastRoutingReason: 'återställd från karantän (handoff-fel 2026-10-24)',
        lastRoutingSource: 'runtime_status',
      };
    });
  writeFileSync(STATUS_FILE, lines.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

console.log(`\nÅterställda ${restored.length} källor (fil + index + felräknare nollställd).`);
if (skipped.length > 0) {
  console.log(`\n${skipped.length} hoppades över:`);
  for (const [id, why] of skipped) console.log(`  - ${id}: ${why}`);
}
console.log(`\nÄrliga karantäner kvar: ${genuine.length} (dessa rördes inte).`);
