/**
 * 09-DiscoveryAgent/expand.ts — Weekly seed expansion via Exa.
 *
 * Runs only on Mondays (unless force=true). Calls Exa REST search for Stockholm
 * event venues, dedupes against existing source hosts, and appends new URLs to
 * runtime/discovery-candidates.jsonl as 'exa-search' origin. The promote
 * pipeline picks them up the same day via readUnexploredCandidates().
 *
 * Graceful degradation: if EXA_API_KEY is missing or Exa returns an error,
 * expandSeeds returns exaAvailable=false (or the error) and writes nothing.
 * Never throws — expansion is best-effort.
 *
 * Cap: max 5 new seeds per call. Dedup is by host (ignoring www).
 */

import { writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getAllSources } from '../02-Ingestion/tools/sourceRegistry.js';

import {
  appendRun,
  nowIso,
  readAllCandidates,
  type DiscoveryCandidate,
} from './eval.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const DISCOVERY_CANDIDATES_FILE = path.resolve(RUNTIME_DIR, 'discovery-candidates.jsonl');

const EXA_API_URL = 'https://api.exa.ai/search';
const EXA_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_NEW = 5;

const DEFAULT_QUERIES = [
  'stockholm event venue calendar site:se',
  'stockholm konsert program',
  'stockholm teater forestallning kalender',
];

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ExpandOptions {
  /** Skip Monday gate. */
  force?: boolean;
  /** Override cap. Default 5. */
  maxNew?: number;
  /** Skip FS writes (for tests/dry-run). */
  dryRun?: boolean;
  /** Override Exa search queries. */
  queries?: string[];
}

export interface ExpandResult {
  seedsFound: number;
  newCandidates: Array<{ url: string; sourceId: string }>;
  alreadyKnown: number;
  durationMs: number;
  exaAvailable: boolean;
  error?: string;
}

// ─── Entry point ───────────────────────────────────────────────────────────

export async function expandSeeds(options: ExpandOptions = {}): Promise<ExpandResult> {
  const start = Date.now();
  const maxNew = options.maxNew ?? DEFAULT_MAX_NEW;

  if (!options.force && !isMonday(new Date())) {
    return {
      seedsFound: 0,
      newCandidates: [],
      alreadyKnown: 0,
      durationMs: Date.now() - start,
      exaAvailable: isExaConfigured(),
    };
  }

  const queries = options.queries ?? DEFAULT_QUERIES;
  const apiKey = process.env.EXA_API_KEY ?? '';
  if (!apiKey) {
    const result: ExpandResult = {
      seedsFound: 0,
      newCandidates: [],
      alreadyKnown: 0,
      durationMs: Date.now() - start,
      exaAvailable: false,
      error: 'EXA_API_KEY not configured',
    };
    logExpand(result, options.dryRun);
    return result;
  }

  let exaResults: ExaSearchResult[];
  try {
    exaResults = [];
    for (const q of queries) {
      const r = await exaSearch(q, apiKey);
      exaResults.push(...r);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: ExpandResult = {
      seedsFound: 0,
      newCandidates: [],
      alreadyKnown: 0,
      durationMs: Date.now() - start,
      exaAvailable: true,
      error: `Exa search failed: ${message}`,
    };
    logExpand(result, options.dryRun);
    return result;
  }

  const knownHosts = collectKnownHosts();
  const newCandidates: Array<{ url: string; sourceId: string }> = [];
  let alreadyKnown = 0;

  for (const hit of exaResults) {
    if (newCandidates.length >= maxNew) break;
    const host = safeHost(hit.url);
    if (!host || knownHosts.has(host)) {
      alreadyKnown += 1;
      continue;
    }
    knownHosts.add(host);
    const sourceId = `exa-${slugFromUrl(hit.url)}`;
    newCandidates.push({ url: hit.url, sourceId });
  }

  if (!options.dryRun && newCandidates.length > 0) {
    appendCandidates(newCandidates);
  }

  const result: ExpandResult = {
    seedsFound: exaResults.length,
    newCandidates,
    alreadyKnown,
    durationMs: Date.now() - start,
    exaAvailable: true,
  };
  logExpand(result, options.dryRun);
  return result;
}

// ─── Audit ─────────────────────────────────────────────────────────────────

function logExpand(result: ExpandResult, dryRun: boolean | undefined): void {
  if (dryRun) return;
  appendRun({
    ts: nowIso(),
    phase: 'expand',
    durationMs: result.durationMs,
    before: { exaAvailable: result.exaAvailable },
    after: {
      seedsFound: result.seedsFound,
      newCount: result.newCandidates.length,
      alreadyKnown: result.alreadyKnown,
    },
    error: result.error,
    dryRun: false,
  });
}

// ─── Exa client ────────────────────────────────────────────────────────────

interface ExaSearchResult {
  url: string;
  title?: string;
}

async function exaSearch(query: string, apiKey: string): Promise<ExaSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXA_TIMEOUT_MS);
  try {
    const response = await fetch(EXA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        numResults: 10,
        useAutoprompt: false,
        type: 'neural',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { results?: Array<{ url?: string; title?: string }> };
    const results = data.results ?? [];
    return results
      .filter((r): r is { url: string; title?: string } => typeof r.url === 'string')
      .map((r) => ({ url: r.url, title: r.title }));
  } finally {
    clearTimeout(timer);
  }
}

// ─── Dedup + candidate append ──────────────────────────────────────────────

function collectKnownHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const src of getAllSources()) {
    const h = safeHost(src.url);
    if (h) hosts.add(h);
  }
  for (const cand of readAllCandidates()) {
    const h = safeHost(cand.candidateUrl);
    if (h) hosts.add(h);
  }
  return hosts;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function slugFromUrl(url: string): string {
  return safeHost(url)?.replace(/\./g, '-') ?? 'unknown';
}

function appendCandidates(
  newCandidates: Array<{ url: string; sourceId: string }>,
): void {
  const existing: DiscoveryCandidate[] = existsSync(DISCOVERY_CANDIDATES_FILE)
    ? readAllCandidates()
    : [];
  const now = nowIso();
  const appended: DiscoveryCandidate[] = newCandidates.map((c) => ({
    sourceId: c.sourceId,
    candidateUrl: c.url,
    score: 0,
    productivity: 0,
    stability: 0,
    discoveredAt: now,
    reason: 'exa-search seed expansion',
    candidateOrigin: 'exa-search',
  }));
  const all = [...existing, ...appended];
  writeFileSync(
    DISCOVERY_CANDIDATES_FILE,
    all.map((c) => JSON.stringify(c)).join('\n') + '\n',
    'utf-8',
  );
}

// ─── Schedule helpers ──────────────────────────────────────────────────────

function isMonday(d: Date): boolean {
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat
  return d.getUTCDay() === 1;
}

function isExaConfigured(): boolean {
  const key = process.env.EXA_API_KEY ?? '';
  return key.trim().length > 0;
}
