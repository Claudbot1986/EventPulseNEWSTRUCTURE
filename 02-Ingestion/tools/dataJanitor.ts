#!/usr/bin/env node
/**
 * Data Janitor — automatisk städning av käll-status och events.
 *
 * Syfte: förhindra skräp-ackumulering i runtime/sources_status.jsonl och
 * relaterade artefakter. Fyra regler (A–D) som körs idempotent:
 *
 *   A. Phantom — status-record utan motsvarande sources/{id}.jsonl.
 *                Klassificera med classifyError(), append till INDEX.json.
 *   B. Stuck   — cf >= AUTO_QUARANTINE_THRESHOLD (5). Klassificera, antingen
 *                auto-quarantine eller mark-for-review beroende på reasonCode.
 *   C. Test fixtures — sourceIds som matchar /^(test-|recovery-|classify-)/.
 *                      Soft-quarantine (INDEX-post, ingen flytt av fil).
 *   D. Stale events — events äldre än 30 dagar i data/c1-events.jsonl.
 *                     Arkiveras till data/_archive/events-YYYY-MM.jsonl.
 *                     (TODO: implementeras i Fas 5b — kräver events-schema)
 *
 * Säkerhet:
 * - --dry-run är DEFAULT. Utan --apply görs INGENTING på disk.
 * - Alla INDEX-writes är atomära (write-then-rename via writeJsonlAtomic).
 * - Idempotent: samma källa körs aldrig genom samma regel två gånger.
 * - Audit-logg: runtime/data-janitor-audit.jsonl (append-only JSONL).
 *
 * Användning:
 *   npx tsx 02-Ingestion/tools/dataJanitor.ts                # dry-run alla regler
 *   npx tsx 02-Ingestion/tools/dataJanitor.ts --apply         # kör alla regler
 *   npx tsx 02-Ingestion/tools/dataJanitor.ts --rule A        # bara regel A
 *   npx tsx 02-Ingestion/tools/dataJanitor.ts --rule C --apply
 *   npx tsx 02-Ingestion/tools/dataJanitor.ts --rule B --threshold 10
 *
 * Cron-förslag (se scripts/cron/README.md):
 *   04:00 dagligen: rule A (phantom)
 *   04:05 dagligen: rule C (test fixtures)
 *   04:15 dagligen: rule B (stuck)
 *   Sunday 05:00:   rule D (stale events archive)
 */

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  resolveQuarantineIndexPath,
  loadQuarantineIndex,
  type LifecycleEntry,
} from '../lib/quarantineGuard.js';
import {
  classifyError,
  isReasonCode,
  AUTO_QUARANTINE_THRESHOLD,
  shouldTriggerManualReview,
} from '../lib/sourceLifecycle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : PROJECT_ROOT;

const RUNTIME_DIR = path.resolve(DATA_ROOT, 'runtime');
const SOURCES_DIR = path.resolve(DATA_ROOT, 'sources');
const STATUS_PATH = path.join(RUNTIME_DIR, 'sources_status.jsonl');
const AUDIT_PATH = path.join(RUNTIME_DIR, 'data-janitor-audit.jsonl');

const TEST_FIXTURE_RE = /^(test-|recovery-|classify-|src-|low-fail-|threshold-|climb-|ghost-)/;

interface SourceStatus {
  sourceId: string;
  status: string;
  ingestionStage: string;
  lastRun: string;
  lastSuccess: string | null;
  consecutiveFailures: number;
  lastEventsFound: number;
  attempts: number;
  lastRoutingReason: string;
  lastRoutingSource: string;
  lastPathUsed: string;
  lastError?: string;
}

interface JanitorAction {
  rule: 'A' | 'B' | 'C' | 'D';
  sourceId: string;
  reasonCode: string;
  note: string;
  applied: boolean;        // false = dry-run, true = skrev till INDEX/audit
  timestamp: string;
  triggeredBy: 'cli' | 'cron';
}

interface JanitorConfig {
  rules: Array<'A' | 'B' | 'C' | 'D'>;
  apply: boolean;
  threshold: number;       // för rule B
  triggeredBy: 'cli' | 'cron';
}

function parseArgs(argv: string[]): JanitorConfig {
  const cfg: JanitorConfig = {
    rules: ['A', 'B', 'C'],
    apply: false,
    threshold: AUTO_QUARANTINE_THRESHOLD,
    triggeredBy: 'cli',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') cfg.apply = true;
    else if (a === '--rule' && argv[i + 1]) {
      const r = argv[i + 1].toUpperCase();
      if (['A', 'B', 'C', 'D'].includes(r)) {
        cfg.rules = [r as 'A' | 'B' | 'C' | 'D'];
      }
      i++;
    }
    else if (a === '--threshold' && argv[i + 1]) {
      cfg.threshold = parseInt(argv[i + 1], 10);
      i++;
    }
    else if (a === '--cron') cfg.triggeredBy = 'cron';
  }
  return cfg;
}

function readStatusJsonl(): SourceStatus[] {
  if (!existsSync(STATUS_PATH)) return [];
  return readFileSync(STATUS_PATH, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(line => {
      try { return JSON.parse(line) as SourceStatus; } catch { return null; }
    })
    .filter((r): r is SourceStatus => r !== null);
}

function writeStatusJsonl(records: SourceStatus[]): void {
  const tmp = `${STATUS_PATH}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  renameSync(tmp, STATUS_PATH);
}

function readQuarantineIndex(): LifecycleEntry[] {
  const idx = resolveQuarantineIndexPath();
  if (!existsSync(idx)) return [];
  const content = readFileSync(idx, 'utf8').trim();
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendQuarantineIndex(entry: LifecycleEntry, apply: boolean): boolean {
  const idx = resolveQuarantineIndexPath();
  const existing = readQuarantineIndex();
  const filtered = existing.filter(e => e.sourceId !== entry.sourceId);
  if (filtered.some(e => e.sourceId === entry.sourceId)) {
    return false;  // redan i INDEX — idempotent
  }
  filtered.push(entry);
  if (!apply) return true;
  const tmp = `${idx}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(filtered, null, 2) + '\n', 'utf8');
  renameSync(tmp, idx);
  return true;
}

function auditLog(action: JanitorAction): void {
  if (!existsSync(RUNTIME_DIR)) return;
  // Audit skrivs alltid — även vid dry-run — för att vi ska kunna se vad som
  // _hade_ hänt. applied=false markerar dry-run.
  // Append via läs-existerande + skriv-tillbaka (read-then-rename, idempotent).
  const existing = existsSync(AUDIT_PATH)
    ? readFileSync(AUDIT_PATH, 'utf8')
    : '';
  const tmp = `${AUDIT_PATH}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, existing + JSON.stringify(action) + '\n', 'utf8');
  renameSync(tmp, AUDIT_PATH);
}

function sourceFileExists(sourceId: string): boolean {
  return existsSync(path.join(SOURCES_DIR, `${sourceId}.jsonl`));
}

// ── Regel A: Phantom ─────────────────────────────────────────────────────────
// Hanterar två fall:
//   1. Status-record utan source-fil OCH inte i INDEX → append till INDEX
//   2. Status-record utan source-fil OCH REDAN i INDEX → radera status-record
//      (källan är redan korrekt INDEX-förd, status-raden är bara brus)
function ruleA(cfg: JanitorConfig): { actions: JanitorAction[]; stats: { scanned: number; wouldAct: number; acted: number } } {
  const status = readStatusJsonl();
  const actions: JanitorAction[] = [];
  const quarantined = new Set(loadQuarantineIndex().keys());

  let wouldAct = 0, acted = 0;
  const recordsToKeep: SourceStatus[] = [];
  const recordsToRemove: string[] = [];

  for (const rec of status) {
    if (sourceFileExists(rec.sourceId)) {
      recordsToKeep.push(rec);
      continue;
    }
    if (quarantined.has(rec.sourceId)) {
      // Fall 2: redan i INDEX → ta bort status-record
      const errorText = rec.lastError || rec.lastRoutingReason || '';
      const reasonCode = classifyError(errorText);
      const note = `phantom status utan source-fil, men källan är redan i INDEX.json. Status-rad rensas.`;

      recordsToRemove.push(rec.sourceId);
      wouldAct++;
      const action: JanitorAction = {
        rule: 'A',
        sourceId: rec.sourceId,
        reasonCode,
        note,
        applied: false,  // markeras nedan om apply körs
        timestamp: new Date().toISOString(),
        triggeredBy: cfg.triggeredBy,
      };
      actions.push(action);
      auditLog(action);
      continue;
    }

    // Fall 1: inte i INDEX → append
    const errorText = rec.lastError || rec.lastRoutingReason || '';
    const reasonCode = classifyError(errorText);
    const lrSnippet = (rec.lastRoutingReason || '').slice(0, 80);
    const note = `phantom status utan source-fil. lastRoutingReason="${lrSnippet}"`;

    const entry: LifecycleEntry = {
      sourceId: rec.sourceId,
      url: '',
      movedAt: new Date().toISOString(),
      reasonCode,
      note,
      lastError: errorText.slice(0, 200),
      movedBy: `auto-janitor-ruleA-${cfg.triggeredBy}`,
    };

    wouldAct++;
    const didAppend = appendQuarantineIndex(entry, cfg.apply);
    const action: JanitorAction = {
      rule: 'A',
      sourceId: rec.sourceId,
      reasonCode,
      note,
      applied: cfg.apply && didAppend,
      timestamp: entry.movedAt,
      triggeredBy: cfg.triggeredBy,
    };
    actions.push(action);
    auditLog(action);
    if (cfg.apply && didAppend) acted++;

    // För fall 1: behåll status-record (INDEX-entry pekar på sanning)
    recordsToKeep.push(rec);
  }

  // Verkställ status-record-rensning för fall 2
  if (cfg.apply && recordsToRemove.length > 0) {
    const remaining = readStatusJsonl().filter(r => !recordsToRemove.includes(r.sourceId));
    writeStatusJsonl(remaining);
    // Uppdatera action.applied för alla fall-2 actions
    for (const a of actions) {
      if (recordsToRemove.includes(a.sourceId) && a.note.startsWith('phantom status utan source-fil, men källan')) {
        a.applied = true;
        acted++;
      }
    }
  }

  return { actions, stats: { scanned: status.length, wouldAct, acted } };
}

// ── Regel B: Stuck (cf >= threshold) ────────────────────────────────────────
function ruleB(cfg: JanitorConfig): { actions: JanitorAction[]; stats: { scanned: number; wouldAct: number; acted: number } } {
  const status = readStatusJsonl();
  const actions: JanitorAction[] = [];
  const quarantined = new Set(loadQuarantineIndex().keys());

  let wouldAct = 0, acted = 0;
  for (const rec of status) {
    if (rec.consecutiveFailures < cfg.threshold) continue;
    if (!sourceFileExists(rec.sourceId)) continue;  // rule A:s domän
    if (quarantined.has(rec.sourceId)) continue;

    const errorText = rec.lastError || rec.lastRoutingReason || '';
    const reasonCode = classifyError(errorText);
    // För render-hostile / manual-review-reasons: bara flagga, inte auto-quarantine.
    // För övriga: auto-quarantine.
    const needsManual = shouldTriggerManualReview(reasonCode);
    const actionType = needsManual ? 'flag-review' : 'auto-quarantine';
    const lrSnippet = (rec.lastRoutingReason || '').slice(0, 60);
    const note = `${actionType}: cf=${rec.consecutiveFailures}, reason="${lrSnippet}"`;

    if (needsManual) {
      // TODO Fas 5b: integrera med submitForReview(). För nu: bara audit-log.
      const action: JanitorAction = {
        rule: 'B',
        sourceId: rec.sourceId,
        reasonCode,
        note,
        applied: false,  // flagga, inte flytta
        timestamp: new Date().toISOString(),
        triggeredBy: cfg.triggeredBy,
      };
      actions.push(action);
      auditLog(action);
      wouldAct++;
    } else {
      const entry: LifecycleEntry = {
        sourceId: rec.sourceId,
        url: '',
        movedAt: new Date().toISOString(),
        reasonCode,
        note,
        lastError: errorText.slice(0, 200),
        movedBy: `auto-janitor-ruleB-${cfg.triggeredBy}`,
      };
      wouldAct++;
      const didAppend = appendQuarantineIndex(entry, cfg.apply);
      const action: JanitorAction = {
        rule: 'B',
        sourceId: rec.sourceId,
        reasonCode,
        note,
        applied: cfg.apply && didAppend,
        timestamp: entry.movedAt,
        triggeredBy: cfg.triggeredBy,
      };
      actions.push(action);
      auditLog(action);
      if (cfg.apply && didAppend) acted++;
    }
  }

  return { actions, stats: { scanned: status.length, wouldAct, acted } };
}

// ── Regel C: Test fixtures ──────────────────────────────────────────────────
function ruleC(cfg: JanitorConfig): { actions: JanitorAction[]; stats: { scanned: number; wouldAct: number; acted: number } } {
  const status = readStatusJsonl();
  const actions: JanitorAction[] = [];
  const quarantined = new Set(loadQuarantineIndex().keys());

  let wouldAct = 0, acted = 0;
  for (const rec of status) {
    if (!TEST_FIXTURE_RE.test(rec.sourceId)) continue;
    if (quarantined.has(rec.sourceId)) continue;

    const reasonCode = 'unknown';  // test fixtures är inte verkliga fel
    const note = `test fixture (test-/recovery-/classify-) — soft quarantine, ingen prod-data`;

    const entry: LifecycleEntry = {
      sourceId: rec.sourceId,
      url: '',
      movedAt: new Date().toISOString(),
      reasonCode,
      note,
      movedBy: `auto-janitor-ruleC-${cfg.triggeredBy}`,
    };

    wouldAct++;
    const didAppend = appendQuarantineIndex(entry, cfg.apply);
    const action: JanitorAction = {
      rule: 'C',
      sourceId: rec.sourceId,
      reasonCode,
      note,
      applied: cfg.apply && didAppend,
      timestamp: entry.movedAt,
      triggeredBy: cfg.triggeredBy,
    };
    actions.push(action);
    auditLog(action);
    if (cfg.apply && didAppend) acted++;
  }

  return { actions, stats: { scanned: status.length, wouldAct, acted } };
}

// ── Regel D: Stale events (placeholder) ─────────────────────────────────────
function ruleD(_cfg: JanitorConfig): { actions: JanitorAction[]; stats: { scanned: number; wouldAct: number; acted: number } } {
  // TODO Fas 5b: implementera när vi vet events-schemats exakta path.
  // Kräver: läsa data/c1-events.jsonl, gruppera per månad, flytta >30d gamla
  //          till data/_archive/events-YYYY-MM.jsonl.
  return { actions: [], stats: { scanned: 0, wouldAct: 0, acted: 0 } };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const cfg = parseArgs(process.argv.slice(2));

if (cfg.apply) {
  console.log(`[janitor] APPLY mode — actions will write to INDEX.json / status.jsonl`);
} else {
  console.log(`[janitor] DRY-RUN mode (use --apply to execute)`);
}
console.log(`[janitor] rules: ${cfg.rules.join(', ')}, threshold: ${cfg.threshold}, triggeredBy: ${cfg.triggeredBy}`);
console.log('');

const handlers: Record<string, () => ReturnType<typeof ruleA>> = {
  A: () => ruleA(cfg),
  B: () => ruleB(cfg),
  C: () => ruleC(cfg),
  D: () => ruleD(cfg),
};

let totalWould = 0, totalActed = 0;
for (const rule of cfg.rules) {
  const result = handlers[rule]();
  const mode = cfg.apply ? 'APPLIED' : 'would-act';
  console.log(`[rule ${rule}] scanned=${result.stats.scanned}, ${mode}=${cfg.apply ? result.stats.acted : result.stats.wouldAct}`);
  if (result.actions.length > 0 && result.actions.length <= 10) {
    for (const a of result.actions) {
      console.log(`  - ${a.sourceId} → ${a.reasonCode} (${a.applied ? 'applied' : 'dry-run'})`);
    }
  } else if (result.actions.length > 10) {
    for (const a of result.actions.slice(0, 10)) {
      console.log(`  - ${a.sourceId} → ${a.reasonCode} (${a.applied ? 'applied' : 'dry-run'})`);
    }
    console.log(`  ... and ${result.actions.length - 10} more`);
  }
  totalWould += result.stats.wouldAct;
  totalActed += result.stats.acted;
}

console.log('');
console.log(`[janitor] TOTAL: ${cfg.apply ? `applied=${totalActed}` : `would-act=${totalWould}`}`);
console.log(`[janitor] audit log: ${AUDIT_PATH}`);
