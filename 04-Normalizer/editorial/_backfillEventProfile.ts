/**
 * _backfillEventProfile.ts — FAS 3.2 / 2026-10-13.
 *
 * Batch-jobb som populerar event_profile JSONB för alla future events.
 * Körs EFTER att migration 20261007-0001-editorial-description-engine.sql
 * är applicerad. För varje event:
 *   1. Plocka title/venue/category från DB
 *   2. Kör extractEntities(title) → performer-namn
 *   3. Kör lookupArtists(performers) — curated först, sedan live MusicBrainz
 *   4. Kör lookupSubjects(...) → subject_metadata (curated + live Wikidata)
 *   5. Bygg EventProfile med metadata
 *   6. UPDATE events SET event_profile = ... WHERE id = ...
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx 04-Normalizer/editorial/_backfillEventProfile.ts
 *   npx tsx 04-Normalizer/editorial/_backfillEventProfile.ts --dry-run
 *   npx tsx 04-Normalizer/editorial/_backfillEventProfile.ts --limit=10
 *   npx tsx 04-Normalizer/editorial/_backfillEventProfile.ts --category=music
 *   npx tsx 04-Normalizer/editorial/_backfillEventProfile.ts --no-live
 */
import { createClient } from '@supabase/supabase-js';
import { extractEntities } from './entityExtractor';
import { buildEventProfile, profileInfoLevel } from './eventUnderstanding';
import { lookupArtistsLive } from './gazetteerLiveEnrich';

interface DbEvent {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  category_slug: string | null;
  venue_id: string | null;
  /** raw_description används BARA för entitets-extraktion (entityExtractor);
   *  skickas ALDRIG till M3 (textualFirewall). */
  raw_description: string | null;
}

interface BackfillStats {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  liveLookups: number;
  errors: string[];
  byCategory: Record<string, { total: number; withProfile: number }>;
}

const PERFORMER_ROLES = new Set([
  'artist', 'ensemble', 'band', 'performer', 'comedian',
  'conductor', 'soloist', 'speaker', 'dj', 'team',
]);

async function fetchEventsToBackfill(
  supabase: ReturnType<typeof createClient>,
  args: { limit?: number; category?: string; onlyMissing: boolean },
): Promise<DbEvent[]> {
  // PostgREST default-cap: 1000 rader per SELECT. För stora batcher paginerar
  // vi via `.range()`. 4100 events kräver ~5 sidor.
  const now = new Date().toISOString();
  const targetCount = args.limit ?? Number.MAX_SAFE_INTEGER;
  const PAGE = 1000;
  const all: DbEvent[] = [];

  for (let from = 0; all.length < targetCount; from += PAGE) {
    let q = supabase
      .from('events')
      .select('id, title_sv, title_en, category_slug, venue_id, raw_description')
      .gt('start_time', now)
      .order('start_time', { ascending: true })
      .range(from, from + PAGE - 1);
    if (args.category) q = q.eq('category_slug', args.category);
    if (args.onlyMissing) q = q.is('event_profile', null);
    const { data, error } = await q;
    if (error) throw new Error(`fetch events: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as DbEvent[]));
    if (data.length < PAGE) break; // sista sidan
    if (all.length >= targetCount) break;
  }
  return all.slice(0, targetCount === Number.MAX_SAFE_INTEGER ? all.length : targetCount);
}

/**
 * Berika performers via live MusicBrainz lookup om curated missar.
 * Returnerar map performer_name → ArtistEntry.
 */
async function enrichPerformersLive(
  performers: string[],
  stats: BackfillStats,
  enabled: boolean,
): Promise<Record<string, unknown>> {
  if (!enabled || performers.length === 0) return {};
  try {
    const live = await lookupArtistsLive(performers);
    stats.liveLookups += performers.length;
    return live;
  } catch {
    return {};
  }
}

async function backfillOne(
  supabase: ReturnType<typeof createClient>,
  ev: DbEvent,
  args: { enableLiveLookup: boolean; stats: BackfillStats },
): Promise<{ updated: boolean; reason?: string; profile?: any }> {
  try {
    const title = ev.title_sv || ev.title_en || '';
    if (!title) return { updated: false, reason: 'no title' };

    // 1. extractEntities
    // raw_description skickas hit ENBART för entitets-extraktion
    // (entityExtractor matchar strukturerade description-patterns som
    //  'Medverkande: X', 'Dirigent: Y', 'Solist: Z'). Innehållet når
    //  aldrig M3 — textualFirewall skyddar senare steg.
    const entities = extractEntities({
      title,
      raw_description: ev.raw_description,
      category_slug: ev.category_slug,
      venue_name: null,
    });

    // 2. performers
    const performers = entities
      .filter((e) => PERFORMER_ROLES.has(e.role))
      .map((e) => e.name);

    // 3. Live MusicBrainz lookup (för performers som curated missar)
    // lookupArtistsLive returnerar bara entries för performers som inte
    // finns i curated, så det är säkert att alltid anropa.
    if (args.enableLiveLookup && performers.length > 0 && process.env.MUSICBRAINZ_USER_AGENT) {
      await enrichPerformersLive(performers, args.stats, true);
    }

    // 4. buildEventProfile (som nu har live-data i cache)
    const profile = buildEventProfile({
      title,
      raw_description: null,
      category_slug: ev.category_slug,
      venue_name: null,
      city: null,
      source: 'backfill-fas-3.2',
      performers,
    });

    const hasContent =
      (profile.performer_metadata && Object.keys(profile.performer_metadata).length > 0) ||
      (profile.subject_metadata && Object.keys(profile.subject_metadata).length > 0);

    if (!hasContent) {
      return { updated: false, reason: 'no gazetteer hits', profile };
    }

    // 5. Spara i DB
    const profileJson = {
      profile,
      version: 1,
      generated_at: new Date().toISOString(),
      source_hashes: {},
    };
    const infoLevel = profileInfoLevel(profile);
    const { error } = await supabase
      .from('events')
      .update({
        event_profile: profileJson,
        editorial_info_level: infoLevel,
      })
      .eq('id', ev.id);
    if (error) {
      return { updated: false, reason: `db update: ${error.message}`, profile };
    }
    return { updated: true, profile };
  } catch (err) {
    return { updated: false, reason: (err as Error).message };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : undefined;
  const catArg = args.find((a) => a.startsWith('--category='));
  const category = catArg ? catArg.slice('--category='.length) : undefined;
  const onlyMissing = !args.includes('--all');
  const enableLiveLookup = !args.includes('--no-live');
  const hasMBUA = Boolean(process.env.MUSICBRAINZ_USER_AGENT);
  const willUseLive = enableLiveLookup && hasMBUA;

  console.log('═'.repeat(78));
  console.log('  BACKFILL event_profile — FAS 3.2');
  console.log(`  Mode: ${dryRun ? 'DRY-RUN' : 'PROD'}`);
  console.log(`  Limit: ${limit ?? 'alla'} | Category: ${category ?? 'alla'} | Only missing: ${onlyMissing}`);
  console.log(`  Live MusicBrainz lookup: ${willUseLive ? 'PÅ' : 'AV'}${hasMBUA ? '' : ' (MUSICBRAINZ_USER_AGENT ej satt)'}`);
  console.log('═'.repeat(78));

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const events = await fetchEventsToBackfill(supabase, { limit, category, onlyMissing });
  console.log(`\nHittade ${events.length} events att bearbeta.\n`);

  const stats: BackfillStats = {
    total: events.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    liveLookups: 0,
    errors: [],
    byCategory: {},
  };

  const start = Date.now();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const result = await backfillOne(supabase, ev, { enableLiveLookup: willUseLive, stats });

    // Per-category stats
    const cat = ev.category_slug || 'unknown';
    const catStats = stats.byCategory[cat] ?? { total: 0, withProfile: 0 };
    catStats.total++;
    if (result.updated) catStats.withProfile++;
    stats.byCategory[cat] = catStats;

    if (result.updated) {
      stats.updated++;
      if (i < 5 || i % 50 === 0) {
        const title = (ev.title_sv || ev.title_en || '').slice(0, 50);
        console.log(`  [${i + 1}/${events.length}] ✓ ${title}`);
      }
    } else {
      stats.skipped++;
      if (result.reason && !result.reason.includes('no gazetteer hits') && !result.reason.includes('no title')) {
        stats.failed++;
        if (stats.errors.length < 5) {
          stats.errors.push(`${ev.id}: ${result.reason}`);
        }
      }
    }

    // Progress var 100:e event
    if ((i + 1) % 100 === 0) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      const rate = Math.round((i + 1) / elapsed);
      console.log(`  --- Progress: ${i + 1}/${events.length} (${rate} events/s) ---`);
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log('\n' + '═'.repeat(78));
  console.log(`  SLUTRESULTAT (${elapsed}s)`);
  console.log('═'.repeat(78));
  console.log(`  Totalt:        ${stats.total}`);
  console.log(`  ✓ Uppdaterade: ${stats.updated} (${Math.round((stats.updated / stats.total) * 100)}%)`);
  console.log(`  – Skippade:    ${stats.skipped} (ingen gazetteer-hit)`);
  console.log(`  ✗ Fel:         ${stats.failed}`);
  if (stats.liveLookups > 0) console.log(`  🌐 Live MusicBrainz-anrop: ${stats.liveLookups}`);
  if (stats.errors.length > 0) {
    console.log(`\n  Första felen:`);
    for (const e of stats.errors) console.log(`    ${e}`);
  }

  console.log('\n  Per-kategori:');
  const sortedCats = Object.entries(stats.byCategory).sort((a, b) => b[1].total - a[1].total);
  for (const [cat, s] of sortedCats) {
    const pct = s.total > 0 ? Math.round((s.withProfile / s.total) * 100) : 0;
    const icon = pct === 100 ? '✅' : pct === 0 ? '❌' : '⚠️';
    console.log(`    ${icon} ${cat.padEnd(20)} ${s.withProfile}/${s.total} (${pct}%)`);
  }

  if (dryRun) {
    console.log('\n⚠️  DRY-RUN: inga ändringar sparade i DB.');
  }
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
