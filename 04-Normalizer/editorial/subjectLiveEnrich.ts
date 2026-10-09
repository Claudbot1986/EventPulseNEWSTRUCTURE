/**
 * subjectLiveEnrich.ts — P8.6 Open-Data Enrichment (2026-10-09).
 *
 * Vad: utökar curated subject-gazetteer med live-uppslag mot Wikidata
 *      (CC0, query.wikidata.org). När ett subject INTE finns i curated
 *      JSON → slå upp via SPARQL, cachelagra, returnera SubjectEntry.
 *
 * Skillnad mot gazetteerLiveEnrich.ts:
 *   - gazetteerLiveEnrich: MusicBrainz (CC0) — artister
 *   - subjectLiveEnrich:   Wikidata (CC0) — verk, personer, orgs, ämnen
 *
 * Säkerhet (i prioritetsordning):
 *   1. Curated JSON vinner alltid
 *   2. Live-cache (24h TTL) — samma subject slås inte upp igen
 *   3. Wikidata User-Agent: "EventPulse/1.0 (contact@eventpulse.nu)"
 *   4. Rate-limit: 1 req/200ms (Wikidata tillåter 5 req/s, vi är snälla)
 *   5. Alla nätverksfel / timeouts → null
 *   6. Resultat mappas noggrant — vi returnerar BARA CC0-data
 */
import { lookupSubject as curatedLookup } from './subjectCache';
import type { SubjectEntry, SubjectKind, SourceLicense } from './subjectCache';

const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'EventPulse/1.0 (https://eventpulse.nu/kontakt)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WIKIDATA_MIN_INTERVAL_MS = 200; // 5 req/s max, vi tar 200ms gap
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_MIN_LABELS = 1; // min antal språk-labels som måste finnas

// ─── Cache ─────────────────────────────────────────────────────────────────

interface CacheEntry {
  entry: SubjectEntry | null;
  expiresAt: number;
}

const liveCache = new Map<string, CacheEntry>();

function getFromCache(name: string): SubjectEntry | null | undefined {
  const hit = liveCache.get(name.toLowerCase());
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    liveCache.delete(name.toLowerCase());
    return undefined;
  }
  return hit.entry;
}

function setInCache(name: string, entry: SubjectEntry | null): void {
  liveCache.set(name.toLowerCase(), {
    entry,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ─── Rate-limit ────────────────────────────────────────────────────────────

let lastCallMs = 0;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallMs;
  if (elapsed < WIKIDATA_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, WIKIDATA_MIN_INTERVAL_MS - elapsed));
  }
  lastCallMs = Date.now();
}

// ─── SPARQL helpers ────────────────────────────────────────────────────────

interface WikidataSearchResult {
  qid: string;
  label: string;
  description?: string;
  instance_of?: string[];   // P31 — QIDs
  country?: string;          // P27 — first 2-char (ISO 3166-1)
  language?: string;         // P407 — first 2-char (ISO 639-1)
  inception?: number;        // P571 — year
  genre?: string[];          // P136 — labels
  occupations?: string[];    // P106 — labels
}

interface SparqlBinding {
  item?: { value: string };
  itemLabel?: { value: string };
  itemDescription?: { value: string };
  country?: { value: string };
  language?: { value: string };
  inception?: { value: string };
  genreLabel?: { value: string };
  occupationLabel?: { value: string };
}

interface SparqlResponse {
  results: {
    bindings: SparqlBinding[];
  };
}

function extractIsoCountry(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/\/Q(\d+)/);
  if (!m) return undefined;
  // Q-numbers för länder — vi mappar bara de vanligaste
  const COUNTRY_Q_TO_ISO: Record<string, string> = {
    '20': 'NO', '34': 'SE', '145': 'GB', '30': 'GR', '38': 'IT',
    '142': 'FR', '183': 'DE', '191': 'NL', '40': 'AT', '39': 'CH',
    '29': 'ES', '45': 'PT', '77': 'PL', '159': 'RU', '148': 'CN',
    '169': 'JP', '408': 'AU', '664': 'NZ', '96': 'MX', '77': 'PL',
  };
  return COUNTRY_Q_TO_ISO[m[1]] ?? undefined;
}

function extractIsoLanguage(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Språk-Q-numbers — vi mappar de vanligaste
  const LANGUAGE_Q_TO_ISO: Record<string, string> = {
    '902': 'sv', '1860': 'en', '188': 'de', '150': 'fr',
    '652': 'it', '1321': 'es', '902': 'sv', '1058': 'no',
    '903': 'da', '7979': 'fi', '335': 'is', '809': 'pl',
  };
  const m = raw.match(/\/Q(\d+)/);
  return m ? LANGUAGE_Q_TO_ISO[m[1]] : undefined;
}

/**
 * Kör SPARQL-fråga mot Wikidata. Returnerar första träffen eller null.
 */
async function sparqlQuery(sparql: string): Promise<WikidataSearchResult | null> {
  await waitForRateLimit();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = new URL(WIKIDATA_SPARQL_URL);
    url.searchParams.set('query', sparql);
    url.searchParams.set('format', 'json');

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/sparql-results+json',
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as SparqlResponse;
    if (!data.results?.bindings?.length) return null;
    const b = data.results.bindings[0]!;
    const qidMatch = b.item?.value.match(/\/(Q\d+)$/);
    if (!qidMatch) return null;
    return {
      qid: qidMatch[1]!,
      label: b.itemLabel?.value ?? '',
      description: b.itemDescription?.value,
      country: extractIsoCountry(b.country?.value),
      language: extractIsoLanguage(b.language?.value),
      inception: b.inception ? new Date(b.inception.value).getFullYear() : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Wikidata SPARQL-fråga: hitta entity som matchar name.
 * Begränsar till entity med label i svenska ELLER engelska.
 */
function buildSearchQuery(name: string): string {
  // Escape citattecken i name
  const safe = name.replace(/"/g, '\\"');
  return `
    SELECT ?item ?itemLabel ?itemDescription ?country ?language ?inception WHERE {
      ?item rdfs:label "${safe}"@sv .
      ?item rdfs:label "${safe}"@en .
      OPTIONAL { ?item wdt:P27 ?country . }
      OPTIONAL { ?item wdt:P407 ?language . }
      OPTIONAL { ?item wdt:P571 ?inception . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "sv,en" . }
    } LIMIT 1
  `.trim().replace(/\s+/g, ' ');
}

// ─── Mapping Wikidata → SubjectEntry ───────────────────────────────────────

function mapToSubjectEntry(w: WikidataSearchResult, originalName: string): SubjectEntry {
  return {
    name: w.label || originalName,
    kind: 'topic' as SubjectKind, // vi vet inte säkert utan djupare P31-analys
    country: w.country,
    language: w.language,
    inception_year: w.inception,
    wikidata_id: w.qid,
    wikipedia_url: `https://sv.wikipedia.org/wiki/${encodeURIComponent(w.label || originalName).replace(/%20/g, '_')}`,
    aliases: [],
    metadata: w.description ? { description: w.description } : {},
    _source: {
      primary: 'wikidata',
      license: 'CC0' as SourceLicense,
      fetched_at: new Date().toISOString(),
    },
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Slå upp subject med curated JSON först, sedan Wikidata live.
 */
export async function lookupSubjectLive(
  name: string | null | undefined,
): Promise<SubjectEntry | null> {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;

  // 1. Curated (vinner alltid)
  const curated = curatedLookup(trimmed);
  if (curated) return curated;

  // 2. Live-cache
  const cached = getFromCache(trimmed);
  if (cached !== undefined) return cached;

  // 3. Wikidata live
  const result = await sparqlQuery(buildSearchQuery(trimmed));
  if (!result) {
    setInCache(trimmed, null);
    return null;
  }

  const entry = mapToSubjectEntry(result, trimmed);
  setInCache(trimmed, entry);
  return entry;
}

/**
 * Batch-lookup.
 */
export async function lookupSubjectsLive(
  names: ReadonlyArray<string | null | undefined>,
): Promise<Record<string, SubjectEntry | null>> {
  const out: Record<string, SubjectEntry | null> = {};
  for (const n of names) {
    if (!n) continue;
    out[n] = await lookupSubjectLive(n);
  }
  return out;
}

/**
 * Test-hook: rensa cache.
 */
export function __resetSubjectLiveCacheForTests(): void {
  liveCache.clear();
  lastCallMs = 0;
}

/**
 * Statistik.
 */
export function subjectLiveCacheStats(): {
  cacheSize: number;
  hasLiveData: boolean;
} {
  return {
    cacheSize: liveCache.size,
    hasLiveData: true,
  };
}
