/**
 * 09-DiscoveryAgent/promote.ts — Promote unexplored discovery candidates.
 *
 * For each candidate from runtime/discovery-candidates.jsonl that hasn't been
 * tested yet:
 *
 *   1. fetchHtml(candidateUrl, { timeout: 5s })
 *   2. count <script type="application/ld+json"> with @type Event
 *   3. if eventsFound >= MIN_EVENTS_TO_PROMOTE:
 *        - derive slug from URL host+path
 *        - write sources/{slug}.jsonl with discoveredBy='discovery',
 *          preferredPath='unknown', needsRecheck=true
 *        - appendPromoted({...})
 *      else:
 *        - markCandidateTested(url, eventsFound) — only audit, no source
 *
 * Slug derivation: lowercase host + alphanum path segments joined by '-'.
 * If slug collides with an existing source, suffix with -2, -3, etc.
 *
 * No source is ever overwritten — promote creates new files only.
 */

import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load } from 'cheerio';

import { fetchHtml } from '../02-Ingestion/tools/fetchTools.js';

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

/** Minimum events to consider a candidate worth promoting. */
export const MIN_EVENTS_TO_PROMOTE = 10;

/** Hard timeout for fetchHtml during promote — keep this low (5s default). */
const PROMOTE_FETCH_TIMEOUT_MS = 5_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export type PromoteStatus =
  | 'promoted'        // source file written
  | 'below_threshold' // events < MIN_EVENTS_TO_PROMOTE, candidate marked
  | 'fetch_failed'    // could not fetch HTML
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
  /** Override the default fetch timeout (default 5s). */
  fetchTimeoutMs?: number;
  /** Skip side-effects (no source write, no mark, no log). */
  dryRun?: boolean;
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function promoteOne(
  candidate: DiscoveryCandidate,
  options: PromoteOptions = {},
): Promise<PromoteResult> {
  const minEvents = options.minEvents ?? MIN_EVENTS_TO_PROMOTE;
  const fetchTimeout = options.fetchTimeoutMs ?? PROMOTE_FETCH_TIMEOUT_MS;
  const start = Date.now();

  try {
    const fetchResult = await fetchHtml(candidate.candidateUrl, {
      timeout: fetchTimeout,
    });
    if (!fetchResult.success || !fetchResult.html) {
      const result: PromoteResult = {
        candidateUrl: candidate.candidateUrl,
        status: 'fetch_failed',
        eventsFound: 0,
        durationMs: Date.now() - start,
        error: fetchResult.error ?? 'unknown fetch error',
      };
      logPromoteResult(candidate, result, options.dryRun);
      return result;
    }

    const eventsFound = countJsonLdEvents(fetchResult.html);

    if (eventsFound < minEvents) {
      if (!options.dryRun) {
        markCandidateTested(candidate.candidateUrl, eventsFound);
      }
      const result: PromoteResult = {
        candidateUrl: candidate.candidateUrl,
        status: 'below_threshold',
        eventsFound,
        durationMs: Date.now() - start,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: PromoteResult = {
      candidateUrl: candidate.candidateUrl,
      status: 'error',
      eventsFound: 0,
      durationMs: Date.now() - start,
      error: message,
    };
    logPromoteResult(candidate, result, options.dryRun);
    return result;
  }
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

// ─── JSON-LD event counter (mirrors heal.ts — kept local to avoid coupling) ─

function countJsonLdEvents(html: string): number {
  let count = 0;
  try {
    const $ = load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      const text = $(el).contents().text();
      try {
        const parsed = JSON.parse(text);
        count += collectEventNodes(parsed);
      } catch {
        // skip non-JSON blocks
      }
    });
  } catch {
    return 0;
  }
  return count;
}

function collectEventNodes(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) {
    return node.reduce((acc, n) => acc + collectEventNodes(n), 0);
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isEvent =
    type === 'Event' ||
    (Array.isArray(type) && type.includes('Event'));
  let n = isEvent ? 1 : 0;
  if (Array.isArray(obj['@graph'])) {
    n += (obj['@graph'] as unknown[]).reduce(
      (acc, child) => acc + collectEventNodes(child),
      0,
    );
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      n += collectEventNodes(value);
    }
  }
  return n;
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
    preferredPathReason: `T0095 discovery-agent promote: ${eventsFound} JSON-LD events found`,
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
