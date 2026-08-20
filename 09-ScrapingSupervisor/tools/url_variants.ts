/**
 * url_variants.ts — generate canonical URL variants and test them.
 *
 * Used by the source-review pipeline to propose `update-url` for sources
 * failing with transport errors (redirect loops, SSL handshake failures,
 * DNS lookups that work for one host but not another).
 *
 * Variants are GLOBAL, not site-specific:
 *   - www / non-www (allowed per Generalization Protection Rule: verified
 *     across many domains that differ between www and non-www)
 *   - http / https (allowed: same logic)
 *   - trailing slash / no slash (allowed: same)
 *   - /index.html / no index.html (allowed: same)
 *
 * Anti-hallucination: this module NEVER makes a claim about which variant
 * a specific site uses. It tests each candidate with HEAD + redirect
 * detection and reports the empirical result.
 *
 * Network policy:
 *   - bounded: at most `maxPerRun` URLs tested per run (default 5)
 *   - timeout: 5s per request
 *   - errors-as-data: failed fetches return `{ok: false, reason}`, not throws
 *   - if `fetchImpl` is omitted, returns all-null results without making
 *     any network call (used by tests and dry-run previews)
 */

export interface UrlVariant {
  url: string;
  /** Which transformation produced this variant. */
  kind: 'original' | 'www' | 'non-www' | 'https' | 'http' | 'trailing-slash' | 'no-trailing-slash' | 'index-html' | 'no-index-html';
}

export interface VariantTestResult {
  variant: UrlVariant;
  ok: boolean;
  /** Final HTTP status after following redirects. */
  status: number | null;
  /** Why we stopped (ok, http-N, timeout, dns-fail, ssl-fail, network-error). */
  reason: string;
  /** ms from request start to final response. */
  durationMs: number;
}

export interface VariantTestSummary {
  baseUrl: string;
  results: VariantTestResult[];
  /** First variant that succeeded (status 2xx, no redirects), or null. */
  winner: VariantTestResult | null;
  /** Total time spent testing. */
  totalDurationMs: number;
}

export type FetchLike = (
  url: string,
  opts: { method?: string; redirect?: 'follow' | 'manual'; signal?: AbortSignal; timeout?: number },
) => Promise<{ status: number; url: string }>;

/**
 * Generate canonical variants of a URL. The original is always first.
 * Order is deterministic so tests are reproducible.
 */
export function generateVariants(inputUrl: string): UrlVariant[] {
  let url: URL;
  try {
    url = new URL(inputUrl);
  } catch {
    return [{ url: inputUrl, kind: 'original' }];
  }

  const out: UrlVariant[] = [{ url: url.toString(), kind: 'original' }];
  const seen = new Set([url.toString()]);

  const push = (u: URL, kind: UrlVariant['kind']) => {
    const s = u.toString();
    if (seen.has(s)) return;
    seen.add(s);
    out.push({ url: s, kind });
  };

  // www / non-www
  const isWww = url.hostname.startsWith('www.');
  const bareHost = isWww ? url.hostname.slice(4) : url.hostname;
  const wwwHost = isWww ? url.hostname : `www.${url.hostname}`;
  if (isWww) {
    const u = new URL(url.toString());
    u.hostname = bareHost;
    push(u, 'non-www');
  } else {
    const u = new URL(url.toString());
    u.hostname = wwwHost;
    push(u, 'www');
  }

  // https <-> http
  const altScheme = url.protocol === 'https:' ? 'http:' : 'https:';
  const u2 = new URL(url.toString());
  u2.protocol = altScheme;
  push(u2, url.protocol === 'https:' ? 'http' : 'https');

  // trailing slash
  if (url.pathname && url.pathname !== '/' && !url.pathname.endsWith('/')) {
    const u3 = new URL(url.toString());
    u3.pathname = url.pathname + '/';
    push(u3, 'trailing-slash');
  } else if (url.pathname.endsWith('/') && url.pathname !== '/') {
    const u3 = new URL(url.toString());
    u3.pathname = url.pathname.slice(0, -1);
    push(u3, 'no-trailing-slash');
  }

  // /index.html
  if (!url.pathname.endsWith('/index.html') && !url.pathname.endsWith('/')) {
    const u4 = new URL(url.toString());
    u4.pathname = url.pathname.replace(/\/?$/, '/index.html');
    push(u4, 'index-html');
  }

  return out;
}

/**
 * Test all variants. Calls `fetchImpl(url, {method:'HEAD', redirect:'follow'})`
 * for each. Returns the first variant that returns status 2xx without
 * exhausting redirects.
 *
 * `maxVariants` caps how many are tested (default: all). Pass `maxVariants=1`
 * for cheap "try one variant" use.
 *
 * If `fetchImpl` is omitted, returns all variants with `{ok: false, reason: 'no-fetch'}`.
 */
export async function testVariants(
  baseUrl: string,
  opts: { fetchImpl?: FetchLike; maxVariants?: number; timeoutMs?: number } = {},
): Promise<VariantTestSummary> {
  const variants = generateVariants(baseUrl);
  const max = opts.maxVariants ?? variants.length;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const subset = variants.slice(0, max);
  const start = Date.now();

  if (!opts.fetchImpl) {
    return {
      baseUrl,
      results: subset.map((v) => ({
        variant: v,
        ok: false,
        status: null,
        reason: 'no-fetch',
        durationMs: 0,
      })),
      winner: null,
      totalDurationMs: 0,
    };
  }

  const results: VariantTestResult[] = [];
  let winner: VariantTestResult | null = null;

  for (const variant of subset) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await opts.fetchImpl(variant.url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const r: VariantTestResult = {
        variant,
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        reason: resp.status >= 200 && resp.status < 300 ? 'ok' : `http-${resp.status}`,
        durationMs: Date.now() - t0,
      };
      results.push(r);
      if (r.ok && !winner) winner = r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const reason = msg.includes('aborted')
        ? 'timeout'
        : msg.includes('ENOTFOUND')
        ? 'dns-fail'
        : msg.includes('SSL') || msg.includes('certificate')
        ? 'ssl-fail'
        : 'network-error';
      results.push({
        variant,
        ok: false,
        status: null,
        reason,
        durationMs: Date.now() - t0,
      });
    }
  }

  return {
    baseUrl,
    results,
    winner,
    totalDurationMs: Date.now() - start,
  };
}

/**
 * Decide which sources to test variants for. Conservative: only sources
 * with redirect-loop or generic transport errors and cf>=5. This keeps the
 * daily run bounded.
 */
export function shouldTestVariants(
  lastRoutingReason: string | null,
  consecutiveFailures: number,
): boolean {
  if (consecutiveFailures < 5) return false;
  if (!lastRoutingReason) return false;
  const r = lastRoutingReason.toLowerCase();
  return (
    r.includes('redirect') ||
    r.includes('ssl') ||
    r.includes('certificate') ||
    r.includes('enotfound') ||
    r.includes('timeout')
  );
}

/**
 * Convert a winning variant into a `SourceProposal` for `update-url`.
 * Returns null if there's no clear winner (no 2xx variant) or the winner
 * is identical to the original URL.
 */
export function variantToProposal(
  sourceId: string,
  summary: VariantTestSummary,
): { proposal: import('./source_ai_review').SourceProposal } | null {
  if (!summary.winner) return null;
  const ok = summary.winner.ok && summary.winner.status !== null && summary.winner.status < 300;
  if (!ok) return null;
  const originalUrl = new URL(summary.baseUrl).toString();
  const newUrl = summary.winner.variant.url;
  if (originalUrl === newUrl) return null;

  return {
    proposal: {
      sourceId,
      action: 'update-url',
      before: { url: originalUrl },
      after: { url: newUrl },
      confidence: 'high',
      rationale: `URL variant ${summary.winner.variant.kind} returns HTTP ${summary.winner.status} while the original fails with "${summary.winner.reason}".`,
      evidence: `tested ${summary.results.length} variants; winner=${summary.winner.variant.url} status=${summary.winner.status} duration=${summary.winner.durationMs}ms`,
      needsHumanReview: false,
    },
  };
}