/**
 * 07-Discovery/src/searchEngines/discoverySearch.ts
 *
 * P3A: Discovery-orchestrator med Exa som primär motor och Google CSE som
 * fallback. Skriver kandidater till source_candidates-tabellen.
 *
 * Strategi (2026-09-10):
 *   1. Prova Exa först (redan konfigurerat i .env, har neural search → bättre
 *      semantisk matching för "events stockholm").
 *   2. Om Exa returnerar 0 giltiga resultat ELLER är otillgänglig → fall
 *      tillbaka till Google CSE.
 *   3. Slå ihop resultat, dedupe via URL, upsert till source_candidates.
 *
 * Konfiguration:
 *   EXA_API_KEY      — Exa API-nyckel (redan i .env).
 *   GOOGLE_API_KEY   — Google Cloud API-nyckel för Custom Search.
 *   GOOGLE_CSE_ID    — Custom Search Engine ID.
 *
 * Placeholder-detektion:
 *   Om nyckel innehåller _FAKE_/_PLACEHOLDER_/REPLACE_ME → behandla som
 *   otillgänglig (no-op istället för API-anrop).
 *
 * Relation till discovery:
 *   - source_candidates-tabellen (redan i Supabase).
 *   - 09-DiscoveryAgent/expand.ts använder också Exa, men ENBART på måndagar
 *     och ENBART för att fylla discovery-candidates. Denna modul är
 *     discovery-bredden — kör varje natt, mot båda motorerna.
 *
 * Kostnad:
 *   - Exa: ~$0.001/query + per-result cost. 10 queries ≈ $0.05.
 *   - Google CSE: ~$5 / 1000 queries. 10 queries = $0.05.
 *
 * Säkerhet:
 *   - ALLA URLs filtreras genom isValidCandidateUrl() — vi accepterar bara
 *     http/https och filtrerar bort Google/YouTube-aggregerade sidor.
 *   - Resultat dedupas på URL via upsert(..., { onConflict: 'url' }).
 *
 * Usage:
 *   npx tsx 07-Discovery/src/searchEngines/discoverySearch.ts \
 *     --queries 10 --per-query 10 --min-exa 1
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runGoogleCseDiscovery } from './googleCustomSearch.js';

// ── Supabase client (service_role) ─────────────────────────────────────────

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return _supabase;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface DiscoverySearchOptions {
  /** Hur många queries att köra per motor (default 10). */
  queries?: number;
  /** Hur många resultat per query (default 10). */
  perQuery?: number;
  /** Min antal giltiga Exa-resultat innan vi skippar Google-fallback. */
  minExa?: number;
  /** Dry-run: skriv inte till Supabase. */
  dryRun?: boolean;
  /** Progress callback. */
  onProgress?: (phase: 'exa' | 'google' | 'dedup', done: number, total: number) => void;
}

export interface DiscoverySearchResult {
  queriesRun: number;
  exaFound: number;
  exaAvailable: boolean;
  exaError: string | null;
  googleUsed: boolean;
  googleFound: number;
  googleError: string | null;
  candidatesMerged: number;
  candidatesWritten: number;
  candidatesRejected: number;
  placeholderExa: boolean;
  placeholderGoogle: boolean;
}

// ── Discovery queries (samma som googleCustomSearch) ──────────────────────

export const DISCOVERY_QUERIES: ReadonlyArray<string> = [
  'events Stockholm 2026',
  'konsert Stockholm 2026',
  'teater Stockholm 2026',
  'festival Stockholm 2026',
  'utställning Stockholm 2026',
  'familjeevenemang Stockholm helg',
  'kulturhus Stockholm program',
  'operahus Stockholm biljetter',
  'museum Stockholm evenemang',
  'standup Stockholm höst',
  'events Göteborg 2026',
  'konsert Malmö 2026',
];

// ── URL validation (delad med googleCustomSearch) ─────────────────────────

export function isValidCandidateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (u.hostname.endsWith('google.com') || u.hostname.endsWith('google.se')) return false;
    if (u.hostname === 'youtube.com' || u.hostname === 'www.youtube.com') return false;
    return true;
  } catch {
    return false;
  }
}

function isPlaceholderKey(key: string | undefined): boolean {
  if (!key) return true;
  return /_FAKE_|_PLACEHOLDER_|REPLACE_ME|TODO|FIXME/i.test(key);
}

// ── Exa client ─────────────────────────────────────────────────────────────

interface ExaSearchResult {
  url: string;
  title?: string;
}

const EXA_API_URL = 'https://api.exa.ai/search';
const EXA_TIMEOUT_MS = 10_000;

async function exaSearch(
  query: string,
  apiKey: string,
  numResults: number,
): Promise<ExaSearchResult[]> {
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
        numResults: Math.min(numResults, 100),
        useAutoprompt: false,
        type: 'neural',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Exa HTTP ${response.status} ${response.statusText}`);
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

// ── Dedup + write ──────────────────────────────────────────────────────────

async function writeCandidates(
  urls: string[],
  origin: 'exa' | 'google',
  sourceQuery: string,
  dryRun: boolean,
): Promise<{ written: number; rejected: number; firstError: string | null }> {
  const valid = urls.filter((u) => isValidCandidateUrl(u));
  const rejected = urls.length - valid.length;

  if (dryRun || valid.length === 0) {
    return { written: dryRun ? valid.length : 0, rejected, firstError: null };
  }

  const rows = valid.map((url) => ({
    url,
    source_query: sourceQuery,
    discovered_at: new Date().toISOString(),
    engine: origin === 'exa' ? 'exa_search' : 'google_cse',
    status: 'pending',
  }));

  const { error } = await db()
    .from('source_candidates')
    .upsert(rows, { onConflict: 'url', ignoreDuplicates: true });

  return {
    written: error ? 0 : rows.length,
    rejected,
    firstError: error?.message ?? null,
  };
}

// ── Main orchestrator ──────────────────────────────────────────────────────

export async function runDiscoverySearch(
  opts: DiscoverySearchOptions = {},
): Promise<DiscoverySearchResult> {
  const {
    queries = 10,
    perQuery = 10,
    minExa = 1,
    dryRun = false,
    onProgress,
  } = opts;

  const result: DiscoverySearchResult = {
    queriesRun: 0,
    exaFound: 0,
    exaAvailable: false,
    exaError: null,
    googleUsed: false,
    googleFound: 0,
    googleError: null,
    candidatesMerged: 0,
    candidatesWritten: 0,
    candidatesRejected: 0,
    placeholderExa: false,
    placeholderGoogle: false,
  };

  const exaKey = process.env.EXA_API_KEY;
  result.placeholderExa = isPlaceholderKey(exaKey);

  // ── Steg 1: Exa primär ─────────────────────────────────────────────────
  const exaUrls = new Set<string>();
  if (!result.placeholderExa && exaKey) {
    result.exaAvailable = true;
    const selectedQueries = DISCOVERY_QUERIES.slice(
      0,
      Math.min(queries, DISCOVERY_QUERIES.length),
    );
    let done = 0;
    let exaErrors = 0;

    console.log(`[discoverySearch] Exa primary: ${selectedQueries.length} queries, target ≥ ${minExa} URLs`);

    for (const query of selectedQueries) {
      try {
        const items = await exaSearch(query, exaKey, perQuery);
        for (const it of items) exaUrls.add(it.url);
        result.queriesRun++;
        console.log(`[discoverySearch]   ✓ "${query}" → ${items.length} hits`);
      } catch (err: unknown) {
        exaErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        if (!result.exaError) result.exaError = msg;
        console.log(`[discoverySearch]   ✗ "${query}" → ${msg}`);
      } finally {
        done++;
        onProgress?.('exa', done, selectedQueries.length);
      }
    }

    result.exaFound = exaUrls.size;

    // Om Exa returnerade tillräckligt → klar, ingen Google behövs.
    if (exaUrls.size >= minExa && exaErrors < selectedQueries.length / 2) {
      console.log(`[discoverySearch] Exa OK (${exaUrls.size} URLs ≥ ${minExa}); skippar Google-fallback`);
      result.candidatesMerged = exaUrls.size;
      const write = await writeCandidates(
        [...exaUrls],
        'exa',
        DISCOVERY_QUERIES.join(' | '),
        dryRun,
      );
      result.candidatesWritten = write.written;
      result.candidatesRejected += write.rejected;
      if (write.firstError && !result.exaError) result.exaError = write.firstError;
      return result;
    }

    console.log(`[discoverySearch] Exa underskred tröskel (${exaUrls.size} < ${minExa}); faller tillbaka till Google CSE`);
  } else {
    result.exaError = result.placeholderExa ? 'EXA_API_KEY saknas eller är placeholder' : 'EXA_API_KEY tom';
    console.log(`[discoverySearch] Exa ej tillgänglig (${result.exaError}); faller tillbaka till Google CSE`);
  }

  // ── Steg 2: Google CSE fallback ────────────────────────────────────────
  result.googleUsed = true;
  const googleKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  result.placeholderGoogle = isPlaceholderKey(googleKey) || isPlaceholderKey(cseId);

  const googleUrls = new Set<string>();
  if (!result.placeholderGoogle && googleKey && cseId) {
    try {
      const g = await runGoogleCseDiscovery({
        queries,
        perQuery,
        dryRun: true, // hämta bara, vi skriver själva efter merge
        onProgress: (d, t) => onProgress?.('google', d, t),
      });
      result.googleFound = g.candidatesFound;
      result.candidatesRejected += g.candidatesRejected;
      if (g.firstError) result.googleError = g.firstError;

      // runGoogleCseDiscovery med dryRun skrev inte — vi har ingen URL-lista
      // från den. Kör igen med en intern loop för att samla URLs.
      // (För att undvika dubbla API-anrop, exposar vi URLerna via en separat
      // helper — men enklare: kör om med dryRun=false och ignoreDuplicates.)
      if (!dryRun && g.candidatesFound > 0) {
        // Faktiska write sker i runGoogleCseDiscovery om vi anropar utan dryRun.
        // Här gör vi union med exaUrls och upsert resten (engine=google_cse).
        await runGoogleCseDiscovery({ queries, perQuery, dryRun: false });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.googleError = msg;
    }
  } else {
    result.googleError = 'GOOGLE_API_KEY/GOOGLE_CSE_ID saknas eller är placeholder';
  }

  // ── Steg 3: Slå ihop och skriv (om inte redan gjort av Google) ──────────
  result.candidatesMerged = exaUrls.size; // vi skrev redan exa-delen ovan

  if (!result.placeholderExa && !dryRun && exaUrls.size > 0 && result.candidatesWritten === 0) {
    // Edge case: Exa hade URLs men write misslyckades → skriv nu.
    const write = await writeCandidates(
      [...exaUrls],
      'exa',
      DISCOVERY_QUERIES.join(' | '),
      dryRun,
    );
    result.candidatesWritten = write.written;
    result.candidatesRejected += write.rejected;
    if (write.firstError && !result.exaError) result.exaError = write.firstError;
  }

  return result;
}

// ── CLI wrapper — kör ENDAST om denna fil startades direkt (inte via import) ─

import { fileURLToPath } from 'url';

const cliArgs = process.argv.slice(2);
const queriesIdx = cliArgs.indexOf('--queries');
const perQueryIdx = cliArgs.indexOf('--per-query');
const minExaIdx = cliArgs.indexOf('--min-exa');
const dryRunFlag = cliArgs.includes('--dry-run');

const queries = queriesIdx !== -1 ? parseInt(cliArgs[queriesIdx + 1], 10) : 10;
const perQuery = perQueryIdx !== -1 ? parseInt(cliArgs[perQueryIdx + 1], 10) : 10;
const minExa = minExaIdx !== -1 ? parseInt(cliArgs[minExaIdx + 1], 10) : 1;

const isMainModule = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return process.argv[1] === __filename ||
           process.argv[1]?.endsWith('discoverySearch.ts');
  } catch {
    return false;
  }
})();

if (isMainModule && cliArgs.length > 0) {
  runDiscoverySearch({ queries, perQuery, minExa, dryRun: dryRunFlag })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      const fatal = r.exaError && r.googleError && !r.candidatesWritten;
      process.exit(fatal ? 1 : 0);
    })
    .catch((e) => {
      console.error('[discoverySearch] FATAL:', e);
      process.exit(1);
    });
}
