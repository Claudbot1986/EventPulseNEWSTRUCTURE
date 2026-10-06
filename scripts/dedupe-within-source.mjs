#!/usr/bin/env node
/**
 * dedupe-within-source.mjs — Within-source deduplication backfill.
 *
 * Purpose: ta bort rader i events-tabellen där samma källa har samma event
 *   lagrat flera gånger. Vi har två kategorier:
 *
 *   A) (source, source_id) duplicates — när source_id är satt (t.ex.
 *      berwaldhallen-119632 lagras två gånger). Normalizernivernets dedup_hash
 *      borde ha fångat detta men har sluppit igenom i vissa fall.
 *   B) (source, title_sv, start_time) duplicates — när source_id är NULL.
 *      Detta är det dominanta fallet för livespot-stockholm där 6930 rader
 *         med NULL source_id kom in via en legacy direct-insert-batch den
 *         2026-10-04 (innan 1213-10-05-omstruktureringen till raw_events-kö).
 *
 * Algoritm: inom varje dedup-grupp behåll "vinnaren":
 *   - Prioritet 1: rad med senaste last_seen_at (färskast sedd)
 *   - Prioritet 2: rad med mest icke-null fält (description_sv, venue_id,
 *                  category_slug, ticket_url, lat/lng, image_url)
 *   - Prioritet 3: tidigaste created_at (stabilt val)
 *   Ta bort alla andra rader i gruppen.
 *
 * Idempotent: kör igen utan skada — inga duplicates kvar att ta bort.
 *
 * Run: npx tsx scripts/dedupe-within-source.mjs [--dry] [--source=livespot-stockholm]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const DRY = process.argv.includes('--dry');
const sourceArg = process.argv.find((a) => a.startsWith('--source='));
const ONLY_SOURCE = sourceArg ? sourceArg.split('=')[1] : null;
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const ROW_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null;

console.log(`[dedup] dry-run=${DRY} only-source=${ONLY_SOURCE ?? '(all)'} row-limit=${ROW_LIMIT ?? '(none)'}`);

const PAGE = 1000;

/**
 * Score a row by completeness — higher = more complete, prefer to keep.
 * Används som tie-breaker efter last_seen_at.
 */
function completenessScore(r) {
  let s = 0;
  if (r.description_sv) s += 3;
  if (r.description_en) s += 2;
  if (r.venue_id) s += 3;
  if (r.category_slug) s += 1;
  if (r.ticket_url) s += 1;
  if (r.image_url) s += 2;
  if (r.lat != null && r.lng != null) s += 1;
  if (r.price_min_sek != null) s += 1;
  if (r.end_time) s += 1;
  return s;
}

/**
 * Choose the row to KEEP from a duplicate group.
 *
 * Prioritet (varje steg är tie-breaker för nästa):
 *  1. completenessScore DESC — en rad med description, venue, image är mer
 *     värd än en som saknar det, även om den senare har en nyare last_seen.
 *  2. last_seen_at DESC — färskaste sedd vinner vid lika poäng.
 *  3. created_at ASC — äldsta vinner (har haft mest tid att fyllas på).
 *  4. id ASC — stabilt val.
 *
 * Vi väljer bevisst = INTE last_seen_at först, eftersom en gammal rad kan ha
 * blivit berikad via t.ex. en description-backfill och vi vill inte kasta bortt.
 */
function chooseWinner(rows) {
  return rows.slice().sort((a, b) => {
    const sa = completenessScore(a);
    const sb = completenessScore(b);
    if (sb !== sa) return sb - sa;
    const la = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
    const lb = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
    if (lb !== la) return lb - la;
    const ca = a.created_at ? new Date(a.created_at).getTime() : Infinity;
    const cb = b.created_at ? new Date(b.created_at).getTime() : Infinity;
    if (ca !== cb) return ca - cb;
    return (a.id < b.id) ? -1 : (a.id > b.id) ? 1 : 0;
  })[0];
}

async function fetchAllRows(sourceFilter) {
  const all = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from('events')
      .select('id, source, source_id, title_sv, title_en, start_time, end_time, venue_id, category_slug, ticket_url, image_url, lat, lng, price_min_sek, description_sv, description_en, created_at, last_seen_at, status')
      .eq('status', 'published');
    if (sourceFilter) q = q.eq('source', sourceFilter);
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
    if (ROW_LIMIT && all.length >= ROW_LIMIT) {
      all.length = ROW_LIMIT;
      break;
    }
  }
  return all;
}

function buildDuplicateGroups(rows) {
  const groupsA = new Map(); // (source, source_id) → rows
  const groupsB = new Map(); // (source, title_sv, start_time) → rows, endast om source_id NULL

  for (const r of rows) {
    if (r.source_id) {
      const k = `${r.source}::${r.source_id}`;
      if (!groupsA.has(k)) groupsA.set(k, []);
      groupsA.get(k).push(r);
    } else {
      // source_id null — fallback till (source, title_sv, start_time)
      if (!r.title_sv || !r.start_time) continue;
      const k = `${r.source}::${r.title_sv}::${r.start_time}`;
      if (!groupsB.has(k)) groupsB.set(k, []);
      groupsB.get(k).push(r);
    }
  }

  const dupGroups = [];
  for (const [k, list] of groupsA) {
    if (list.length > 1) {
      const uids = new Set(list.map((r) => r.id));
      dupGroups.push({key: k, list, source: list[0].source, sourceId: list[0].source_id, kind: 'A'});
    }
  }
  for (const [k, list] of groupsB) {
    if (list.length > 1) {
      dupGroups.push({key: k, list, source: list[0].source, sourceId: null, kind: 'B'});
    }
  }
  return dupGroups;
}

async function deleteRows(ids) {
  // Delete in batches of 200
  const BATCH = 200;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from('events')
      .delete({ count: 'exact' })
      .in('id', chunk);
    if (error) {
      console.error(`[dedup] delete error:`, error.message);
      throw error;
    }
    deleted += count ?? chunk.length;
  }
  return deleted;
}

async function main() {
  console.log(`[dedup] Hämtar events...`);
  const rows = await fetchAllRows(ONLY_SOURCE);
  console.log(`[dedup] ${rows.length} events hämtade`);

  console.log(`[dedup] Bygger duplicate-grupper...`);
  const dupGroups = buildDuplicateGroups(rows);
  console.log(`[dedup] Hittade ${dupGroups.length} duplicate-grupper`);

  // Statistik per källa
  const bySource = new Map();
  let totalExtra = 0;
  for (const g of dupGroups) {
    const extras = g.list.length - 1;
    totalExtra += extras;
    const cur = bySource.get(g.source) || { groups: 0, extras: 0 };
    cur.groups += 1;
    cur.extras += extras;
    bySource.set(g.source, cur);
  }
  console.log(`[dedup] Totalt ${totalExtra} extra rader att ta bort`);
  console.log(`[dedup] Per källa:`);
  for (const [src, stat] of [...bySource.entries()].sort((a,b)=>b[1].extras-a[1].extras)) {
    console.log(`  ${stat.extras.toString().padStart(5)} extra (${stat.groups} grupper)  ${src}`);
  }

  if (totalExtra === 0) {
    console.log(`[dedup] Inga dubletter — avslutar.`);
    process.exit(0);
  }

  if (DRY) {
    console.log(`\n[dedup] DRY-RUN — inga lokera ändringar görs.`);
    console.log(`[dedup] Kör utan --dry för att applicera.`);
    console.log(`\n[dedup] Första 10 grupper (sample):`);
    for (const g of dupGroups.slice(0, 10)) {
      const winner = chooseWinner(g.list);
      const losers = g.list.filter((r) => r.id !== winner.id);
      console.log(`  ${g.source} | kind=${g.kind} | group_size=${g.list.length}`);
      console.log(`    KEEP:   id=${winner.id.slice(0,8)} created=${winner.created_at?.slice(0,19)} last_seen=${winner.last_seen_at?.slice(0,19)} score=${completenessScore(winner)} desc_sv=${winner.description_sv ? 'Y' : 'N'} venue=${winner.venue_id ? 'Y' : 'N'}`);
      for (const l of losers) {
        console.log(`    DROP:   id=${l.id.slice(0,8)} created=${l.created_at?.slice(0,19)} last_seen=${l.last_seen_at?.slice(0,19)} score=${completenessScore(l)} desc_sv=${l.description_sv ? 'Y' : 'N'} venue=${l.venue_id ? 'Y' : 'N'}`);
      }
    }
    process.exit(0);
  }

  // Bygg DELETE-lista: alla losers
  const toDelete = [];
  for (const g of dupGroups) {
    const winner = chooseWinner(g.list);
    for (const r of g.list) {
      if (r.id !== winner.id) toDelete.push(r.id);
    }
  }

  console.log(`\n[dedup] Tar bort ${toDelete.length} rader i batcher om 200...`);
  const deleted = await deleteRows(toDelete);
  console.log(`[dedup] ✅ Borttagna: ${deleted}`);

  // Verifiering + iterationshantering: nya duplicates kan uppstå när vi
  // tar bort rader (rad A och rad B är båda duplicates mot olika rader i
  // samma grupp, men efter att vi tagit bort C kan A och B kollidera).
  // Vi kör tills inga duplicates finns kvar (max 10 rundor för säkerhet).
  const MAX_PASSES = 10;
  let pass = 1;
  while (pass < MAX_PASSES) {
    const rowsAfter = await fetchAllRows(ONLY_SOURCE);
    const dupGroupsAfter = buildDuplicateGroups(rowsAfter);
    const extrasAfter = dupGroupsAfter.reduce((s, g) => s + (g.list.length - 1), 0);
    console.log(`[dedup] Pass ${pass} verify — ${rowsAfter.length} events, ${extrasAfter} extras`);
    if (extrasAfter === 0) break;

    const nextDelete = [];
    for (const g of dupGroupsAfter) {
      const winner = chooseWinner(g.list);
      for (const r of g.list) {
        if (r.id !== winner.id) nextDelete.push(r.id);
      }
    }
    console.log(`[dedup] Pass ${pass}: tar bort ${nextDelete.length} extra...`);
    const d = await deleteRows(nextDelete);
    console.log(`[dedup] Pass ${pass}: ✅ ${d} borttagna`);
    pass++;
  }

  // Slutverifiering
  const finalRows = await fetchAllRows(ONLY_SOURCE);
  const finalDupGroups = buildDuplicateGroups(finalRows);
  const finalExtras = finalDupGroups.reduce((s, g) => s + (g.list.length - 1), 0);
  console.log(`\n[dedup] === SLUTLIG ===`);
  console.log(`[dedup] Events kvar: ${finalRows.length}`);
  console.log(`[dedup] Duplicate extras kvar: ${finalExtras}`);
  if (finalExtras > 0) {
    console.log(`[dedup] ⚠️  ${finalExtras} duplicates kvar efter ${MAX_PASSES} pass — undersök manuellt.`);
    process.exit(1);
  } else {
    console.log(`[dedup] ✅ Inga duplicates kvar.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[dedup] FATAL:', err);
  process.exit(1);
});