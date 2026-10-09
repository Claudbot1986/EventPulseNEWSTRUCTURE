/**
 * gazetteerCache.ts — lokal artist-gazetteer för Stockholm-scenen.
 *
 * FAS 3.1 (2026-10-09) — P8-board punkt 2 i autonomous körning.
 *
 * Vad: en JSON-baserad lookup-tabell över Stockholm-musiker med
 *      country / genres / type. Används för att:
 *        1. Höja extraherade entiteters confidence till VERIFIED
 *           (när vi hittar en exakt träff i gazetteer).
 *        2. Fylla Profile.performer_metadata med country/genres så
 *           factuality-check kan verifiera claims som 'kanadensiska'
 *           eller 'folk singer-songwriter'.
 *
 * Säkerhet:
 *   - O(logn) case-insensitive lookup på lowercased nyckel.
 *   - Inga nätverksanrop, ingen runtime — allt är statisk JSON.
 *   - Framtida MusicBrainz-fetch kan läggas till lazy ovanpå.
 *
 * Användning:
 *   import { lookupArtist } from './gazetteerCache';
 *   const meta = lookupArtist('Donovan Woods');
 *   // → { country: 'CA', genres: ['folk', ...], type: 'Person' }
 *
 *   const missing = lookupArtist('Quidam');
 *   // → null (program-namn, inte artist)
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

export interface ArtistEntry {
  name: string;
  country: string;
  type: 'Person' | 'Group' | 'Orchestra' | 'Choir' | string;
  genres: string[];
  aliases: string[];
  mbid: string;
  stockholm_relevance: 'high' | 'medium' | 'low';
}

// Top-level JSON-filen är en flat key→artist-mappning där $-prefixade
// nycklar ($-comment, $version, $format, $source) är dokumentation.
// Per-entry kan _comment/_note användas som fria anteckningar och hoppas över.
const META_KEY_RE = /^[$_]/;

// ─── Cache (lazy, loaded on first lookup) ────────────────────────────────────

let _cache: Record<string, ArtistEntry> | null = null;

/**
 * Ladda in curaterade Stockholm-artister från data/stockholm-gazetteer.json.
 * Lazy-loaded vid första lookupArtist()-anrop.
 */
function loadCache(): Record<string, ArtistEntry> {
  if (_cache) return _cache;

  // Hitta filen relativt till denna moduls path.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // editorial/gazetteerCache.ts → ../data/stockholm-gazetteer.json
  const dataPath = resolve(__dirname, '../data/stockholm-gazetteer.json');

  const raw = readFileSync(dataPath, 'utf-8');
  // JSON-filen är en flat key→artist-mappning på top-nivå med $-metadata.
  // Parsa som generisk record och filtrera bort $-prefixade nycklar.
  const data = JSON.parse(raw) as Record<string, Partial<ArtistEntry> & Record<string, unknown>>;

  // Bygg lookup-tabell: keys = lowercase, value = ArtistEntry
  const table: Record<string, ArtistEntry> = {};
  for (const [key, partial] of Object.entries(data)) {
    if (META_KEY_RE.test(key)) continue; // hoppa $-/_
    if (!partial || typeof partial !== 'object') continue;
    const name = partial.name || key;
    table[key.toLowerCase()] = {
      name,
      country: partial.country ?? '',
      type: partial.type ?? 'Person',
      genres: partial.genres ?? [],
      aliases: partial.aliases ?? [],
      mbid: partial.mbid ?? '',
      stockholm_relevance: partial.stockholm_relevance ?? 'low',
    };
    // Lägg också till alias → samma entry
    for (const alias of partial.aliases ?? []) {
      table[alias.toLowerCase()] = table[key.toLowerCase()];
    }
  }

  _cache = table;
  return _cache;
}

/**
 * Slå upp en artist i gazetteer (case-insensitive).
 *
 * Returnerar ArtistEntry om träff (exakt match på namn eller alias).
 * Returnerar null om artisten inte finns i curerad data.
 *
 * Performance: O(1) hash-table-lookup efter lazy-load.
 */
export function lookupArtist(name: string | null | undefined): ArtistEntry | null {
  if (!name) return null;
  const cache = loadCache();
  return cache[name.toLowerCase()] ?? null;
}

/**
 * Slå upp flera artister på en gång (returnerar map name → entry eller null).
 * Användbart för att populera Profile.performer_metadata.
 */
export function lookupArtists(
  names: ReadonlyArray<string | null | undefined>,
): Record<string, ArtistEntry | null> {
  const out: Record<string, ArtistEntry | null> = {};
  for (const n of names) {
    if (!n) continue;
    out[n] = lookupArtist(n);
  }
  return out;
}

/**
 * Statistik för logging/debug.
 */
export function gazetteerStats(): { totalArtists: number; loaded: boolean } {
  const cache = loadCache();
  return { totalArtists: Object.keys(cache).length, loaded: true };
}

/**
 * Test-hook: rensa cache (tvinga omladdning).
 */
export function __resetGazetteerCacheForTests(): void {
  _cache = null;
}
