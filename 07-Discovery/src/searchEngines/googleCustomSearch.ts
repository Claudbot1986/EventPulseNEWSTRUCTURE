/**
 * 07-Discovery/src/searchEngines/googleCustomSearch.ts
 *
 * P3A: Google Custom Search API som discovery-motor.
 *
 * Syfte: hitta NYA venues i Stockholm via Google CSE istället för att bara
 * crawla inom redan kända sajter. Skriver kandidater till source_candidates.
 *
 * Konfiguration (krävs för riktig körning):
 *   GOOGLE_API_KEY   — Google Cloud API-nyckel med Custom Search API aktiverat
 *   GOOGLE_CSE_ID    — Custom Search Engine ID (https://programmablesearchengine.google.com)
 *
 * Om nycklar saknas eller är placeholder (innehåller "_FAKE_" / "_PLACEHOLDER_")
 * kör modulen som no-op och loggar tydligt i stdout. Detta gör att cronjobbet
 * 02:30 inte kraschar bara för att användaren inte hunnit sätta nycklar.
 *
 * Kostnad: ~$5 / 1000 queries. --queries 10 --per-query 10 = 100 queries/natt.
 *
 * Säkerhet: ALLA resultat går genom VenueCandidate-validation innan de skrivs
 * till source_candidates. Vi accepterar bara URLs som har en rimlig struktur
 * (http/https, domän ≠ google.com självt).
 *
 * Relation till discovery:
 *   - source_candidates-tabellen finns redan i Supabase (BACKLOG verifierat).
 *   - Denna modul producerar ENBART förslag; godkännande sker manuellt eller
 *     via 09-ScrapingSupervisor/ai-source-review.
 *
 * Usage:
 *   GOOGLE_API_KEY=... GOOGLE_CSE_ID=... \
 *     npx tsx 07-Discovery/src/searchEngines/googleCustomSearch.ts \
 *       --queries 10 --per-query 10
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface GoogleCseOptions {
  /** Hur många queries att köra (default 10). */
  queries?: number;
  /** Hur många resultat per query (default 10, max 10 per Google API). */
  perQuery?: number;
  /** Dry-run: skriv inte till Supabase (default false). */
  dryRun?: boolean;
  /** Progress callback. */
  onProgress?: (done: number, total: number) => void;
}

export interface GoogleCseResult {
  queriesRun: number;
  candidatesFound: number;
  candidatesWritten: number;
  candidatesRejected: number;
  placeholderKeys: boolean;
  firstError: string | null;
  skippedQueries: string[];
}

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

// ── Discovery queries ──────────────────────────────────────────────────────

const DISCOVERY_QUERIES: ReadonlyArray<string> = [
  // Events i Stockholm
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

  // Mindre städer (Phase 2)
  'events Göteborg 2026',
  'konsert Malmö 2026',
  'festival Uppsala 2026',
];

/**
 * Validerar URL innan vi skickar den vidare till source_candidates.
 * Accepterar bara http/https och filtrerar bort Google-aggregerade sidor.
 */
function isValidCandidateUrl(url: string): boolean {
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

// ── Google CSE API call ────────────────────────────────────────────────────

interface GoogleCseItem {
  link: string;
  title?: string;
  snippet?: string;
  displayLink?: string;
}

interface GoogleCseResponse {
  items?: GoogleCseItem[];
  searchInformation?: { totalResults?: string };
  error?: { code: number; message: string };
}

async function googleCseQuery(
  query: string,
  apiKey: string,
  cseId: string,
  num: number,
): Promise<GoogleCseItem[]> {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cseId);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(num, 10)));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google CSE HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as GoogleCseResponse;
  if (data.error) {
    throw new Error(`Google CSE error ${data.error.code}: ${data.error.message}`);
  }
  return data.items ?? [];
}

// ── Main entrypoint ─────────────────────────────────────────────────────────

export async function runGoogleCseDiscovery(opts: GoogleCseOptions = {}): Promise<GoogleCseResult> {
  const {
    queries = 10,
    perQuery = 10,
    dryRun = false,
    onProgress,
  } = opts;

  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  const placeholderKeys = isPlaceholderKey(apiKey) || isPlaceholderKey(cseId);

  const result: GoogleCseResult = {
    queriesRun: 0,
    candidatesFound: 0,
    candidatesWritten: 0,
    candidatesRejected: 0,
    placeholderKeys,
    firstError: null,
    skippedQueries: [],
  };

  if (placeholderKeys) {
    console.log(
      '[googleCustomSearch] no-op: GOOGLE_API_KEY/GOOGLE_CSE_ID saknas eller är placeholder. ' +
        'Sätt riktiga nycklar för att aktivera discovery.',
    );
    return result;
  }

  const selectedQueries = DISCOVERY_QUERIES.slice(0, Math.min(queries, DISCOVERY_QUERIES.length));
  let done = 0;

  for (const query of selectedQueries) {
    try {
      const items = await googleCseQuery(query, apiKey!, cseId!, perQuery);
      result.queriesRun++;
      result.candidatesFound += items.length;

      const validUrls = items
        .map((it) => it.link)
        .filter((u) => isValidCandidateUrl(u));
      result.candidatesRejected += items.length - validUrls.length;

      if (!dryRun && validUrls.length > 0) {
        const rows = validUrls.map((url) => ({
          url,
          source_query: query,
          discovered_at: new Date().toISOString(),
          engine: 'google_cse',
          status: 'pending',
        }));

        // Upsert på url för att undvika dubbletter
        const { error } = await db()
          .from('source_candidates')
          .upsert(rows, { onConflict: 'url', ignoreDuplicates: true });

        if (error) {
          if (!result.firstError) result.firstError = error.message;
        } else {
          result.candidatesWritten += rows.length;
        }
      } else if (dryRun) {
        result.candidatesWritten += validUrls.length;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!result.firstError) result.firstError = msg;
      result.skippedQueries.push(query);
    } finally {
      done++;
      onProgress?.(done, selectedQueries.length);
    }
  }

  return result;
}

// ── CLI wrapper ─────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
const queriesIdx = cliArgs.indexOf('--queries');
const perQueryIdx = cliArgs.indexOf('--per-query');
const dryRunFlag = cliArgs.includes('--dry-run');

const queries = queriesIdx !== -1 ? parseInt(cliArgs[queriesIdx + 1], 10) : 10;
const perQuery = perQueryIdx !== -1 ? parseInt(cliArgs[perQueryIdx + 1], 10) : 10;

if (cliArgs.length > 0) {
  runGoogleCseDiscovery({ queries, perQuery, dryRun: dryRunFlag })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.firstError ? 1 : 0);
    })
    .catch((e) => {
      console.error('[googleCustomSearch] FATAL:', e);
      process.exit(1);
    });
}
