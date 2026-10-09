/**
 * subjectCache.ts — FAS 3.2 / öppen-data-arkitektur (2026-10-09).
 *
 * Vad: lokal subject-gazetteer (icke-performer-entiteter) baserad på
 *      Wikidata (CC0) + Wikipedia (CC BY-SA). Används för att:
 *        1. Höja extraherade subjekts confidence till VERIFIED
 *        2. Fylla Profile.subject_metadata med author/language/year/genre
 *        3. Ge factuality-check stöd för claims som 'William Shakespeares
 *           tragedi Hamlet, skrivet 1603' — helt från öppen data
 *
 * Säkerhet: O(logn) case-insensitive lookup. Inga nätverksanrop.
 *           Live-lookup mot Wikidata (CC0) i subjectLiveEnrich.ts.
 *
 * Skillnad mot gazetteerCache.ts:
 *   - gazetteerCache: artister (MusicBrainz)
 *   - subjectCache:   verk, personer, organisationer, ämnen (Wikidata)
 *
 * Användning:
 *   import { lookupSubject } from './subjectCache';
 *   const meta = lookupSubject('Hamlet');
 *   // → { kind: 'work', author: 'William Shakespeare', language: 'en', ... }
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

export type SubjectKind =
  | 'work'           // Verk: pjäs, film, bok
  | 'person'         // Person (författare, regissör — INTE artist)
  | 'organization'   // Arrangör/operahus/teater
  | 'topic'          // Ämne (jazz, AI, litteratur)
  | 'venue'          // Specifik lokal
  | 'event_series';  // Serie av återkommande event

export type SourceLicense = 'CC0' | 'CC-BY-SA-4.0' | 'public-domain' | 'unknown';

export interface SubjectSource {
  primary: 'wikidata' | 'wikipedia' | 'open_library' | 'curated';
  license: SourceLicense;
  fetched_at: string;
}

export interface SubjectEntry {
  name: string;
  kind: SubjectKind;
  country?: string;
  language?: string;
  inception_year?: number;
  wikidata_id?: string | null;
  wikipedia_url?: string | null;
  aliases: string[];
  metadata: Record<string, string>;
  _source: SubjectSource;
}

const META_KEY_RE = /^[$_]/;

// ─── Cache (lazy) ────────────────────────────────────────────────────────────

let _cache: Record<string, SubjectEntry> | null = null;

function loadCache(): Record<string, SubjectEntry> {
  if (_cache) return _cache;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const dataPath = resolve(__dirname, '../data/stockholm-subjects.json');
  const raw = readFileSync(dataPath, 'utf-8');
  const data = JSON.parse(raw) as Record<string, Partial<SubjectEntry> & Record<string, unknown>>;

  const table: Record<string, SubjectEntry> = {};
  for (const [key, partial] of Object.entries(data)) {
    if (META_KEY_RE.test(key)) continue;
    if (!partial || typeof partial !== 'object') continue;
    const name = partial.name || key;
    table[key.toLowerCase()] = {
      name,
      kind: (partial.kind as SubjectKind) ?? 'topic',
      country: partial.country,
      language: partial.language,
      inception_year: partial.inception_year,
      wikidata_id: partial.wikidata_id ?? null,
      wikipedia_url: partial.wikipedia_url ?? null,
      aliases: partial.aliases ?? [],
      metadata: partial.metadata ?? {},
      _source: partial._source ?? { primary: 'curated', license: 'unknown', fetched_at: '2026-10-09' },
    };
    for (const alias of partial.aliases ?? []) {
      table[alias.toLowerCase()] = table[key.toLowerCase()];
    }
  }
  _cache = table;
  return _cache;
}

/**
 * Slå upp ett subject i curated JSON. Case-insensitive.
 * Returnerar SubjectEntry eller null.
 */
export function lookupSubject(name: string | null | undefined): SubjectEntry | null {
  if (!name) return null;
  const cache = loadCache();
  return cache[name.toLowerCase()] ?? null;
}

/**
 * Batch-lookup. Map name → entry eller null.
 */
export function lookupSubjects(
  names: ReadonlyArray<string | null | undefined>,
): Record<string, SubjectEntry | null> {
  const out: Record<string, SubjectEntry | null> = {};
  for (const n of names) {
    if (!n) continue;
    out[n] = lookupSubject(n);
  }
  return out;
}

/**
 * Hämta alla subjects av en viss kind (work, person, etc).
 * Användbart för testning + UI-attribution.
 */
export function subjectsByKind(kind: SubjectKind): SubjectEntry[] {
  const cache = loadCache();
  return Object.values(cache).filter((s) => s.kind === kind);
}

/**
 * Statistik för logging.
 */
export function subjectCacheStats(): { totalSubjects: number; loaded: boolean } {
  const cache = loadCache();
  return { totalSubjects: Object.keys(cache).length, loaded: true };
}

/**
 * Test-hook: rensa cache.
 */
export function __resetSubjectCacheForTests(): void {
  _cache = null;
}
