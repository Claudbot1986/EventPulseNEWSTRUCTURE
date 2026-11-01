/**
 * 08-Agent/utils/wordImageBank.ts
 *
 * Ordbanken — de titalanpassade bilderna (image_library.category_slug='word').
 *
 * ── Kedjan som användaren beställde (2026-11-01) ───────────────────────────
 *
 *   1. Finns ett unikt ord i eventtiteln som har en ordbild?
 *      → använd DEN bilden (den visar ordet).
 *   2. Saknas ordet (eller finns ingen bild för det)?
 *      → gammal heuristik: cluster-match → venue+category → category → default.
 *
 * Steg 1 sitter INNAN den gamla heuristiken i `pickLibraryFallback`, så
 * ingestion väljer ordbilden först. Finns inget ord i titeln faller kedjan
 * vidare till gamla vägen — den är orörd.
 *
 * ── Varifrån kommer indexet? ───────────────────────────────────────────────
 *
 * `image_library` är facit: en rad per bild. För ordbilder är
 *   tags[0]        = bildnyckeln (ordet bilden visar, t.ex. "dambastu")
 *   cluster_tags   = de ordformer bilden gäller (t.ex. ["jul", "julen"])
 *
 * Ordformerna skrivs av `scripts/word_index_sync.ts` (och av
 * `scripts/word_image_assign.ts` vid varje tilldelning) från ord-inventeringen
 * — samma facit som generatorn och gaten använder.
 *
 * VIKTIGT: `category_slug='word'` gör att raderna aldrig kan väljas av den
 * gamla heuristiken — den filtrerar på kategori (community/culture/…), och
 * "word" är ingen eventkategori. Inte heller v2-cluster-matcheraren: den
 * söker `category_slug=eq.<eventkategori>`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { tokenizeTitle, compareWordHits } from '../../scripts/lib/word-image-match.js';

/** En rad i image_library som representerar en ordbild. */
export interface WordLibraryRow {
  id: string;
  public_url: string;
  storage_path: string;
  /** tags[0] = bildnyckeln. */
  tags: string[] | null;
  /** Ordformer bilden gäller. */
  cluster_tags: string[] | null;
}

/** En träff: ordet, bilden och vilken ordform som matchade. */
export interface WordImageEntry {
  /** Bildnyckeln (t.ex. "dambastu"). */
  key: string;
  /** image_library.id. */
  id: string;
  public_url: string;
  storage_path: string;
}

/** Ordform → bild. */
export type WordFormIndex = Map<string, WordImageEntry>;

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

/**
 * Bygger indexet: ordform → bild.
 *
 * Rad utan tags[0] hoppas över (aldrig krascha). En ordform som finns i två
 * rader avgörs av LÄNGSTA bildnyckeln — samma regel som resten av pipelinen
 * ("dambastu" slår "bastu").
 */
export function buildWordFormIndex(rows: WordLibraryRow[]): WordFormIndex {
  const index: WordFormIndex = new Map();
  const candidates = new Map<string, WordImageEntry>();

  for (const row of rows) {
    const key = (row.tags?.[0] ?? '').trim().toLowerCase();
    if (!key) continue;

    const entry: WordImageEntry = {
      key,
      id: row.id,
      public_url: row.public_url,
      storage_path: row.storage_path,
    };

    // Ordformerna: cluster_tags = de ordformer som FAKTISKT finns i
    // ordlistan (skrivet av scripts/word_index_sync.ts). Nyckeln läggs inte
    // in automatiskt — annars skulle token "dag" matcha bilden för "dag"
    // (nyckeln finns via formen "dagen") fast "dag" inte finns i ordlistan.
    // Ordlistan är facit.
    const forms = new Set<string>();
    for (const form of row.cluster_tags ?? []) {
      const f = form.trim().toLowerCase();
      if (f) forms.add(f);
    }
    // Saknas cluster_tags (rad skriven före synken) → använd nyckeln.
    if (!forms.size) forms.add(key);

    for (const form of forms) {
      const existing = candidates.get(form);
      if (!existing || entry.key.length > existing.key.length) {
        candidates.set(form, entry);
      }
    }
  }

  for (const [form, entry] of candidates) index.set(form, entry);
  return index;
}

/**
 * Vilken ordbild (om någon) hör till titeln?
 *
 * Längsta bildnyckeln vinner — "Dambastu … Bastu" ger *dambastu*, inte
 * *bastu*. Ordformer matchar samma bild ("Julen är här" → jul).
 * Lika långa nycklar avgörs alfabetiskt (compareWordHits) — samma regel som
 * tilldelningen använder, så ingestion och manuella körningar ger samma bild.
 *
 * Returnerar null om titeln inte innehåller något ord med bild — då går
 * kedjan vidare till den gamla heuristiken.
 */
export function pickWordImageFromTitle(
  title: string,
  index: WordFormIndex,
): WordImageEntry | null {
  if (!title || !index.size) return null;

  const hits: WordImageEntry[] = [];
  for (const token of tokenizeTitle(title)) {
    const hit = index.get(token);
    if (hit && !hits.includes(hit)) hits.push(hit);
  }
  if (!hits.length) return null;

  hits.sort(compareWordHits);
  return hits[0];
}

// ── Hämtning från DB (med kort cache) ─────────────────────────────────────

/**
 * Hur länge indexet cachas. Ingestionen kör många events i rad — utan cache
 * vore det en DB-fråga per event. 60 s är kort nog att nya ordbilder syns
 * snabbt, lång nog att inte belasta DB.
 */
const CACHE_TTL_MS = 60_000;

let _cache: { index: WordFormIndex; at: number } | null = null;

/** Tömmer cachen (tests + manuella synkar). */
export function resetWordFormIndexCache(): void {
  _cache = null;
}

/**
 * Laddar ordbanken från image_library.
 *
 * Tyst fel: ett DB-fel ger ett TOMT index → `pickWordImageFromTitle` ger
 * null → kedjan faller vidare till den gamla heuristiken. Ingestion får aldrig
 * stanna för att ordbanken är otillgänglig.
 */
export async function loadWordFormIndex(): Promise<WordFormIndex> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.index;

  try {
    const { data, error } = await db()
      .from('image_library')
      .select('id, public_url, storage_path, tags, cluster_tags')
      .eq('category_slug', 'word')
      .limit(2000);

    if (error) {
      console.warn(`[wordImageBank] kunde inte läsa ordbanken: ${error.message} → gammal heuristik`);
      return new Map();
    }
    const index = buildWordFormIndex((data ?? []) as WordLibraryRow[]);
    _cache = { index, at: Date.now() };
    return index;
  } catch (err) {
    console.warn(
      `[wordImageBank] ordbanken kunde inte läsas: ${err instanceof Error ? err.message : 'okänt'} → gammal heuristik`,
    );
    return new Map();
  }
}

/**
 * Bekvämlighet: hämta index + slå upp en titel.
 *
 * @param title Eventtitel (title_sv eller title_en)
 */
export async function pickWordImage(title: string): Promise<WordImageEntry | null> {
  const index = await loadWordFormIndex();
  return pickWordImageFromTitle(title, index);
}
