/**
 * 09-DiscoveryAgent/eval.ts — Self-eval helpers for the autonomous discovery agent.
 *
 * Foundation module. All other agent modules (heal, promote, expand, agent)
 * import from here. Responsibilities:
 *
 * 1. Read runtime/sources_status.jsonl via the sourceRegistry (no direct FS).
 * 2. Filter failing sources (consecutiveFailures >= threshold).
 * 3. Read/parse runtime/discovery-candidates.jsonl (separate FS — this file is
 *    written by C0-htmlFrontierDiscovery and is not in sourceRegistry).
 * 4. Append-only audit logs to runtime/discovery-agent/{runs,promoted,retired}.jsonl.
 *
 * No LLM calls, no fetches, no source mutations. Pure data layer.
 *
 * Constraint: append-only logs (one JSON object per line). Every entry has an
 * ISO UTC timestamp. No in-place mutation of input files.
 */

import { readFileSync, appendFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  getAllSources,
  getAllStatuses,
  type SourceTruth,
  type SourceStatus,
} from '../02-Ingestion/tools/sourceRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const AUDIT_DIR = path.resolve(RUNTIME_DIR, 'discovery-agent');
const DISCOVERY_CANDIDATES_FILE = path.resolve(RUNTIME_DIR, 'discovery-candidates.jsonl');

// ─── Audit log paths (append-only) ─────────────────────────────────────────

const RUNS_LOG = path.resolve(AUDIT_DIR, 'runs.jsonl');
const PROMOTED_LOG = path.resolve(AUDIT_DIR, 'promoted.jsonl');
const RETIRED_LOG = path.resolve(AUDIT_DIR, 'retired.jsonl');

// ─── Types ─────────────────────────────────────────────────────────────────

/** A failing source joined with its current status — what heal.ts iterates. */
export interface FailingSource {
  source: SourceTruth;
  status: SourceStatus;
  /** Tier chosen by heal.ts: 1 (transport), 2 (no-jsonld), 3 (retire). */
  suggestedTier?: 1 | 2 | 3;
}

/** Single discovery candidate from discovery-candidates.jsonl. */
export interface DiscoveryCandidate {
  sourceId: string;
  candidateUrl: string;
  score: number;
  productivity: number;
  stability: number;
  discoveredAt: string;
  reason: string;
  evidence?: Record<string, unknown>;
  /** Set when the promote pipeline has tested this candidate. */
  testedAt?: string;
  /** Number of events found at the candidate URL (or 0). */
  eventsFound?: number;
  /** Where this candidate came from — internal C0, exa-search, etc. */
  candidateOrigin?: 'c0' | 'exa-search' | 'manual' | 'venue_graph';
}

/** What gets written to runs.jsonl for each heal/promote/expand action. */
export interface RunLogEntry {
  ts: string;
  phase: 'heal' | 'promote' | 'expand';
  sourceId?: string;
  candidateUrl?: string;
  tier?: 1 | 2 | 3;
  durationMs: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  error?: string;
  dryRun?: boolean;
}

export interface PromotedLogEntry {
  ts: string;
  sourceId: string;
  url: string;
  eventsFound: number;
  candidateOrigin: DiscoveryCandidate['candidateOrigin'];
  approvedBy: 'auto:agent' | 'manual';
}

export interface RetiredLogEntry {
  ts: string;
  sourceId: string;
  reason: string;
  consecutiveFailures: number;
  lastSuccess: string | null;
  movedFrom: 'runtime/sources_status.jsonl';
}

// ─── Audit log helpers ─────────────────────────────────────────────────────

/**
 * Ensure runtime/discovery-agent/ exists. Called lazily by append helpers.
 * Idempotent — safe to call on every entry.
 */
function ensureAuditDir(): void {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

/** Current time as ISO UTC. Single source of truth so tests can stub it. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Append one entry to a JSONL audit file. Creates parent dir if missing.
 * Never overwrites — always appends.
 */
function appendJsonl(filePath: string, entry: Record<string, unknown>): void {
  ensureAuditDir();
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

export function appendRun(entry: RunLogEntry): void {
  appendJsonl(RUNS_LOG, entry);
}

export function appendPromoted(entry: PromotedLogEntry): void {
  appendJsonl(PROMOTED_LOG, entry);
}

export function appendRetired(entry: RetiredLogEntry): void {
  appendJsonl(RETIRED_LOG, entry);
}

// ─── Failing-source reader ──────────────────────────────────────────────────

/**
 * Read failing sources from sourceRegistry. Joins getAllSources with
 * getAllStatuses and filters by consecutiveFailures threshold.
 *
 * Returns the full truth + status pair so heal.ts has all info without
 * re-fetching. Sorted by consecutiveFailures desc, then lastRun asc
 * (oldest broken first).
 */
export function readFailingSources(
  options: { minConsecutiveFailures?: number; limit?: number } = {},
): FailingSource[] {
  const minFails = options.minConsecutiveFailures ?? 2;
  const limit = options.limit ?? 50;

  const sources = getAllSources();
  const statuses = getAllStatuses();
  const statusById = new Map(statuses.map((s) => [s.sourceId, s]));

  const joined: FailingSource[] = [];
  for (const source of sources) {
    const status = statusById.get(source.id);
    if (!status) continue;
    if (status.consecutiveFailures < minFails) continue;

    joined.push({ source, status });
  }

  joined.sort((a, b) => {
    if (a.status.consecutiveFailures !== b.status.consecutiveFailures) {
      return b.status.consecutiveFailures - a.status.consecutiveFailures;
    }
    const aLast = a.status.lastRun ?? '';
    const bLast = b.status.lastRun ?? '';
    return aLast.localeCompare(bLast);
  });

  return joined.slice(0, limit);
}

/**
 * Pick the heal tier for a failing source based on its routing reason.
 *
 * Tier 1 (transport): lastRoutingReason indicates network/transport failure.
 *   → try ScrapingBee render-gate.
 * Tier 2 (no-jsonld): lastRoutingReason indicates no JSON-LD / no events.
 *   → C0 candidate discovery → D-AI adapter generation.
 * Tier 3 (retire): consecutiveFailures >= retireAfter AND no success recently.
 *   → audit-only retire, never delete the source.
 *
 * Returns null when the source has no clear lastRoutingReason — caller should
 * skip it (no signal to act on).
 */
export function pickHealTier(
  status: SourceStatus,
  options: { retireAfter?: number; retireDays?: number } = {},
): 1 | 2 | 3 | null {
  const retireAfter = options.retireAfter ?? 5;
  const retireDays = options.retireDays ?? 30;

  if (
    status.consecutiveFailures >= retireAfter &&
    isOlderThanDays(status.lastSuccess, retireDays)
  ) {
    return 3;
  }

  const reason = status.lastRoutingReason ?? '';
  if (reason.length === 0) return null;

  if (/Fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|SSL|handshake|network|redirect loop|Redirect loop/i.test(reason)) {
    return 1;
  }

  if (/no-jsonld|no events|empty|0 events/i.test(reason)) {
    return 2;
  }

  return 2; // Default: treat unknown failure as no-jsonld (most common case)
}

function isOlderThanDays(isoDate: string | null, days: number): boolean {
  if (!isoDate) return true;
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return true;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return ts < cutoff;
}

// ─── Discovery-candidate reader/writer ─────────────────────────────────────

/**
 * Read all discovery candidates from runtime/discovery-candidates.jsonl.
 * Filters out lines that fail to parse — never throws on bad lines.
 *
 * Returns a NEW array. Caller may mutate freely.
 */
export function readAllCandidates(): DiscoveryCandidate[] {
  if (!existsSync(DISCOVERY_CANDIDATES_FILE)) return [];
  const text = readFileSync(DISCOVERY_CANDIDATES_FILE, 'utf-8');
  const out: DiscoveryCandidate[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as DiscoveryCandidate);
    } catch {
      // skip malformed lines — audit-only signal, never crash
    }
  }
  return out;
}

/**
 * Filter to candidates the promote pipeline hasn't tested yet.
 * Idempotency key: candidateUrl.
 */
export function readUnexploredCandidates(): DiscoveryCandidate[] {
  return readAllCandidates().filter((c) => !c.testedAt);
}

/**
 * Mark a candidate as tested. Reads the file, rewrites it with the updated
 * record, preserves all other records. This is the ONLY mutation of
 * discovery-candidates.jsonl — all other write paths use append-only audit
 * logs.
 *
 * Idempotent: second call with same url updates testedAt/eventsFound in place.
 * Returns true if a record was updated, false if no match found.
 */
export function markCandidateTested(
  candidateUrl: string,
  eventsFound: number,
  now: string = nowIso(),
): boolean {
  const all = readAllCandidates();
  let updated = false;
  const next = all.map((c) => {
    if (c.candidateUrl !== candidateUrl) return c;
    updated = true;
    return { ...c, testedAt: now, eventsFound };
  });
  if (!updated) return false;
  writeFileSync(
    DISCOVERY_CANDIDATES_FILE,
    next.map((c) => JSON.stringify(c)).join('\n') + '\n',
    'utf-8',
  );
  return true;
}

// ─── Convenience: count helpers (for self-eval baseline) ──────────────────

export function countHealthySources(): number {
  return getAllStatuses().filter((s) => s.consecutiveFailures === 0).length;
}

export function countFailingSources(minFails: number = 2): number {
  return getAllStatuses().filter((s) => s.consecutiveFailures >= minFails).length;
}
