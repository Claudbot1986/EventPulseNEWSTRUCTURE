/**
 * 09-DiscoveryAgent/exaLookup.ts — Per-source Exa URL discovery (Fas 4).
 *
 * When heal tier 2 (C0 candidate discovery on the source's current URL) returns
 * no winner, the most common failure pattern is "wrong URL on right domain"
 * (e.g. riksarkivet.se/evenemang has 0 events but /kalendarium does). This
 * module runs a targeted Exa search for the source's name + "evenemang" and
 * returns sibling-domain URLs that the heal pipeline can re-try through C0 +
 * constrainedAgent.
 *
 * Same-domain filter: only URLs whose host matches the source's host are
 * returned — we trust Exa for finding better paths, not for finding new
 * domains (expand.ts already handles new-domain discovery).
 *
 * Graceful: returns empty `urls` when EXA_API_KEY is missing or Exa returns
 * an error. Never throws — heal falls back to the original tier-2 'deferred'
 * state and the source keeps its current URL.
 *
 * Cap: max 3 URLs per call. Exa is cheap but we keep this bounded so a
 * failing source can't blow the 60s heal-t2 budget on a slow search.
 */

const EXA_API_URL = 'https://api.exa.ai/search';
const EXA_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_URLS = 3;
const EXA_NUM_RESULTS = 8;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ExaLookupSource {
  id: string;
  url: string;
  name?: string;
}

export interface ExaLookupResult {
  /** Same-domain URLs discovered via Exa, capped at maxUrls. */
  urls: string[];
  /** Queries that were sent (for audit/debugging). */
  queries: string[];
  /** Wall-clock duration of the lookup. */
  durationMs: number;
  /** True if EXA_API_KEY was present. False → urls is always []. */
  exaAvailable: boolean;
  /** Set when Exa returned an error or key was missing. */
  error?: string;
  /** Total Exa hits before same-domain filter, for visibility. */
  rawHitCount?: number;
}

export interface ExaLookupOptions {
  /** Override cap. Default 3. */
  maxUrls?: number;
}

// ─── Entry point ───────────────────────────────────────────────────────────

/**
 * Search Exa for the source's real event-listing URL on the same domain.
 * Returns same-domain URLs only (host match, www-normalized).
 *
 * Never throws. Result.exaAvailable=false or result.error set signals that
 * the caller should treat the lookup as "no candidates found".
 */
export async function lookupSourceUrl(
  source: ExaLookupSource,
  options: ExaLookupOptions = {},
): Promise<ExaLookupResult> {
  const start = Date.now();
  const maxUrls = options.maxUrls ?? DEFAULT_MAX_URLS;
  const apiKey = process.env.EXA_API_KEY ?? '';

  if (!apiKey.trim()) {
    return {
      urls: [],
      queries: [],
      durationMs: Date.now() - start,
      exaAvailable: false,
      error: 'EXA_API_KEY not configured',
    };
  }

  const queries = buildQueries(source);
  const sourceHost = safeHost(source.url);

  let allResults: ExaHit[];
  try {
    allResults = [];
    for (const q of queries) {
      const hits = await exaSearch(q, apiKey);
      allResults.push(...hits);
    }
  } catch (err) {
    return {
      urls: [],
      queries,
      durationMs: Date.now() - start,
      exaAvailable: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Same-domain dedup, preserve first-seen order (Exa relevance).
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const hit of allResults) {
    if (urls.length >= maxUrls) break;
    const host = safeHost(hit.url);
    if (!host) continue;
    if (sourceHost && host !== sourceHost) continue;
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    // Skip the source's own URL — Exa will sometimes echo it back.
    if (normalizeUrl(hit.url) === normalizeUrl(source.url)) continue;
    urls.push(hit.url);
  }

  return {
    urls,
    queries,
    durationMs: Date.now() - start,
    exaAvailable: true,
    rawHitCount: allResults.length,
  };
}

// ─── Query builder ─────────────────────────────────────────────────────────

/**
 * Build 2-3 search queries from the source's name and host.
 * Exported for tests so we don't depend on private implementation.
 */
export function buildQueries(source: ExaLookupSource): string[] {
  const queries: string[] = [];
  const host = safeHost(source.url) ?? '';
  const name = (source.name ?? source.id ?? '').trim();

  // Strip common org suffixes that add noise to neural search.
  const cleanName = name
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\s+(AB|HB|KB|Ek\.?\s*för\.?)\s*$/i, '')
    .trim();

  if (cleanName.length > 0) {
    queries.push(`${cleanName} evenemang kalender`);
    queries.push(`${cleanName} program foreställning`);
  }
  if (host.length > 0) {
    queries.push(`site:${host} evenemang kalender`);
  }
  return queries;
}

// ─── URL helpers (exported for tests) ──────────────────────────────────────

export function safeHost(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, '').toLowerCase() + u.pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

// ─── Exa client ────────────────────────────────────────────────────────────

interface ExaHit {
  url: string;
  title?: string;
}

async function exaSearch(query: string, apiKey: string): Promise<ExaHit[]> {
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
        numResults: EXA_NUM_RESULTS,
        useAutoprompt: false,
        type: 'neural',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as {
      results?: Array<{ url?: string; title?: string }>;
    };
    const results = data.results ?? [];
    return results
      .filter((r): r is { url: string; title?: string } => typeof r.url === 'string')
      .map((r) => ({ url: r.url, title: r.title }));
  } finally {
    clearTimeout(timer);
  }
}
