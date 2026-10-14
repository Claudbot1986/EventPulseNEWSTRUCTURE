/**
 * 08-Agent/utils/imageLibrary.ts
 *
 * Image library — återanvändbart bibliotek av AI-bilder.
 *
 * Designprinciper (2026-08-27):
 *   1. Smart matching — systemet vet VAR i biblioteket det ska hämta bilder
 *      baserat på (venue > category > kind > default). Användaren får en bild
 *      som passar evenemangets typ, inte en slumpmässig bild.
 *   2. Library växer automatiskt — varje BFL-success adderas till biblioteket.
 *   3. Ingen manuell kill switch — när BFL-credits är slut används library som
 *      fallback automatiskt (per anrop, runtime-beslut).
 *   4. Befintliga past-AI-bilder (1 246 unika URLs) backfill:as vid uppstart.
 *
 * pickLibraryFallback(): hämta bästa match för ett event
 *   Prioritet:
 *     1. Samma venue_id + samma category_slug (perfekt match)
 *     2. Samma category_slug (konsert-bild till konsert, teater-bild till teater)
 *     3. Default-bild (alltid tillgänglig om biblioteket är populerat)
 *
 * addToLibrary(): registrera ny bild efter lyckad BFL-generering.
 * backfillFromPastAi(): en-gångs-script som extraherar 1 246 unika past-AI
 *   URLs från events-tabellen och registrerar dem med kategori-metadata.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { findImageForEvent } from '../../BFL-generator/lib/match.js';

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

// ── Public URL helpers ─────────────────────────────────────────────────────
// R2 publika bucket-URL. Sätts via env, fallback till worker-config.
// I produktion: SUPABASE_STORAGE_URL pekar mot R2-public-endpoint.

function publicUrlFor(storagePath: string): string {
  const base = process.env.SUPABASE_STORAGE_URL
    || process.env.AI_IMAGE_PUBLIC_URL
    || 'https://storage.eventpulse.se';
  return `${base.replace(/\/$/, '')}/${storagePath.replace(/^\//, '')}`;
}

/**
 * Mappa `image_library.storage_path` (pekar numera direkt på import-stamped/)
 * till den publika URL som UI läser.
 *
 * Bakgrund (2026-10-08): image_library.storage_path pekar DIREKT på
 * import-stamped/ (migration 2026-10-08). Inga rå-bilder till Storage —
 * imageGen.ts laddar bara upp stämplade varianter. Därför är denna
 * funktion i praktiken en no-op för nya entries.
 *
 * Bakåtkompatibilitet (2026-09-01): tidigare pekade storage_path på
 * import-original/ och UI mappade via denna funktion. Efter migreringen
 * finns inga sådana rader kvar, men funktionen finns kvar som skydd
 * om äldre rader slinker igenom (t.ex. via tredjeparts-system).
 *
 * Substring-match utan inledande slash för att täcka båda formaten:
 *   - `import-stamped/foo.png`           (normala entries, nya + migrerade)
 *   - `event-posters/import-stamped/foo.png`  (full path)
 *   - `import-original/foo.png`          (legacy, mappas till stamped)
 *   - `event-posters/import-original/foo.png` (legacy, mappas till stamped)
 *
 * Om filen saknar import-*-segment (t.ex. legacy `events/`-rad eller
 * QA-only `ai-originals/`-rad) returneras storage_path oförändrat.
 */
function stampedUrlForStoragePath(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  if (storagePath.includes('import-original/')) {
    return publicUrlFor(storagePath.replace(/import-original\//, 'import-stamped/'));
  }
  return publicUrlFor(storagePath);
}

// ── Image Library row type ─────────────────────────────────────────────────

export interface LibraryImage {
  id: string;
  storage_path: string;
  public_url: string;
  category_slug: string | null;
  venue_pattern: string | null;
  tags: string[];
  source_event_id: string | null;
  times_used: number;
  last_used_at: string | null;
  rating: number | null;
  approved_by: string;
  added_at: string;
  updated_at: string;
}

// ── pickLibraryFallback ────────────────────────────────────────────────────

// Kategori-alias (2026-09-05): events och image_library har historiskt
// använt olika slugs (events: 'art'/'theater'/'family'/'opera'/'design'/
// 'musikaler', biblioteket: 'art-exhibitions'/'theatre-comedy'/'barn' m.fl.).
// Utan alias fastnar dessa events utan bild trots att passande
// biblioteksbilder finns. Alias listas i prioritetsordning.
//
// 2026-10-04 — utökat täckning. Tidigare 6 entries saknade många av de
// kategorier som finns i events (musical-theatre, classical, theatre-drama,
// exhibition, family, talks-lectures, workshop m.fl.). Resultatet blev att
// hundratals events föll igenom till default-bild (1 st) trots att biblioteket
// hade 264 music + 229 community + 134 culture-bilder att välja bland.
// Prioritet: tightast möjliga alias först (mest specifik bildtyp), sedan
// bredare kategorier som fallback.
const CATEGORY_ALIASES: Record<string, string[]> = {
  // Teater / scenkonst
  theater: ['theatre-comedy'],
  musical: ['theatre-comedy'],
  'musical-theatre': ['theatre-comedy'],
  'theatre-drama': ['theatre-comedy'],
  musikaler: ['theatre-comedy'],
  // Klassisk musik / orkester
  classical: ['culture', 'music'],
  // Konst / utställning
  art: ['art-exhibitions', 'arts'],
  exhibition: ['art-exhibitions'],
  // Familj / barn
  family: ['barn'],
  barn: ['barn'],
  // Opera / design / musik-kultur
  opera: ['culture'],
  design: ['culture'],
  // Föreläsningar / workshops (infrastruktur-bild från culture/community)
  talks: ['community', 'culture'],
  'talks-lectures': ['community', 'culture'],
  workshop: ['community', 'culture'],
};

export interface FallbackInput {
  /** Venue UUID (för framtida venue-specifika bilder) */
  venue_id?: string | null;
  /** Venue-namn (används om venue_pattern-matchning behövs) */
  venue_name?: string | null;
  /** category_slug från event (t.ex. 'music', 'culture') */
  category_slug?: string | null;
  // 2026-10-14 — steg 4: används av v2-matchning (cluster_tags via M3).
  /** Event-id (för v2-matchning + framtida logging) */
  event_id?: string | null;
  /** Event-beskrivning (raw, som M3 ska läsa och generera taggar från) */
  raw_description?: string | null;
}

export interface FallbackResult {
  url: string | null;
  library_id: string | null;
  match_type: 'cluster_match' | 'venue+category' | 'category' | 'kind' | 'default' | 'none';
}

/**
 * Hämta bästa biblioteks-bild för ett event.
 *
 * Returnerar null om biblioteket är tomt (då måste BFL-anrop köras).
 *
 * Bump:ar times_used vid lyckad match så vi kan identifiera mest använda bilder.
 */
export async function pickLibraryFallback(input: FallbackInput): Promise<FallbackResult> {
  // 0. Default-bild alltid finns (om biblioteket är populerat)
  //    Vi returnerar default som fallback om allt annat misslyckas.
  const emptyResult: FallbackResult = { url: null, library_id: null, match_type: 'none' };

  // 1. Cluster-tags-matchning (2026-10-14, steg 4) — smartast alternativ.
  //    M3 läser event-beskrivning → genererar 3-5 sök-taggar → matchar mot
  //    image_library.cluster_tags (PostgREST cs. på 1-element-array per gren).
  //    Vid träff: bästa bilden (lägst times_used vid lika overlap).
  //    Vid fel/tomt/timeout: faller igenom till venue+category.
  //    Vi wrappar i try/catch + Promise-race mot 5s så pipeline aldrig blockeras.
  if (input.event_id && input.category_slug && input.raw_description?.trim()) {
    try {
      const v2 = await Promise.race([
        findImageForEvent({
          event_id: input.event_id,
          category_slug: input.category_slug,
          raw_description: input.raw_description,
        }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('v2-match timeout 5s')), 5_000),
        ),
      ]);
      if (v2?.best?.id && v2.best.public_url) {
        await bumpUsage(v2.best.id);
        return {
          url: stampedUrlForStoragePath(v2.best.storage_path ?? v2.best.public_url),
          library_id: v2.best.id,
          match_type: 'cluster_match',
        };
      }
    } catch (err) {
      // Tyst — vi vill inte krascha ingestion pga v2-fel. Logga som varning.
      console.warn(
        `[imageLibrary] v2-match misslyckades (event=${input.event_id}): ${
          err instanceof Error ? err.message : 'okänt'
        } → faller igenom till venue+category`,
      );
    }
  }

  // 2. Venue+category-match (2026-08-30): om vi har venue_name OCH det finns
  //    biblioteksbilder med venue_pattern som är en case-insensitive substring
  //    av venue_name, använd den. Kräver också category_slug (annars hade vi
  //    cross-cats som inte är samma typ av scen — t.ex. teater-venue får inte
  //    sport-bild).
  if (input.venue_name && input.category_slug) {
    const vnameLower = input.venue_name.toLowerCase();
    const { data: venueRows } = await db()
      .from('image_library')
      .select('id, public_url, storage_path, venue_pattern, times_used, rating')
      .eq('category_slug', input.category_slug)
      .not('venue_pattern', 'is', null);

    if (venueRows && venueRows.length > 0) {
      const venueMatch = venueRows
        .filter((row: { venue_pattern: string | null }) =>
          row.venue_pattern != null &&
          vnameLower.includes(row.venue_pattern.toLowerCase()))
        .sort((a: { rating: number | null; times_used: number | null }, b: { rating: number | null; times_used: number | null }) => {
          // Rating DESC, times_used ASC (rotation bland like-rated)
          const ra = a.rating ?? 0;
          const rb = b.rating ?? 0;
          if (rb !== ra) return rb - ra;
          return (a.times_used ?? 0) - (b.times_used ?? 0);
        })[0];

      if (venueMatch) {
        await bumpUsage(venueMatch.id);
        return {
          url: stampedUrlForStoragePath(venueMatch.storage_path ?? venueMatch.public_url),
          library_id: venueMatch.id,
          match_type: 'venue+category',
        };
      }
    }
  }

  // 2. Försök kategori-match (vanligaste fallet) — inkl. alias-slugs
  const catCandidates: string[] = input.category_slug
    ? [input.category_slug, ...(CATEGORY_ALIASES[input.category_slug] ?? [])]
    : [];
  for (const cat of catCandidates) {
    // 2026-10-14: filtrera bort bilder med tomma cluster_tags. Utan detta
    // hamnar samma "replacement"-bild (5055-användning-bilden i community)
    // på i princip alla events i sin kategori. Tomma cluster_tags = ingen
    // visuell signal = ska inte användas i auto-match.
    const { data: byCat } = await db()
      .from('image_library')
      .select('id, public_url, storage_path, times_used')
      .eq('category_slug', cat)
      .not('cluster_tags', 'is', null)
      .not('cluster_tags', 'eq', '{}')
      .order('rating', { ascending: false, nullsFirst: false })
      .order('times_used', { ascending: true }) // minst använda först (rotation)
      .limit(1)
      .single();

    if (byCat) {
      await bumpUsage(byCat.id);
      return {
        url: stampedUrlForStoragePath(byCat.storage_path ?? byCat.public_url),
        library_id: byCat.id,
        match_type: 'category',
      };
    }
  }

  // 3. Default-bild (alltid tillgänglig om biblioteket har något)
  //    2026-10-04 — smartare fallback: först NULL-category-bilder (samma
  //    default-pool som tidigare), sedan bred community/culture-pool om
  //    NULL-poolen är tom. Library har bara 1 NULL-bild idag, vilket
  //    gör att events utan category (343 st i prod) alla fått samma bild.
  //    Med community/culture-fallback får NULL-category-events nu variation
  //    bland de 229 community- + 134 culture-bilder som finns.
  let def = await nullDefaultImage();
  if (!def) {
    def = await genericFallbackImage();
  }

  if (def) {
    await bumpUsage(def.id);
    return {
      url: stampedUrlForStoragePath(def.storage_path ?? def.public_url),
      library_id: def.id,
      match_type: 'default',
    };
  }

  return emptyResult;
}

/**
 * Strikt default-pool: bilder med category_slug IS NULL. Endast 1 rad i
 * library idag, men poolen växer när curator-arbete landar.
 * 2026-10-14: kräv också icke-tomma cluster_tags så vi inte väljer en bild
 * som matchar mot vad som helst (samma bug som fixades i kategori-match).
 */
async function nullDefaultImage(): Promise<{ id: string; storage_path: string | null; public_url: string | null } | null> {
  const { data } = await db()
    .from('image_library')
    .select('id, public_url, storage_path')
    .is('category_slug', null)
    .not('cluster_tags', 'is', null)
    .not('cluster_tags', 'eq', '{}')
    .order('times_used', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/**
 * Generisk fallback (2026-10-04): NULL-category-events får en bred
 * community- eller culture-bild istället för den enda default-bilden.
 * Returnerar en rad som är rotation-balanced bland de mest använda
 * generiska kategorierna. Bättre visuell variation utan att kräva curator.
 * 2026-10-14: kräv också icke-tomma cluster_tags.
 */
async function genericFallbackImage(): Promise<{ id: string; storage_path: string | null; public_url: string | null } | null> {
  // community + culture är bredast (passar konserter, föreläsningar,
  // workshop, marknad, dans — utan att vara specifikt "konsert-bild").
  const GENERIC_CATEGORIES = ['community', 'culture'];
  const { data } = await db()
    .from('image_library')
    .select('id, public_url, storage_path, times_used')
    .in('category_slug', GENERIC_CATEGORIES)
    .not('cluster_tags', 'is', null)
    .not('cluster_tags', 'eq', '{}')
    .order('times_used', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function bumpUsage(libraryId: string): Promise<void> {
  // Atomic increment via SQL-funktion i migration.
  // SECURITY DEFINER → bara service_role kan anropa. Tyst vid fel — vi vill
  // inte krascha en lyckad fallback-bild-tilldelning pga räknar-fel.
  const { error } = await db().rpc('image_library_bump_usage', { p_id: libraryId });
  if (error) {
    console.warn(`[imageLibrary] bumpUsage misslyckades: ${error.message}`);
  }
}

// ── addToLibrary ────────────────────────────────────────────────────────────

export interface AddToLibraryInput {
  storage_path: string;
  category_slug?: string | null;
  venue_pattern?: string | null;
  tags?: string[];
  source_event_id?: string | null;
  /** Override default rating (1–5). Default = 3 om ej satt. */
  rating?: number | null;
}

/**
 * Registrera en ny AI-genererad bild i biblioteket.
 * Idempotent — om storage_path redan finns returneras befintlig rad.
 *
 * 2026-08-30: default rating=3 (mitten av 1–5-skalan) så att
 * `pickLibraryFallback` rating-sortering fungerar även bland nya bilder.
 * Curator kan senare justera uppåt/nedåt via UPDATE.
 */
export async function addToLibrary(input: AddToLibraryInput): Promise<LibraryImage | null> {
  const public_url = publicUrlFor(input.storage_path);

  // 1. Försök upsert med return. ignoreDuplicates=true → vid kollision
  //    returnerar upsert 0 rader, så vi måste hämta den befintliga raden.
  const { data: upserted, error: upsertErr } = await db()
    .from('image_library')
    .upsert(
      {
        storage_path: input.storage_path,
        public_url,
        category_slug: input.category_slug ?? null,
        venue_pattern: input.venue_pattern ?? null,
        tags: input.tags ?? [],
        source_event_id: input.source_event_id ?? null,
        rating: input.rating ?? 3,
      },
      { onConflict: 'storage_path', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle();

  if (upsertErr) {
    console.warn(`[imageLibrary] addToLibrary upsert misslyckades: ${upsertErr.message}`);
    return null;
  }
  if (upserted) return upserted as LibraryImage;

  // 2. Kollision — hämta befintlig rad via storage_path.
  const { data: existing, error: fetchErr } = await db()
    .from('image_library')
    .select()
    .eq('storage_path', input.storage_path)
    .maybeSingle();

  if (fetchErr) {
    console.warn(`[imageLibrary] addToLibrary fetch existing misslyckades: ${fetchErr.message}`);
    return null;
  }
  return (existing ?? null) as LibraryImage | null;
}

// ── markEventWithLibraryFallback ───────────────────────────────────────────

/**
 * Tilldela ett event en biblioteks-bild. Markerar eventet så UI vet att det
 * inte är AI-genererat utan ett fallback-val (image_ai_generated = false).
 * Kastar vid DB-fel så anroparen kan logga korrekt.
 */
export async function markEventWithLibraryFallback(
  eventId: string,
  libraryResult: FallbackResult,
): Promise<void> {
  if (!libraryResult.url || !libraryResult.library_id) return;
  const { error } = await db()
    .from('events')
    .update({
      image_url: libraryResult.url,
      image_ai_generated: false,
      image_license: 'library-fallback',
      image_attribution: `Library fallback (${libraryResult.match_type})`,
      image_generation_status: 'library_fallback',
      image_generation_error: null,
      image_generation_attempts: 0,
    })
    .eq('id', eventId);
  if (error) {
    throw new Error(`markEventWithLibraryFallback update failed for ${eventId}: ${error.message}`);
  }
}

// ── backfillFromPastAi ─────────────────────────────────────────────────────

export interface BackfillResult {
  inserted: number;
  skipped: number;
  total: number;
}

/**
 * En-gångs-script: extrahera alla unika past-AI-bild-URL:er från events-
 * tabellen och registrera dem i image_library. Kategori hämtas från eventet
 * som ursprungligen ägde bilden (eller 'community' som default).
 *
 * Körs manuellt vid bibliotek-uppstart. Idempotent (storage_path är unique).
 */
export async function backfillFromPastAi(opts: { dryRun?: boolean } = {}): Promise<BackfillResult> {
  const { data: pastAi, error } = await db()
    .from('events')
    .select('id, image_url, category_slug, source')
    .eq('image_ai_generated', true)
    .not('image_url', 'is', null)
    .limit(5000);

  if (error) throw new Error(`backfillFromPastAi select failed: ${error.message}`);
  if (!pastAi || pastAi.length === 0) return { inserted: 0, skipped: 0, total: 0 };

  // Deduplicera per URL — vi vill ha EN rad per unik bild, inte 813 rader
  // för Sergels torg som alla pekar på samma bild.
  const seen = new Map<string, { id: string; image_url: string; category_slug: string | null }>();
  for (const row of pastAi) {
    if (!row.image_url) continue;
    if (!seen.has(row.image_url)) {
      seen.set(row.image_url, {
        id: row.id,
        image_url: row.image_url,
        category_slug: row.category_slug,
      });
    }
  }

  let inserted = 0;
  let skipped = 0;
  for (const [url, info] of seen) {
    const storage_path = extractStoragePath(url);
    if (!storage_path) {
      skipped++;
      continue;
    }
    if (opts.dryRun) {
      inserted++;
      continue;
    }
    const result = await addToLibrary({
      storage_path,
      category_slug: info.category_slug ?? null,
      source_event_id: info.id,
      tags: ['past-ai', 'backfill'],
    });
    if (result) inserted++;
    else skipped++;
  }

  return { inserted, skipped, total: seen.size };
}

function extractStoragePath(publicUrl: string): string | null {
  // Format: <base>/<path> — vi behöver path-delen efter basen
  const base = process.env.SUPABASE_STORAGE_URL || process.env.AI_IMAGE_PUBLIC_URL;
  if (base && publicUrl.startsWith(base)) {
    return publicUrl.slice(base.length).replace(/^\//, '');
  }
  // Annars: försök hitta 'event-posters/' i URL:en
  const m = publicUrl.match(/(event-posters\/.+)/);
  if (m) return m[1];
  return null;
}