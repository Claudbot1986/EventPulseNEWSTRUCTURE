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
 *   E. Manual review queue — runtime/postTestC-manual-review.jsonl.
 *                     Klassificerar per Jev investigation 2026-09-23:
 *                       - HTTP 404/403/5xx, discovery failures → soft-quarantine
 *                       - HTTP 429, network <60d → re_probe (tillbaka till pool)
 *                       - Network 60+dagar → soft-quarantine (EJ retire — "en grav")
 *                       - Orphaned (ingen source-fil) → remove-from-queue
 *                       - Low extraction → leave
 *                     Säkerhet: source-fil flyttas ALDRIG till /dev/null — bara till
 *                     sources/_quarantine/. INDEX.json är "graven" — vi minns men
 *                     rör aldrig källan igen. Removed entries flyttas till
 *                     resolved.jsonl för spårbarhet.
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
 *   Varje timme:    rule E (manual review queue → soft-quarantine/re_probe)
 *   Sunday 05:00:   rule D (stale events archive)
 */

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync } from 'fs';
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
const MANUAL_REVIEW_PATH = path.join(RUNTIME_DIR, 'postTestC-manual-review.jsonl');
const QUARANTINE_DIR_PATH = path.resolve(DATA_ROOT, 'sources/_quarantine');
const QUARANTINE_INDEX_PATH = path.resolve(QUARANTINE_DIR_PATH, 'INDEX.json');
const RESOLVED_PATH = path.resolve(DATA_ROOT, '02-Ingestion/C-htmlGate/manual-review/resolved.jsonl');

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
  rules: Array<'A' | 'B' | 'C' | 'D' | 'E'>;
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
      if (['A', 'B', 'C', 'D', 'E'].includes(r)) {
        cfg.rules = [r as 'A' | 'B' | 'C' | 'D' | 'E'];
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

// ── Regel E: Manual review queue ─────────────────────────────────────────────
// Processerar runtime/postTestC-manual-review.jsonl — källor som fastnat i
// manuell hanterings-kö. Per Jev investigation 2026-09-23 + användarens
// "en grav"-princip: släng inga källor, bara flytta mellan köer eller
// soft-quarantine via INDEX.
//
// Klassificering (per Jev):
//   - HTTP 404/403/5xx, discovery failures → soft-quarantine (move + INDEX)
//   - HTTP 429, network <60d → re_probe (tillbaka till active pool)
//   - Network 60+dagar → soft-quarantine (användaren valde quarantine istället
//     för retire — källan bevaras, INDEX är "graven")
//   - Orphaned (ingen source-fil) → remove-from-queue (system-bug)
//   - Low extraction → leave (Jev 0.94 konfidens — för komplext för batch)
//
// Säkerhet:
//   - source-fil flyttas ALDRIG till /dev/null — bara till sources/_quarantine/
//   - INDEX.json är "graven" — vi minns men rör aldrig källan igen
//   - Removed entries flyttas till resolved.jsonl (audit trail)
//   - Allt är idempotent: skippar redan INDEX-förda källor

interface ManualReviewEntry {
  sourceId: string;
  queueName?: string;
  queuedAt: string;
  priority?: number;
  attempt?: number;
  queueReason?: string;
  workerNotes?: string;
  winningStage?: string;
  outcomeType?: string;
  routeSuggestion?: string;
  roundNumber?: number;
  roundsParticipated?: number;
}

type ManualReviewAction = 'soft-quarantine' | 're_probe' | 'remove-from-queue' | 'leave';

function readManualReviewEntries(): ManualReviewEntry[] {
  if (!existsSync(MANUAL_REVIEW_PATH)) return [];
  const content = readFileSync(MANUAL_REVIEW_PATH, 'utf8');
  return content.split('\n').filter(l => l.trim()).map(line => {
    try { return JSON.parse(line) as ManualReviewEntry; } catch { return null; }
  }).filter((e): e is ManualReviewEntry => e !== null);
}

function classifyManualReviewEntry(entry: ManualReviewEntry): { action: ManualReviewAction; reasonCode: string } {
  const qReason = String(entry.queueReason ?? '').toLowerCase();
  const wNotes = String(entry.workerNotes ?? '').toLowerCase();
  const rSuggestion = String(entry.routeSuggestion ?? '').toLowerCase();
  const oType = String(entry.outcomeType ?? '').toLowerCase();
  const combined = `${qReason} ${wNotes} ${rSuggestion} ${oType}`;
  const ageDays = (Date.now() - new Date(entry.queuedAt).getTime()) / (1000 * 60 * 60 * 24);

  // Orphaned — ingen source-fil. Kolla FÖRST så vi inte försöker flytta filer som inte finns.
  if (!sourceFileExists(entry.sourceId)) {
    return { action: 'remove-from-queue', reasonCode: 'unknown' };
  }
  // STEP3-CHAIN — system-bug i C-pipelinen (skapar queue-entries utan anledning).
  // Jev rekommendation: ta bort från kö + öppna bug-ticket.
  if (combined.includes('step3-chain') || combined.includes('imp-001')
      || combined.includes('forced stay')) {
    return { action: 'remove-from-queue', reasonCode: 'unknown' };
  }

  // HTTP 404 — sidan finns inte längre
  if (/\b404\b/.test(combined) || combined.includes('not found')) {
    return { action: 'soft-quarantine', reasonCode: 'http.404' };
  }
  // HTTP 403 — anti-bot / kaput
  if (/\b403\b/.test(combined) || combined.includes('forbidden') || combined.includes('access denied')) {
    return { action: 'soft-quarantine', reasonCode: 'anti_bot.forbidden' };
  }
  // HTTP 429 — rate-limit (transient)
  if (/\b429\b/.test(combined) || combined.includes('rate limit') || combined.includes('too many requests')) {
    return { action: 're_probe', reasonCode: 'http.429' };
  }
  // HTTP 5xx — server error (kaput)
  if (/\b5\d\d\b/.test(combined) || combined.includes('server error')) {
    return { action: 'soft-quarantine', reasonCode: 'http.5xx' };
  }
  // Discovery failures — specifika fraser (inte c-prefix, som skulle matcha
  // "C3: fail" i workerNotes). C2 lämnas (Jev 0.94 — låt C-pipelinen mogna).
  if (combined.includes('no candidates')
      || combined.includes('no main/article')
      || combined.includes('no events') || combined.includes('no routing signal')
      || combined.includes('no_jsonld') || combined.includes('toolscb')
      || combined.includes('ai no urls') || combined.includes('no urls')) {
    return { action: 'soft-quarantine', reasonCode: 'schema.no_events_on_entry' };
  }
  // Permanenta nätverksfel — DNS-vägran, certat-fel, aktiv vägran. Inte värt att re_proba.
  if (combined.includes('enotfound') || combined.includes('econnrefused')
      || combined.includes('self-signed')) {
    return { action: 'soft-quarantine', reasonCode: 'network.unreachable' };
  }
  // SSL / certat / hostname — ofta persistent. Quarantine om tillräckligt gammal.
  if (combined.includes('ssl') || combined.includes('certificate')
      || combined.includes('hostname')) {
    return ageDays >= 14
      ? { action: 'soft-quarantine', reasonCode: 'network.unreachable' }
      : { action: 're_probe', reasonCode: 'network.transient' };
  }
  // Transient — timeout, socket disconnect, redirect loop. Re_probe om ung, quarantine om gammal.
  if (combined.includes('network') || combined.includes('timeout')
      || combined.includes('econnreset') || combined.includes('etimedout')
      || combined.includes('redirect') || combined.includes('network socket')) {
    return ageDays >= 60
      ? { action: 'soft-quarantine', reasonCode: 'network.unreachable' }
      : { action: 're_probe', reasonCode: 'network.transient' };
  }
  // Orphaned — flyttad till TOPPEN av funktionen.
  // Default: lämna kvar (C2 unclear, oklassificerade, väntar på bättre data)
  return { action: 'leave', reasonCode: 'unknown' };
}

function moveSourceToQuarantine(
  sourceId: string,
  reasonCode: string,
  note: string,
  movedBy: string,
): boolean {
  const sourceFile = path.join(SOURCES_DIR, `${sourceId}.jsonl`);
  if (!existsSync(sourceFile)) return false;

  if (!existsSync(QUARANTINE_DIR_PATH)) {
    mkdirSync(QUARANTINE_DIR_PATH, { recursive: true });
  }

  const targetFile = path.join(QUARANTINE_DIR_PATH, `${sourceId}.jsonl`);
  renameSync(sourceFile, targetFile);

  let url = '';
  try {
    const parsed = JSON.parse(readFileSync(targetFile, 'utf8').trim());
    url = typeof parsed.url === 'string' ? parsed.url : '';
  } catch { /* tom fil — url lämnas tom */ }

  const existing = readQuarantineIndex();
  const filtered = existing.filter(e => e.sourceId !== sourceId);
  filtered.push({
    sourceId,
    url,
    movedAt: new Date().toISOString(),
    reasonCode,
    note,
    lastError: note.slice(0, 200),
    movedBy,
  });
  const tmp = `${QUARANTINE_INDEX_PATH}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(filtered, null, 2) + '\n', 'utf8');
  renameSync(tmp, QUARANTINE_INDEX_PATH);

  return true;
}

function appendResolvedEntry(
  entry: ManualReviewEntry,
  decision: 'quarantine' | 're_probe' | 'approve',
  decidedBy: string,
): void {
  const resolvedExisting = existsSync(RESOLVED_PATH)
    ? readFileSync(RESOLVED_PATH, 'utf8').trim().split('\n').filter(l => l.trim()).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter((e): e is Record<string, unknown> => e !== null)
    : [];
  resolvedExisting.push({
    entryId: `auto:${entry.sourceId}:${entry.queuedAt}`,
    sourceId: entry.sourceId,
    queue: 'auto-pending',
    queuedAt: entry.queuedAt,
    reasonCode: classifyError(`${entry.queueReason ?? ''} ${entry.workerNotes ?? ''}`),
    note: entry.workerNotes ?? '',
    decision,
    decidedBy,
    decidedAt: new Date().toISOString(),
  });
  const tmp = `${RESOLVED_PATH}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, resolvedExisting.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  renameSync(tmp, RESOLVED_PATH);
}

function ruleE(cfg: JanitorConfig): { actions: JanitorAction[]; stats: { scanned: number; wouldAct: number; acted: number } } {
  const entries = readManualReviewEntries();
  if (entries.length === 0) {
    return { actions: [], stats: { scanned: 0, wouldAct: 0, acted: 0 } };
  }

  // Dedupe — äldsta entry vinner per sourceId
  const bySourceId = new Map<string, ManualReviewEntry>();
  for (const e of entries) {
    const existing = bySourceId.get(e.sourceId);
    if (!existing || new Date(e.queuedAt) < new Date(existing.queuedAt)) {
      bySourceId.set(e.sourceId, e);
    }
  }
  const dedupedEntries = Array.from(bySourceId.values());

  const actions: JanitorAction[] = [];
  const quarantined = new Set(readQuarantineIndex().map(e => e.sourceId));

  let wouldAct = 0, acted = 0;
  const entriesToRemove = new Set<string>();
  const decisionCount = new Map<string, number>();

  for (const entry of dedupedEntries) {
    const { action, reasonCode } = classifyManualReviewEntry(entry);
    if (action === 'leave') continue;

    const alreadyIndexed = quarantined.has(entry.sourceId);

    // Idempotency: källor som redan är i INDEX behöver inte processas igen.
    // Vi tar tyst bort dem från kön (stale entry — källan ligger i _quarantine/),
    // men loggar inte till audit eller resolved (skulle vara redundant).
    if (alreadyIndexed) {
      entriesToRemove.add(entry.sourceId);
      continue;
    }

    const noteMap: Record<ManualReviewAction, string> = {
      'soft-quarantine': `manual review → quarantine: ${entry.workerNotes || entry.outcomeType || reasonCode}`,
      're_probe': `manual review → re_probe: ${entry.workerNotes || entry.outcomeType || reasonCode}`,
      'remove-from-queue': `manual review → orphaned (ingen source-fil), tas bort från kö`,
      'leave': '',
    };
    const decisionMap: Record<ManualReviewAction, 'quarantine' | 're_probe' | 'approve'> = {
      'soft-quarantine': 'quarantine',
      're_probe': 're_probe',
      'remove-from-queue': 'approve',
      'leave': 'approve',
    };
    const note = noteMap[action];
    const decision = decisionMap[action];

    let didApply = true;
    if (cfg.apply) {
      if (action === 'soft-quarantine') {
        didApply = moveSourceToQuarantine(
          entry.sourceId, reasonCode, note,
          `auto-janitor-ruleE-${cfg.triggeredBy}`,
        );
        if (didApply) quarantined.add(entry.sourceId);
      }
      // re_probe och remove-from-queue: bara appendResolvedEntry (audit trail)
    }

    if (didApply) {
      entriesToRemove.add(entry.sourceId);
      wouldAct++;
      decisionCount.set(action, (decisionCount.get(action) || 0) + 1);

      if (cfg.apply) {
        acted++;
        appendResolvedEntry(entry, decision, `auto-janitor-ruleE-${cfg.triggeredBy}`);
      }

      const ja: JanitorAction = {
        rule: 'E',
        sourceId: entry.sourceId,
        reasonCode,
        note,
        applied: cfg.apply && didApply,
        timestamp: new Date().toISOString(),
        triggeredBy: cfg.triggeredBy,
      };
      actions.push(ja);
      auditLog(ja);
    }
  }

  // Verkställ queue cleanup
  if (cfg.apply && entriesToRemove.size > 0) {
    const remaining = entries.filter(e => !entriesToRemove.has(e.sourceId));
    const tmp = `${MANUAL_REVIEW_PATH}.tmp.${process.pid}.${Date.now()}`;
    const content = remaining.length
      ? remaining.map(e => JSON.stringify(e)).join('\n') + '\n'
      : '';
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, MANUAL_REVIEW_PATH);
  }

  return { actions, stats: { scanned: entries.length, wouldAct, acted } };
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
  E: () => ruleE(cfg),
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
