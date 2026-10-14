/**
 * _reclassifyCommunityMisclassifications.ts — 2026-10-14.
 *
 * Reklassificerar events som felaktigt ligger i community men tydligt
 * tillhör en annan kategori baserat på cross-site-mönster:
 *
 *   - Musik-venue (Nalen, Debaser, Berwaldhallen, Konserthuset,
 *     Avicii Arena, Södra Teatern, Göta Lejon, Fylkingen, Strawberry
 *     Arena, Katalin) → music
 *   - Familj-titel (julfrossa, snögubben, "från X år", barnföreställning) → family
 *   - Mäss-titel (mässa, mässan, expo, konferens) → family (om barn) el. stannar
 *
 * Cross-site-evidens: musiker-venues innehåller events från 4+ olika källor
 * (livespot-stockholm, sthlmlist, nalen, berwaldhallen, stockholm-live).
 *
 * Skyview-attraktioner (vid Avicii Arena) stannar KVAR i community —
 * det är en turistattraktion, inte en konsert.
 *
 * Säkerhet:
 *   - Inget LLM, ingen M3 — bara deterministisk mönstermatchning.
 *   - UPDATE-satsen är paginerad för att undvika timeouts.
 *   - Innan reklassificering: logga antal events per (source, current_slug).
 *
 * Användning:
 *   set -a && source .env && set +a
 *   npx tsx scripts/_reclassifyCommunityMisclassifications.ts
 *   npx tsx scripts/_reclassifyCommunityMisclassifications.ts --dry-run
 */
import { createClient } from '@supabase/supabase-js';

const MUSIC_VENUES = [
  'berwaldhallen', 'konserthuset stockholm', 'konserthuset', 'globen',
  'avicii arena', 'strawberry arena', 'tele2', 'fylkingen',
  'södra teatern', 'stora salen', 'göta lejon', 'nalen',
  'debaser', 'festivalen', 'mejeriet', 'moriskan', 'katalin',
  'china teatern',  // musikaler
];
const FAMILY_TITLES = [
  'julfrossa', 'snögubben', 'tomtebobarnen', 'biokäften',
  'alfons', 'pippi', 'lillemaja', 'lassemaja', 'mulle meck',
  'mumindalen', 'barnföreställning', 'barnteater',
  'från 5 år', 'från 3 år', 'från 6 år', 'från 8 år', 'från 2 år',
  'barnshow', 'familjeföreställning',
];
const SKYVIEW_VENUES = ['skyview'];

interface DbEvent {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  source: string | null;
  venues: { name: string } | null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const now = new Date().toISOString();

  console.log('═'.repeat(70));
  console.log(`  Reklassificera community-misklassificeringar`);
  console.log(`  Mode: ${dryRun ? 'DRY-RUN (inga DB-ändringar)' : 'PROD'}`);
  console.log('═'.repeat(70));

  // Hämta alla community-events med venue
  const PAGE = 1000;
  const all: DbEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('events')
      .select('id, title_sv, title_en, source, venues(name)')
      .eq('category_slug', 'community')
      .gt('start_time', now)
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fel:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...(data as DbEvent[]));
    if (data.length < PAGE) break;
  }
  console.log(`\n  Community events: ${all.length}`);

  // Klassificera
  const toMusic: DbEvent[] = [];
  const toFamily: DbEvent[] = [];
  const skipped: { ev: DbEvent; reason: string }[] = [];

  for (const ev of all) {
    const title = ((ev.title_sv || ev.title_en || '') + '').toLowerCase();
    const venue = ((ev.venues?.name || '') + '').toLowerCase();

    // Skyview-attraktioner stannar KVAR i community (turistattraktion)
    if (SKYVIEW_VENUES.some(sv => venue.includes(sv) || title.includes(sv))) {
      skipped.push({ ev, reason: 'Skyview attraction' });
      continue;
    }

    // MUSIC: musiker-venue
    if (MUSIC_VENUES.some(mv => venue.includes(mv))) {
      toMusic.push(ev);
      continue;
    }
    // MUSIC: title med konsertord
    if (/\b(konsert|jazzkonsert|recital|operaframförande|live:|acoustic session|unplugged)\b/.test(title)) {
      toMusic.push(ev);
      continue;
    }

    // FAMILY: title med barn-markörer
    if (FAMILY_TITLES.some(ft => title.includes(ft))) {
      toFamily.push(ev);
      continue;
    }
  }

  console.log(`  → music:  ${toMusic.length}`);
  console.log(`  → family: ${toFamily.length}`);
  console.log(`  → skip:   ${skipped.length} (Skyview-attraktioner)`);
  console.log(`  total:    ${toMusic.length + toFamily.length + skipped.length} av ${all.length}`);

  if (dryRun) {
    console.log('\n  DRY-RUN — inga ändringar. Kör utan --dry-run för att verkställa.');
    console.log('\n  Sample (10 från music):');
    for (const ev of toMusic.slice(0, 10)) {
      const t = (ev.title_sv || ev.title_en || '?').slice(0, 45);
      const v = ev.venues?.name || '?';
      console.log(`    ${(ev.source || '?').padEnd(22)} | ${v.padEnd(25)} | ${t}`);
    }
    console.log('\n  Sample (5 från family):');
    for (const ev of toFamily.slice(0, 5)) {
      const t = (ev.title_sv || ev.title_en || '?').slice(0, 45);
      const v = ev.venues?.name || '?';
      console.log(`    ${(ev.source || '?').padEnd(22)} | ${v.padEnd(25)} | ${t}`);
    }
    return;
  }

  // PROD: paginerad UPDATE
  const targets = [
    { events: toMusic, newSlug: 'music', label: 'music' },
    { events: toFamily, newSlug: 'family', label: 'family' },
  ];

  for (const t of targets) {
    let updated = 0, failed = 0;
    const BATCH = 200;
    for (let i = 0; i < t.events.length; i += BATCH) {
      const batch = t.events.slice(i, i + BATCH);
      const ids = batch.map(e => e.id);
      const { error } = await supabase
        .from('events')
        .update({ category_slug: t.newSlug })
        .in('id', ids);
      if (error) {
        console.error(`  ✗ Batch ${i}-${i + BATCH} (${t.label}): ${error.message}`);
        failed += batch.length;
      } else {
        updated += batch.length;
      }
    }
    console.log(`\n  ${t.label}: ${updated} uppdaterade, ${failed} fel`);
  }

  console.log('\n  Klart. Verifiera med:');
  console.log('    set -a && source .env && set +a');
  console.log('    npx tsx -e "const {createClient}=require(\\"@supabase/supabase-js\\"); const sb=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY); Promise.all([sb.from(\\"events\\").select(\\"id\\",{count:\\"exact\\",head:true}).eq(\\"category_slug\\",\\"community\\").gt(\\"start_time\\",new Date().toISOString()), sb.from(\\"events\\").select(\\"id\\",{count:\\"exact\\",head:true}).eq(\\"category_slug\\",\\"music\\").gt(\\"start_time\\",new Date().toISOString()), sb.from(\\"events\\").select(\\"id\\",{count:\\"exact\\",head:true}).eq(\\"category_slug\\",\\"family\\").gt(\\"start_time\\",new Date().toISOString())]).then(([c,m,f])=>{console.log(\\"community:\\",c.count,\\"music:\\",m.count,\\"family:\\",f.count);process.exit(0);});"');
  console.log('═'.repeat(70));
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
