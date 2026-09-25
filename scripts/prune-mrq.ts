#!/usr/bin/env -S npx tsx
/**
 * scripts/prune-mrq.ts — Bulk-clean the manual-review queues (Jev C, 2026-09-24).
 *
 * Reads both MRQ queues (cli-pending + auto-pending) via listPending() and
 * classifies each entry by:
 *   - city tag from sources/<id>.jsonl (Stockholm vs other)
 *   - queue type (cli-pending test entries vs auto-pending real failures)
 *   - age in days
 *
 * Decisions in --commit mode:
 *   - non-Stockholm auto-pending  → retire  (we have solution: city-filter)
 *   - cli-pending test entries     → retire  (test data)
 *   - source file missing          → retire  (stale reference)
 *   - Stockholm auto-pending + Exa-fallback found URL → re_probe
 *       (resolver removes from lifecycle index; MRQ entry re-tries via C-pipeline)
 *   - Stockholm auto-pending + Exa unavailable/error/nothing → leave in MRQ
 *       (we have no automated solution; operator keeps manual decision)
 *
 * Dry-run by default — prints recommended actions and the Exa lookup outcome
 * for Stockholm entries without committing anything. --commit applies the
 * auto-retire + Exa-driven re_probe decisions and leaves the rest in MRQ.
 *
 * Wired into scripts/cron/runNightly.sh after discovery so heal-tier-2's Exa
 * fallback gets first crack at MRQ entries before this script runs.
 *
 * CLI:
 *   npx tsx scripts/prune-mrq.ts                # dry-run report
 *   npx tsx scripts/prune-mrq.ts --commit       # apply auto-decisions
 */

import { readFileSync, existsSync, writeFileSync, renameSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  listPending,
  resolvePending,
  type PendingEntry,
  type ResolvedEntry,
} from '../02-Ingestion/C-htmlGate/manual-review/index.js';
import { lookupSourceUrl } from '../09-DiscoveryAgent/exaLookup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(PROJECT_ROOT, 'sources');
const CLI_PENDING_FILE = path.join(PROJECT_ROOT, '02-Ingestion/C-htmlGate/manual-review/pending.jsonl');
const RESOLVED_FILE = path.join(PROJECT_ROOT, '02-Ingestion/C-htmlGate/manual-review/resolved.jsonl');

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { commit: boolean; help: boolean; skipExa: boolean } {
  let commit = false;
  let help = false;
  let skipExa = false;
  for (const a of argv.slice(2)) {
    if (a === '--commit') commit = true;
    else if (a === '--dry') commit = false;
    else if (a === '--skip-exa') skipExa = true;
    else if (a === '--help' || a === '-h') help = true;
    else {
      console.error(`[prune-mrq] unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return { commit, help, skipExa };
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/prune-mrq.ts [--dry|--commit] [--skip-exa] [--help]

Modes:
  (default)  Dry-run: print recommended actions per entry, no FS writes
  --commit   Apply auto-retire + Exa-driven re_probe, leave the rest in MRQ
  --dry      Force dry-run (overrides any other mode flag)
  --skip-exa Skip Exa fallback even in --commit (faster, no network)

Auto-resolve rules:
  - non-Stockholm sources    → retire (Fas 1 city-filter excludes them)
  - cli-pending test entries → retire
  - source file missing      → retire
  - Stockholm + Exa URL hit  → re_probe (queue entry resolves, source retries)
  - Stockholm + no Exa URL   → LEAVE in MRQ (operator decision)
`);
}

// ─── Classification ────────────────────────────────────────────────────────

type Decision = 'retire' | 're_probe' | 'manual_keep';

interface ClassifiedEntry {
  entry: PendingEntry;
  city: string | null;
  ageDays: number;
  sourceFileExists: boolean;
  decision: Decision;
  reason: string;
  exaTriedUrl?: string;
  exaError?: string;
}

function classifyEntry(entry: PendingEntry, options: { skipExa: boolean }): ClassifiedEntry {
  const ageDays = daysSince(entry.queuedAt);
  const sourceFilePath = path.join(SOURCES_DIR, `${entry.sourceId}.jsonl`);
  const sourceFileExists = existsSync(sourceFilePath);
  const city = sourceFileExists ? readCity(sourceFilePath) : null;

  // cli-pending test data → retire
  if (entry.queue === 'cli-pending') {
    const isTestEntry = entry.note.includes('(by test-user)') || entry.reasonCode === 'schema.low_confidence_jsonld';
    if (isTestEntry) {
      return {
        entry,
        city,
        ageDays,
        sourceFileExists,
        decision: 'retire',
        reason: 'cli-pending test entry — no real source behind it',
      };
    }
    // Real cli-pending entry — keep for operator
    return {
      entry,
      city,
      ageDays,
      sourceFileExists,
      decision: 'manual_keep',
      reason: 'cli-pending real entry — needs operator decision',
    };
  }

  // auto-pending: non-Stockholm → retire (we have a solution: city-filter)
  if (city !== null && city.trim() !== 'Stockholm') {
    return {
      entry,
      city,
      ageDays,
      sourceFileExists,
      decision: 'retire',
      reason: `non-Stockholm source (city=${city}) — out of scope per Fas 1 city-filter`,
    };
  }

  // auto-pending: source file missing → retire (stale reference)
  if (!sourceFileExists) {
    return {
      entry,
      city,
      ageDays,
      sourceFileExists,
      decision: 'retire',
      reason: 'auto-pending but source file missing — stale reference',
    };
  }

  // Stockholm auto-pending: we have a solution path — try Exa fallback
  // Even in dry-run we attempt Exa so the operator sees whether it would help.
  if (!options.skipExa) {
    const sourceName = readName(sourceFilePath) ?? entry.sourceId;
    return {
      entry,
      city,
      ageDays,
      sourceFileExists,
      decision: 'manual_keep', // placeholder, refined below by caller
      reason: 'Stockholm source — pending Exa fallback',
      // exaTriedUrl / exaError are filled in by caller via await
    };
  }

  return {
    entry,
    city,
    ageDays,
    sourceFileExists,
    decision: 'manual_keep',
    reason: 'Stockholm source — no automated solution; operator keeps decision',
  };
}

async function applyExaFallback(rows: ClassifiedEntry[]): Promise<ClassifiedEntry[]> {
  const out: ClassifiedEntry[] = [];
  for (const row of rows) {
    if (row.entry.queue !== 'auto-pending' || row.city?.trim() !== 'Stockholm') {
      out.push(row);
      continue;
    }
    if (!row.sourceFileExists) {
      out.push(row);
      continue;
    }

    const sourceName = readName(path.join(SOURCES_DIR, `${row.entry.sourceId}.jsonl`)) ?? row.entry.sourceId;
    const sourceUrl = readUrl(path.join(SOURCES_DIR, `${row.entry.sourceId}.jsonl`));
    if (!sourceUrl) {
      out.push({
        ...row,
        decision: 'manual_keep',
        reason: 'Stockholm source — no URL in source file; cannot run Exa fallback',
      });
      continue;
    }
    const lookup = await lookupSourceUrl({
      id: row.entry.sourceId,
      url: sourceUrl,
      name: sourceName,
    }, { maxUrls: 1 });

    if (lookup.urls.length > 0) {
      out.push({
        ...row,
        decision: 're_probe',
        reason: `Stockholm source — Exa found ${lookup.urls[0]}`,
        exaTriedUrl: lookup.urls[0],
      });
    } else {
      out.push({
        ...row,
        decision: 'manual_keep',
        reason: lookup.exaAvailable
          ? 'Stockholm source — Exa returned no usable URL (cross-domain only)'
          : `Stockholm source — Exa unavailable: ${lookup.error ?? 'unknown'} — leaving in MRQ for operator`,
        exaError: lookup.error,
      });
    }
  }
  return out;
}

function readCity(sourceFilePath: string): string | null {
  try {
    const text = readFileSync(sourceFilePath, 'utf8').trim();
    const parsed = JSON.parse(text) as { city?: string };
    return parsed.city ?? null;
  } catch {
    return null;
  }
}

function readName(sourceFilePath: string): string | null {
  try {
    const text = readFileSync(sourceFilePath, 'utf8').trim();
    const parsed = JSON.parse(text) as { name?: string };
    return parsed.name ?? null;
  } catch {
    return null;
  }
}

function readUrl(sourceFilePath: string): string | null {
  try {
    const text = readFileSync(sourceFilePath, 'utf8').trim();
    const parsed = JSON.parse(text) as { url?: string };
    return parsed.url ?? null;
  } catch {
    return null;
  }
}

function daysSince(isoDate: string): number {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return -1;
  return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
}

// ─── Reporting ─────────────────────────────────────────────────────────────

function printReport(rows: ClassifiedEntry[], commit: boolean): void {
  const retireCount = rows.filter((r) => r.decision === 'retire').length;
  const reprobeCount = rows.filter((r) => r.decision === 're_probe').length;
  const keepCount = rows.filter((r) => r.decision === 'manual_keep').length;

  console.log(
    `[prune-mrq] mode=${commit ? 'COMMIT' : 'DRY-RUN'} total=${rows.length} ` +
    `retire=${retireCount} re_probe=${reprobeCount} keep=${keepCount}`,
  );
  console.log('');
  console.log('queue       sourceId                          city         age   decision    reason');
  console.log('─'.repeat(120));

  for (const r of rows) {
    const queue = r.entry.queue.padEnd(11);
    const id = r.entry.sourceId.slice(0, 32).padEnd(32);
    const city = (r.city ?? (r.sourceFileExists ? '?' : 'NO_FILE')).padEnd(11);
    const age = String(r.ageDays).padStart(3) + 'd';
    const decision = r.decision.padEnd(11);
    const reason = (r.exaTriedUrl ? `[Exa→${r.exaTriedUrl}] ` : '') +
      (r.reason.length > 50 ? r.reason.slice(0, 47) + '...' : r.reason);
    console.log(`${queue} ${id} ${city} ${age}  ${decision} ${reason}`);
  }

  console.log('');
  if (commit) {
    console.log(
      `[prune-mrq] committed ${retireCount} retires + ${reprobeCount} re_probes; ` +
      `${keepCount} left in MRQ for operator`,
    );
  } else {
    console.log(`[prune-mrq] re-run with --commit to apply ${retireCount + reprobeCount} decisions`);
  }
}

// ─── Apply ─────────────────────────────────────────────────────────────────

interface ApplyOutcome {
  retired: number;
  reprobed: number;
  leftInMrq: number;
  errored: number;
}

function applyDecisions(rows: ClassifiedEntry[]): ApplyOutcome {
  let retired = 0;
  let reprobed = 0;
  let leftInMrq = 0;
  let errored = 0;

  for (const r of rows) {
    if (r.decision === 'manual_keep') {
      leftInMrq++;
      continue;
    }
    const note = r.exaTriedUrl
      ? `${r.reason} (triedUrl=${r.exaTriedUrl})`
      : r.reason;
    const decision = r.decision === 'retire' ? 'retire' : 're_probe';

    // Fast-path: source file missing → resolvePending can't moveToLifecycleBucket.
    // Write directly to resolved.jsonl + remove from cli-pending if applicable.
    if (!r.sourceFileExists) {
      try {
        appendResolvedDirectly({
          ...r.entry,
          decision,
          decidedBy: 'auto:prune-mrq',
          decidedAt: new Date().toISOString(),
          decisionNote: note,
        });
        if (r.entry.queue === 'cli-pending') {
          removeCliPending(r.entry.entryId);
        }
        if (decision === 'retire') retired++;
        else reprobed++;
      } catch (err) {
        errored++;
        console.error(`[prune-mrq] failed to ${decision} ${r.entry.sourceId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    const result = resolvePending(r.entry.entryId, decision, 'auto:prune-mrq', note);
    if (result.ok) {
      if (decision === 'retire') retired++;
      else reprobed++;
    } else {
      errored++;
      console.error(`[prune-mrq] failed to ${decision} ${r.entry.sourceId}: ${result.error}`);
    }
  }
  return { retired, reprobed, leftInMrq, errored };
}

/**
 * Append a resolved entry directly to resolved.jsonl without going through
 * resolvePending. Used when the source file is missing (moveToLifecycleBucket
 * would fail). Atomic write via tmp + rename.
 */
function appendResolvedDirectly(entry: ResolvedEntry): void {
  const existing = existsSync(RESOLVED_FILE)
    ? readJsonl<ResolvedEntry>(RESOLVED_FILE)
    : [];
  existing.push(entry);
  writeJsonlAtomic(RESOLVED_FILE, existing);
}

function removeCliPending(entryId: string): void {
  if (!existsSync(CLI_PENDING_FILE)) return;
  const entries = readJsonl<PendingEntry>(CLI_PENDING_FILE);
  const filtered = entries.filter((e) => e.entryId !== entryId);
  if (filtered.length === entries.length) return;
  writeJsonlAtomic(CLI_PENDING_FILE, filtered);
}

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  if (content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        return null;
      }
    })
    .filter((e): e is T => e !== null);
}

function writeJsonlAtomic(filePath: string, rows: unknown[]): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const content = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, filePath);
}

// ─── Entry point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { commit, help, skipExa } = parseArgs(process.argv);
  if (help) {
    printHelp();
    process.exit(0);
  }

  const entries = listPending();
  // Stage 1: pure classification (no network). All 'Stockholm + Exa' rows
  // are placeholders until we run applyExaFallback below.
  let rows = entries.map((e) => classifyEntry(e, { skipExa }));
  // Stage 2: Exa fallback for Stockholm auto-pending rows. We run this in
  // BOTH dry-run and --commit mode so the operator sees what the production
  // decision would be. --skip-exa bypasses it entirely.
  if (!skipExa) {
    rows = await applyExaFallback(rows);
  }

  printReport(rows, commit);

  if (commit) {
    const outcome = applyDecisions(rows);
    console.log(
      `[prune-mrq] done: retired=${outcome.retired} ` +
      `reprobed=${outcome.reprobed} leftInMrq=${outcome.leftInMrq} ` +
      `errored=${outcome.errored}`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`[prune-mrq] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
