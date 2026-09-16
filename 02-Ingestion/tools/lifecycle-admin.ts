#!/usr/bin/env node
/**
 * Lifecycle Admin — CLI för käll-livscykel.
 *
 * Kommandon:
 *   list [--quarantined|--retired|--all]
 *   quarantine <sourceId> --reason <code> --note "..." [--by <user>]
 *   retire <sourceId> --reason <code> --note "..." [--by <user>]
 *   restore <sourceId> --by <user>      # flytta tillbaka från quarantine/retired
 *   markForReview <sourceId> --reason <code> --note "..." [--by <user>]
 *   resolve <entryId> --decision <d> [--by <user>] [--note "..."]
 *
 * Säkerhet:
 * - Alla INDEX-write är atomära (write-then-rename i quarantineGuard.ts).
 * - quarantine är tillåtet utan --by, men auto-quarantine loggar movedBy='auto'.
 * - retire KRÄVER --by (mänskligt beslut — aldrig auto).
 * - restore KRÄVER --by.
 *
 * Exempel:
 *   npx tsx 02-Ingestion/tools/lifecycle-admin.ts list --quarantined
 *   npx tsx 02-Ingestion/tools/lifecycle-admin.ts quarantine billetto-stockholm \
 *     --reason anti_bot.unknown --note "403 since 2026-09-05" --by tomor
 *   npx tsx 02-Ingestion/tools/lifecycle-admin.ts resolve "cli:billetto-stockholm:..." \
 *     --decision quarantine --by tomor
 */

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  QUARANTINE_DIR, RETIRED_DIR, QUARANTINE_INDEX, RETIRED_INDEX,
  resolveQuarantineDir, resolveRetiredDir, resolveQuarantineIndexPath, resolveRetiredIndexPath,
  loadQuarantineIndex, loadRetiredIndex, type LifecycleEntry,
} from '../lib/quarantineGuard.js';
import {
  ALL_REASON_CODES, isReasonCode, type ReasonCode,
} from '../lib/sourceLifecycle.js';
import {
  PENDING_FILE, RESOLVED_FILE, listPending, resolvePending, submitForReview,
} from '../C-htmlGate/manual-review/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : PROJECT_ROOT;
const SOURCES_DIR = path.resolve(DATA_ROOT, 'sources');

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  // Stödjer både JSON-array (INDEX-filer, sources/_quarantine/INDEX.json)
  // och JSONL (pending/resolved-köer, postTestC-manual-review.jsonl)
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
}

function writeJsonlAtomic(filePath: string, rows: unknown[]): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  // INDEX-filer (slutar på INDEX.json) skrivs som JSON-array.
  // Pending/resolved-filer (.jsonl) skrivs som JSONL.
  const isIndexFile = filePath.endsWith('INDEX.json');
  const content = isIndexFile
    ? JSON.stringify(rows, null, 2) + '\n'
    : rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, filePath);
}

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  if (argv.length < 1) {
    printUsage();
    process.exit(1);
  }
  const args: Args = { command: argv[0], positional: [], flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = 'true';
      }
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`Usage: lifecycle-admin <command> [args]

Commands:
  list [--quarantined|--retired|--all|--review]
  quarantine <sourceId> --reason <code> --note "..." [--by <user>]
  retire <sourceId> --reason <code> --note "..." --by <user>
  restore <sourceId> --by <user>
  markForReview <sourceId> --reason <code> --note "..." [--by <user>]
  resolve <entryId> --decision <approve|quarantine|retire|re_probe> --by <user> [--note "..."]

Valid reason codes:
  ${ALL_REASON_CODES.join(', ')}
`);
}

function getSourceUrl(sourceId: string): string {
  const filePath = path.join(SOURCES_DIR, `${sourceId}.jsonl`);
  if (!existsSync(filePath)) return '';
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8').trim());
    return typeof parsed.url === 'string' ? parsed.url : '';
  } catch { return ''; }
}

function cmdList(args: Args): void {
  const filter = args.flags.quarantined ? 'quarantined'
    : args.flags.retired ? 'retired'
    : args.flags.review ? 'review'
    : 'all';

  if (filter === 'quarantined' || filter === 'all') {
    const q = loadQuarantineIndex();
    console.log(`\n=== Quarantined (${q.size}) ===`);
    for (const e of q.values()) {
      console.log(`  ${e.sourceId.padEnd(40)} ${e.reasonCode.padEnd(32)} ${e.note}`);
    }
  }
  if (filter === 'retired' || filter === 'all') {
    const r = loadRetiredIndex();
    console.log(`\n=== Retired (${r.size}) ===`);
    for (const e of r.values()) {
      console.log(`  ${e.sourceId.padEnd(40)} ${e.reasonCode.padEnd(32)} ${e.note}`);
    }
  }
  if (filter === 'review' || filter === 'all') {
    const p = listPending();
    console.log(`\n=== Pending manual review (${p.length}) ===`);
    for (const e of p.slice(0, 20)) {
      console.log(`  ${e.entryId.padEnd(60)} ${e.sourceId.padEnd(30)} ${e.reasonCode}`);
    }
    if (p.length > 20) console.log(`  ... and ${p.length - 20} more`);
  }
}

function moveToBucket(
  sourceId: string,
  bucket: 'quarantined' | 'retired',
  reasonCode: string,
  note: string,
  movedBy: string,
): { ok: boolean; error?: string } {
  const sourceFile = path.join(SOURCES_DIR, `${sourceId}.jsonl`);
  if (!existsSync(sourceFile)) {
    return { ok: false, error: `source file not found: ${sourceFile}` };
  }

  const targetDir = bucket === 'quarantined' ? resolveQuarantineDir() : resolveRetiredDir();
  const targetFile = path.join(targetDir, `${sourceId}.jsonl`);

  // Försök inte flytta om redan i mål-mappen
  if (sourceFile === targetFile) {
    return { ok: false, error: `source already in ${bucket}` };
  }

  const url = getSourceUrl(sourceId);
  renameSync(sourceFile, targetFile);

  const indexPath = bucket === 'quarantined' ? resolveQuarantineIndexPath() : resolveRetiredIndexPath();
  const existing = readJsonl<LifecycleEntry>(indexPath);
  const filtered = existing.filter(e => e.sourceId !== sourceId);
  filtered.push({
    sourceId,
    url,
    movedAt: new Date().toISOString(),
    reasonCode,
    note,
    movedBy,
  });
  writeJsonlAtomic(indexPath, filtered);

  return { ok: true };
}

function cmdQuarantine(args: Args): void {
  const [sourceId] = args.positional;
  if (!sourceId) { console.error('error: sourceId required'); process.exit(1); }
  const reasonCode = args.flags.reason || 'unknown';
  const note = args.flags.note || '(no note)';
  const movedBy = args.flags.by || 'manual';

  if (!isReasonCode(reasonCode) && reasonCode !== 'unknown') {
    console.warn(`warning: reasonCode "${reasonCode}" is not in the standard enum; storing anyway`);
  }

  const r = moveToBucket(sourceId, 'quarantined', reasonCode, note, movedBy);
  if (!r.ok) { console.error(`error: ${r.error}`); process.exit(1); }
  console.log(`quarantined: ${sourceId} (${reasonCode})`);
}

function cmdRetire(args: Args): void {
  const [sourceId] = args.positional;
  if (!sourceId) { console.error('error: sourceId required'); process.exit(1); }
  if (!args.flags.by) { console.error('error: retire kräver --by <user> (mänskligt beslut)'); process.exit(1); }
  const reasonCode = args.flags.reason || 'unknown';
  const note = args.flags.note || '(no note)';
  const movedBy = args.flags.by!;

  const r = moveToBucket(sourceId, 'retired', reasonCode, note, movedBy);
  if (!r.ok) { console.error(`error: ${r.error}`); process.exit(1); }
  console.log(`retired: ${sourceId} (${reasonCode})`);
}

function cmdRestore(args: Args): void {
  const [sourceId] = args.positional;
  if (!sourceId) { console.error('error: sourceId required'); process.exit(1); }
  if (!args.flags.by) { console.error('error: restore kräver --by <user>'); process.exit(1); }
  const restoredBy = args.flags.by!;

  // Hitta källan i quarantine eller retired
  let foundIn: 'quarantined' | 'retired' | null = null;
  for (const [bucket, dir] of [['quarantined', resolveQuarantineDir()], ['retired', resolveRetiredDir()]] as const) {
    const filePath = path.join(dir, `${sourceId}.jsonl`);
    if (existsSync(filePath)) {
      foundIn = bucket;
      const target = path.join(SOURCES_DIR, `${sourceId}.jsonl`);
      renameSync(filePath, target);

      const indexPath = bucket === 'quarantined' ? resolveQuarantineIndexPath() : resolveRetiredIndexPath();
      const existing = readJsonl<LifecycleEntry>(indexPath);
      const filtered = existing.filter(e => e.sourceId !== sourceId);
      writeJsonlAtomic(indexPath, filtered);

      console.log(`restored: ${sourceId} (was ${bucket}, by ${restoredBy})`);
      break;
    }
  }

  if (!foundIn) {
    console.error(`error: ${sourceId} not found in quarantine or retired`);
    process.exit(1);
  }
}

function cmdMarkForReview(args: Args): void {
  const [sourceId] = args.positional;
  if (!sourceId) { console.error('error: sourceId required'); process.exit(1); }
  const reasonCode = args.flags.reason || 'unknown';
  const note = args.flags.note || '';
  const by = args.flags.by || 'manual';
  if (!note) { console.error('error: --note required för markForReview'); process.exit(1); }

  const r = submitForReview(sourceId, reasonCode, note, by);
  console.log(`submitted for review: ${sourceId} → ${r.entryId}`);
}

function cmdResolve(args: Args): void {
  const [entryId] = args.positional;
  if (!entryId) { console.error('error: entryId required'); process.exit(1); }
  const decision = args.flags.decision as 'approve' | 'quarantine' | 'retire' | 're_probe' | undefined;
  if (!decision) { console.error('error: --decision required (approve|quarantine|retire|re_probe)'); process.exit(1); }
  if (!['approve', 'quarantine', 'retire', 're_probe'].includes(decision)) {
    console.error(`error: invalid decision "${decision}"`);
    process.exit(1);
  }
  const by = args.flags.by || 'manual';
  const note = args.flags.note;

  const r = resolvePending(entryId, decision, by, note);
  if (!r.ok) { console.error(`error: ${r.error}`); process.exit(1); }
  console.log(`resolved: ${entryId} → ${decision} (by ${by})`);
}

const args = parseArgs(process.argv.slice(2));

switch (args.command) {
  case 'list': cmdList(args); break;
  case 'quarantine': cmdQuarantine(args); break;
  case 'retire': cmdRetire(args); break;
  case 'restore': cmdRestore(args); break;
  case 'markForReview': cmdMarkForReview(args); break;
  case 'resolve': cmdResolve(args); break;
  case '--help':
  case '-h':
  case 'help':
    printUsage();
    break;
  default:
    console.error(`error: unknown command "${args.command}"`);
    printUsage();
    process.exit(1);
}
