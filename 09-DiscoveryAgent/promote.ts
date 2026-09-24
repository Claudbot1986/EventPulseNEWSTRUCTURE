/**
 * 09-DiscoveryAgent/promote.ts — Promote unexplored discovery candidates.
 *
 * Fas 2.2: merge promote with heal tier 2 flow.
 *
 * For each candidate from runtime/discovery-candidates.jsonl that hasn't been
 * tested yet:
 *
 *   1. discoverEventCandidates(candidateUrl, undefined, sourceId)
 *      → if no winner → mark tested with 0 events, return below_threshold
 *   2. runPipeline({ sourceId, url: winner.url })
 *      → if !validationPassed OR eventsFound < MIN_EVENTS_TO_PROMOTE
 *        → mark tested, return below_threshold
 *      → else → derive slug, write sources/{slug}.jsonl, appendPromoted
 *
 * Slug derivation: lowercase host + alphanum path segments joined by '-'.
 * If slug collides with an existing source, suffix with -2, -3, etc.
 *
 * No source is ever overwritten — promote creates new files only.
 */

import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  discoverEventCandidates,
  type FrontierDiscoveryResult,
} from '../02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.js';
import {
  runPipeline,
} from '../02-Ingestion/D-renderGate/constrainedAgent.js';

import {
  appendPromoted,
  appendRun,
  markCandidateTested,
  nowIso,
  type DiscoveryCandidate,
} from './eval.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.resolve(PROJECT_ROOT, 'sources');

/**
 * Minimum events to consider a candidate worth promoting.
 *
 * Fas 2.2: lowered from 10 → 3. Candidates are now adapter-generated via the
 * C0 + constrainedAgent pipeline (the same flow heal tier 2 uses), not raw
 * JSON-LD landings — 3 validated events is the new bar.
 */
export const MIN_EVENTS_TO_PROMOTE = 3;

// ─── Types ─────────────────────────────────────────────────────────────────

export type PromoteStatus =
  | 'promoted'        // source file written
  | 'below_threshold' // events < MIN_EVENTS_TO_PROMOTE, candidate marked
  | 'no_winner'       // C0 found no candidate page to run the pipeline on
  | 'duplicate'       // slug already exists for another URL — skip safely
  | 'error';

export interface PromoteResult {
  candidateUrl: string;
  sourceId?: string;
  status: PromoteStatus;
  eventsFound: number;
  durationMs: number;
  error?: string;
}

export interface PromoteOptions {
  /** Override the default min-events threshold (default MIN_EVENTS_TO_PROMOTE). */
  minEvents?: number;
  /** Skip side-effects (no source write, no mark, no log). */
  dryRun?: boolean;
}

// ─── Entry point ───────────────────────────────────────────────────────────

/**
 * Promote one discovery candidate. Mirrors heal tier 2:
 *   C0 candidate discovery → constrainedAgent pipeline → validate + count.
 *
 * Always returns a PromoteResult; never throws (network/parse failures land
 * in result.status='error' with result.error set). Logs to runs.jsonl
 * unless dryRun is true.
 */
export async function promoteOne(
  candidate: DiscoveryCandidate,
  options: PromoteOptions = {},
): Promise<PromoteResult> {
  const minEvents = options.minEvents ?? MIN_EVENTS_TO_PROMOTE;
  const start = Date.now();

  // Step 1: C0 candidate discovery on the Exa-suggested root URL.
  let discovery: FrontierDiscoveryResult;
  try {
    discovery = await discoverEventCandidates(
      candidate.candidateUrl,
      undefined,
      candidate.sourceId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: PromoteResult = {
      candidateUrl: candidate.candidateUrl,
      status: 'error',
      eventsFound: 0,
      durationMs: Date.now() - start,
      error: `C0 discovery failed: ${message}`,
    };
    logPromoteResult(candidate, result, options.dryRun);
    return result;
  }

  const winner = discovery.winner;
  if (!winner) {
    if (!options.dryRun) {
      markCandidateTested(candidate.candidateUrl, 0);
    }
    const result: PromoteResult = {
      candidateUrl: candidate.candidateUrl,
      status: 'no_winner',
      eventsFound: 0,
      durationMs: Date.now() - start,
      error: `no winner: ${discovery.winnerReason ?? 'unknown'}`,
    };
    logPromoteResult(candidate, result, options.dryRun);
    return result;
  }

  // Step 2: constrainedAgent pipeline on the discovered winner URL.
  let pipelineResult;
  try {
    pipelineResult = await runPipeline({
      sourceId: candidate.sourceId,
      url: winner.url,
      maxTokens: 1500,
      rateLimitMs: 1500,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: PromoteResult = {
      candidateUrl: candidate.candidateUrl,
      status: 'error',
      eventsFound: 0,
      durationMs: Date.now() - start,
      error: `runPipeline failed: ${message}`,
    };
    logPromoteResult(candidate, result, options.dryRun);
    return result;
  }

  const eventsFound = pipelineResult.eventsFound ?? 0;
  if (!pipelineResult.validationPassed || eventsFound < minEvents) {
    if (!options.dryRun) {
      markCandidateTested(candidate.candidateUrl, eventsFound);
    }
    const result: PromoteResult = {
      candidateUrl: candidate.candidateUrl,
      status: 'below_threshold',
      eventsFound,
      durationMs: Date.now() - start,
      error: pipelineResult.validationPassed
        ? `events=${eventsFound} below threshold ${minEvents}`
        : `validation: ${pipelineResult.validationNotes ?? 'unknown'}`,
    };
    logPromoteResult(candidate, result, options.dryRun);
    return result;
  }

  // Threshold met — derive slug, check for collision, write source.
  const baseSlug = deriveSlug(candidate.candidateUrl);
  const slug = findAvailableSlug(baseSlug);
  if (slug === null) {
    const result: PromoteResult = {
      candidateUrl: candidate.candidateUrl,
      status: 'duplicate',
      eventsFound,
      durationMs: Date.now() - start,
      error: `no available slug for base "${baseSlug}"`,
    };
    logPromoteResult(candidate, result, options.dryRun);
    return result;
  }

  if (!options.dryRun) {
    writeSourceFile(slug, candidate.candidateUrl, eventsFound);
    markCandidateTested(candidate.candidateUrl, eventsFound);
    appendPromoted({
      ts: nowIso(),
      sourceId: slug,
      url: candidate.candidateUrl,
      eventsFound,
      candidateOrigin: candidate.candidateOrigin ?? 'c0',
      approvedBy: 'auto:agent',
    });
  }

  const result: PromoteResult = {
    candidateUrl: candidate.candidateUrl,
    sourceId: slug,
    status: 'promoted',
    eventsFound,
    durationMs: Date.now() - start,
  };
  logPromoteResult(candidate, result, options.dryRun);
  return result;
}

// ─── Audit ─────────────────────────────────────────────────────────────────

function logPromoteResult(
  candidate: DiscoveryCandidate,
  result: PromoteResult,
  dryRun: boolean | undefined,
): void {
  if (dryRun) return;
  appendRun({
    ts: nowIso(),
    phase: 'promote',
    candidateUrl: candidate.candidateUrl,
    sourceId: result.sourceId,
    durationMs: result.durationMs,
    before: { eventsFound: 0, candidateOrigin: candidate.candidateOrigin ?? 'c0' },
    after: {
      eventsFound: result.eventsFound,
      promoted: result.status === 'promoted',
    },
    error: result.error,
    dryRun: false,
  });
}

// ─── Slug + source-file helpers ────────────────────────────────────────────

function deriveSlug(url: string): string {
  let host = 'unknown';
  let pathPart = '';
  try {
    const u = new URL(url);
    host = u.host.replace(/^www\./, '').replace(/\./g, '-');
    const segments = u.pathname
      .split('/')
      .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      .filter((s) => s.length > 0 && s !== '-');
    pathPart = segments.join('-');
  } catch {
    // fall through with defaults
  }
  const base = pathPart.length > 0 ? `${host}-${pathPart}` : host;
  // Cap to a reasonable length.
  return base.slice(0, 80) || 'unknown';
}

function findAvailableSlug(base: string): string | null {
  if (!existsSync(path.join(SOURCES_DIR, `${base}.jsonl`))) return base;
  for (let i = 2; i < 50; i++) {
    const candidate = `${base}-${i}`;
    if (!existsSync(path.join(SOURCES_DIR, `${candidate}.jsonl`))) return candidate;
  }
  return null;
}

function writeSourceFile(slug: string, url: string, eventsFound: number): void {
  const sourceObject = {
    id: slug,
    url,
    name: slug,
    type: 'unknown',
    city: 'Stockholm',
    discoveredAt: nowIso(),
    discoveredBy: 'discovery' as const,
    preferredPath: 'unknown' as const,
    preferredPathReason: `T0095 discovery-agent Fas 2.2 promote: ${eventsFound} validated events via C0+constrainedAgent`,
    systemVersionAtDecision: null,
    verifiedAt: null,
    needsRecheck: true,
    lastSystemVersion: null,
    metadata: {
      discoveredByAgent: 'T0095-discovery-agent',
      initialEventsFound: eventsFound,
      promotionDate: nowIso(),
    },
  };
  const line = JSON.stringify(sourceObject) + '\n';
  writeFileSync(path.join(SOURCES_DIR, `${slug}.jsonl`), line, 'utf-8');
}
