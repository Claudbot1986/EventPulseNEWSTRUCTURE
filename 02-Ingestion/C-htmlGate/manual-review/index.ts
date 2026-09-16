/**
 * Manual Review Queue — central konsument för båda manuella handläggnings-köerna.
 *
 * Två köer, samma konsument-API:
 *
 * 1. CLI-pending:    02-Ingestion/C-htmlGate/manual-review/pending.jsonl
 *    - Skapas av lifecycle-admin.ts markForReview
 *    - Skapas av supervisor-dashboard "Submit for review"
 *
 * 2. Auto-pending:   runtime/postTestC-manual-review.jsonl (befintlig)
 *    - Skapas av C-pipelinen (run-dynamic-pool.ts)
 *    - Triggas nu också av ReasonCode: low_confidence_jsonld, anti_bot.*, etc.
 *
 * Båda konsumeras av samma resolvePending() — beslut är uniformt:
 *   approve     → tillbaka till active-pool, status='probing'
 *   quarantine  → flytta källfil, INDEX+=1
 *   retire      → flytta källfil, INDEX+=1
 *   re_probe    → tvinga ny A→B→C-körning (utan D)
 *
 * Resolved-beslut hamnar i resolved.jsonl — spårbart, aldrig raderat.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ReasonCode } from '../../lib/sourceLifecycle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../../');

/**
 * Resolver för sandbox-stöd. Modulens konstanter ovan fångas vid import, men
 * vi vill kunna overrid:a via EVENTPULSE_SANDBOX_ROOT vid varje anrop.
 * Read-paths går via *_RESOLVED(); write-paths (move/rename) går via
 * resolveSourceDir() / resolveIndexPath() för att garantera atomicitet
 * inom samma volym.
 */
function resolveDataRoot(): string {
  return process.env.EVENTPULSE_SANDBOX_ROOT
    ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
    : PROJECT_ROOT;
}

function resolveManualReviewDir(): string {
  return path.resolve(resolveDataRoot(), '02-Ingestion/C-htmlGate/manual-review');
}
function resolveRuntimeDir(): string {
  return path.resolve(resolveDataRoot(), 'runtime');
}
function resolveSourcesDir(): string {
  return path.resolve(resolveDataRoot(), 'sources');
}
function resolveQuarantineIndex(): string {
  return path.join(resolveDataRoot(), 'sources/_quarantine/INDEX.json');
}
function resolveRetiredIndex(): string {
  return path.join(resolveDataRoot(), 'sources/_retired/INDEX.json');
}

export const PENDING_FILE = path.resolve(resolveManualReviewDir(), 'pending.jsonl');
export const RESOLVED_FILE = path.resolve(resolveManualReviewDir(), 'resolved.jsonl');
export const AUTO_PENDING_FILE = path.resolve(resolveRuntimeDir(), 'postTestC-manual-review.jsonl');

const PENDING_FILE_RESOLVED = () => path.join(resolveManualReviewDir(), 'pending.jsonl');
const RESOLVED_FILE_RESOLVED = () => path.join(resolveManualReviewDir(), 'resolved.jsonl');
const AUTO_PENDING_FILE_RESOLVED = () => path.join(resolveRuntimeDir(), 'postTestC-manual-review.jsonl');

export type ReviewDecision = 'approve' | 'quarantine' | 'retire' | 're_probe';

export interface PendingEntry {
  entryId: string;             // stable id (t.ex. `${sourceId}:${timestamp}`)
  sourceId: string;
  queue: 'cli-pending' | 'auto-pending';
  queuedAt: string;            // ISO
  reasonCode: ReasonCode | string;
  note: string;
  // Valfri kontext från auto-kön (C-pipeline)
  payload?: Record<string, unknown>;
}

export interface ResolvedEntry extends PendingEntry {
  decision: ReviewDecision;
  decidedBy: string;           // 'auto' eller användarnamn
  decidedAt: string;           // ISO
  decisionNote?: string;
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    // Stödjer både JSON-array (INDEX-filer) och JSONL (pending/resolved/AUTO_PENDING)
    if (content.startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        return [];
      }
    }
    return content.split('\n').filter(l => l.trim()).map(line => {
      try { return JSON.parse(line) as T; } catch { return null; }
    }).filter((e): e is T => e !== null);
  } catch {
    return [];
  }
}

/**
 * Atomär write: skriv till tmp-fil, sedan rename. Förhindrar korrupt
 * fil vid server-nede / SIGKILL mitt i skrivning.
 */
function writeJsonlAtomic(filePath: string, rows: unknown[]): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  // INDEX-filer skrivs som JSON-array; JSONL-filer som en-rad-per-entry.
  const isIndexFile = filePath.endsWith('INDEX.json');
  const content = isIndexFile
    ? JSON.stringify(rows, null, 2) + '\n'
    : rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, filePath);
}

/**
 * Lista alla pending entries från båda köerna (CLI-pending + auto-pending).
 * Auto-pending raderna märks med queue='auto-pending'.
 *
 * @param projectRoot Valfri root att läsa ifrån (för tester / sandbox). Om
 *                   utelämnad används DATA_ROOT från EVENTPULSE_SANDBOX_ROOT
 *                   eller PROJECT_ROOT.
 */
export function listPending(projectRoot?: string): PendingEntry[] {
  const cliPath = projectRoot
    ? path.join(projectRoot, '02-Ingestion/C-htmlGate/manual-review/pending.jsonl')
    : PENDING_FILE_RESOLVED();
  const autoPath = projectRoot
    ? path.join(projectRoot, 'runtime/postTestC-manual-review.jsonl')
    : AUTO_PENDING_FILE_RESOLVED();

  const cliPending = readJsonl<PendingEntry>(cliPath).map(e => ({ ...e, queue: 'cli-pending' as const }));
  const autoRaw = readJsonl<Record<string, unknown>>(autoPath);

  // Mappa auto-köns shape (kan variera över tid) till PendingEntry
  const autoPending: PendingEntry[] = autoRaw.map((row, idx) => {
    const sourceId = String(row.sourceId ?? `unknown-${idx}`);
    return {
      entryId: `auto:${sourceId}:${row.queuedAt ?? idx}`,
      sourceId,
      queue: 'auto-pending' as const,
      queuedAt: String(row.queuedAt ?? new Date(0).toISOString()),
      reasonCode: String(row.queueReason ?? row.failCategory ?? 'unknown'),
      note: String(row.workerNotes ?? row.outcomeType ?? ''),
      payload: row,
    };
  });

  // CLI-pending visas först (de är manuellt flaggade och viktigare)
  return [...cliPending, ...autoPending];
}

/**
 * Lista resolved entries (historik).
 */
export function listResolved(): ResolvedEntry[] {
  return readJsonl<ResolvedEntry>(RESOLVED_FILE_RESOLVED());
}

/**
 * Flytta en källa till en målmap och uppdatera motsvarande INDEX.
 * Används av resolvePending('quarantine' | 'retire').
 */
function moveToLifecycleBucket(
  sourceId: string,
  bucket: 'quarantined' | 'retired',
  reasonCode: string,
  note: string,
  lastError?: string,
  projectRoot?: string,
): { ok: boolean; error?: string } {
  const sourcesDir = projectRoot
    ? path.join(projectRoot, 'sources')
    : resolveSourcesDir();
  const sourceFile = path.join(sourcesDir, `${sourceId}.jsonl`);
  if (!existsSync(sourceFile)) {
    return { ok: false, error: `source file not found: ${sourceFile}` };
  }

  const dataRoot = projectRoot ?? resolveDataRoot();
  const targetDir = bucket === 'quarantined'
    ? path.join(dataRoot, 'sources/_quarantine')
    : path.join(dataRoot, 'sources/_retired');
  const targetFile = path.join(targetDir, `${sourceId}.jsonl`);

  // Läs URL från source-filen innan flytt
  let url = '';
  try {
    const parsed = JSON.parse(readFileSync(sourceFile, 'utf8'));
    if (typeof parsed.url === 'string') url = parsed.url;
  } catch { /* tom fil eller ogiltig JSON — url lämnas tom */ }

  // Flytta filen (rename inom samma volym är atomärt)
  renameSync(sourceFile, targetFile);

  // Uppdatera INDEX atomärt
  const indexPath = bucket === 'quarantined'
    ? path.join(dataRoot, 'sources/_quarantine/INDEX.json')
    : path.join(dataRoot, 'sources/_retired/INDEX.json');
  const existing = readJsonl<Record<string, unknown>>(indexPath);
  // Ta bort eventuell dubblett
  const filtered = existing.filter(e => e?.sourceId !== sourceId);
  filtered.push({
    sourceId,
    url,
    movedAt: new Date().toISOString(),
    reasonCode,
    note,
    lastError,
    movedBy: 'manual',
  });
  writeJsonlAtomic(indexPath, filtered);

  return { ok: true };
}

/**
 * Ta bort en källa från en lifecycle-Index (används vid "restore" eller
 * "re-probe"-beslut). Flyttar INTE tillbaka filen — det är restoreTs jobb.
 */
function removeFromLifecycleIndex(sourceId: string, projectRoot?: string): void {
  const dataRoot = projectRoot ?? resolveDataRoot();
  for (const indexPath of [
    path.join(dataRoot, 'sources/_quarantine/INDEX.json'),
    path.join(dataRoot, 'sources/_retired/INDEX.json'),
  ]) {
    const existing = readJsonl<Record<string, unknown>>(indexPath);
    const filtered = existing.filter(e => e?.sourceId !== sourceId);
    if (filtered.length !== existing.length) {
      writeJsonlAtomic(indexPath, filtered);
    }
  }
}

/**
 * Lös ett pending-beslut.
 *
 * @param entryId     entryId från listPending()
 * @param decision    approve | quarantine | retire | re_probe
 * @param decidedBy   'auto' eller användarnamn
 * @param note        valfri beslutsnotering
 * @param projectRoot Valfri root att läsa/skriva ifrån (för tester / sandbox)
 */
export function resolvePending(
  entryId: string,
  decision: ReviewDecision,
  decidedBy: string,
  note?: string,
  projectRoot?: string,
): { ok: boolean; error?: string; resolved?: ResolvedEntry } {
  const all = listPending(projectRoot);
  const target = all.find(e => e.entryId === entryId);
  if (!target) return { ok: false, error: `entry not found: ${entryId}` };

  let sideEffect: { ok: boolean; error?: string } = { ok: true };
  if (decision === 'quarantine') {
    sideEffect = moveToLifecycleBucket(target.sourceId, 'quarantined', String(target.reasonCode), target.note, undefined, projectRoot);
  } else if (decision === 'retire') {
    sideEffect = moveToLifecycleBucket(target.sourceId, 'retired', String(target.reasonCode), target.note, undefined, projectRoot);
  } else if (decision === 'approve' || decision === 're_probe') {
    // Ta bort från eventuell quarantine/retired-index (om det redan var dit-flyttat)
    removeFromLifecycleIndex(target.sourceId, projectRoot);
  }

  if (!sideEffect.ok) {
    return { ok: false, error: sideEffect.error };
  }

  const resolved: ResolvedEntry = {
    ...target,
    decision,
    decidedBy,
    decidedAt: new Date().toISOString(),
    decisionNote: note,
  };

  // Lägg till i resolved (append, atomic)
  const resolvedPath = projectRoot
    ? path.join(projectRoot, '02-Ingestion/C-htmlGate/manual-review/resolved.jsonl')
    : RESOLVED_FILE_RESOLVED();
  const existing = readJsonl<ResolvedEntry>(resolvedPath);
  existing.push(resolved);
  writeJsonlAtomic(resolvedPath, existing);

  // Ta bort från pending (om det var CLI-pending — auto-pending rensas
  // av C-pipelinen när den processar källan nästa gång)
  if (target.queue === 'cli-pending') {
    const cliPath = projectRoot
      ? path.join(projectRoot, '02-Ingestion/C-htmlGate/manual-review/pending.jsonl')
      : PENDING_FILE_RESOLVED();
    const cliRaw = readJsonl<PendingEntry>(cliPath);
    const filtered = cliRaw.filter(e => e.entryId !== entryId);
    writeJsonlAtomic(cliPath, filtered);
  }

  return { ok: true, resolved };
}

/**
 * Lägg till en källa i CLI-pending-kön (anropas av lifecycle-admin och
 * supervisor-dashboard).
 *
 * @param projectRoot Valfri root att läsa/skriva ifrån (för tester / sandbox)
 */
export function submitForReview(
  sourceId: string,
  reasonCode: ReasonCode | string,
  note: string,
  submittedBy: string,
  projectRoot?: string,
): { ok: boolean; entryId: string } {
  const entry: PendingEntry = {
    entryId: `cli:${sourceId}:${Date.now()}`,
    sourceId,
    queue: 'cli-pending',
    queuedAt: new Date().toISOString(),
    reasonCode,
    note: `${note} (by ${submittedBy})`,
  };
  const cliPath = projectRoot
    ? path.join(projectRoot, '02-Ingestion/C-htmlGate/manual-review/pending.jsonl')
    : PENDING_FILE_RESOLVED();
  const existing = readJsonl<PendingEntry>(cliPath);
  existing.push(entry);
  writeJsonlAtomic(cliPath, existing);
  return { ok: true, entryId: entry.entryId };
}
