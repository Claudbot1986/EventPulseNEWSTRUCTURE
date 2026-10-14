import { createClient } from '@supabase/supabase-js';

interface Candidate {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  venue: string | null;
  source: string | null;
  reason: string;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();

  // Hämta alla community-events med venue info
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('events')
      .select('id, title_sv, title_en, source, venues(name)')
      .eq('category_slug', 'community')
      .gt('start_time', now)
      .range(from, from + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`Community events: ${all.length}`);

  // Multi-source-mönster (cross-site, inte site-specifikt):
  //   1. Musiker-venues (concert halls, music clubs) — cross-site-bevisat
  //   2. Familjesignaler (barn, från X år, jul-) — cross-site-bevisat
  //   3. Mäss-signaler (mässa, expo, mässan) — cross-site-bevisat
  //   4. Stadsvandring/guidad — cross-site-bevisat
  const MUSIC_VENUES = [
    'berwaldhallen', 'konserthuset stockholm', 'konserthuset', 'globen',
    'avicii arena', 'strawberry arena', 'tele2', 'fylkingen',
    'södra teatern', 'stora salen', 'göta lejon', 'nalen',
    'debaser', 'festivalen', 'mejeriet', 'moriskan', 'katalin',
  ];
  const FAMILY_TITLES = ['julfrossa', 'snögubben', 'tomtebobarnen', 'biokäften', 'alfons', 'pippi', 'lillemaja', 'lassemaja', 'mulle meck', 'mumindalen', 'barnföreställning', 'barnteater', 'från 5 år', 'från 3 år', 'från 6 år', 'från 8 år', 'från 2 år', 'barnshow'];
  const FAIR_TITLES = ['mässa', 'mässan', 'expo', 'konferens', 'kongress'];
  const TOUR_TITLES = ['stadsvandring', 'guidad visning', 'guidad tur', 'guidning'];
  const SKYVIEW_VENUES = ['skyview'];  // Skyview är turistattraktion, inte konsert

  const likelyMusic: Candidate[] = [];
  const likelyFamily: Candidate[] = [];
  const likelyFair: Candidate[] = [];
  const likelyTour: Candidate[] = [];
  const reviewed: Candidate[] = [];

  for (const ev of all) {
    const title = ((ev.title_sv || ev.title_en || '') + '').toLowerCase();
    const venue = ((ev.venues as any)?.name || '').toLowerCase();
    const source = ev.source || '?';

    // Skippa Skyview-attraktioner (även om de är på Avicii Arena)
    if (SKYVIEW_VENUES.some(sv => venue.includes(sv) || title.includes(sv))) {
      reviewed.push({ ...ev, venue: (ev.venues as any)?.name, reason: 'SKYVIEW attraction' });
      continue;
    }

    // MUSIC: musiker-venue (cross-site bevisat på Nalen/Berwaldhallen/Södra Teatern/...)
    if (MUSIC_VENUES.some(mv => venue.includes(mv))) {
      likelyMusic.push({ ...ev, venue: (ev.venues as any)?.name, reason: `music venue: ${venue}` });
      continue;
    }

    // MUSIC: title med konsert/festival/jazzkonsert/live
    if (/\b(konsert|jazzkonsert|recital|operaframförande|live:|acoustic session|unplugged)\b/.test(title)) {
      likelyMusic.push({ ...ev, venue: (ev.venues as any)?.name, reason: `music title keyword: ${title.slice(0, 50)}` });
      continue;
    }

    // FAMILY: title med barn-från-X-år
    if (FAMILY_TITLES.some(ft => title.includes(ft))) {
      likelyFamily.push({ ...ev, venue: (ev.venues as any)?.name, reason: `family title: ${title.slice(0, 50)}` });
      continue;
    }

    // FAIR: title med mässa
    if (FAIR_TITLES.some(ft => title.includes(ft))) {
      likelyFair.push({ ...ev, venue: (ev.venues as any)?.name, reason: `fair title: ${title.slice(0, 50)}` });
      continue;
    }

    // TOUR: title med stadsvandring
    if (TOUR_TITLES.some(tt => title.includes(tt))) {
      likelyTour.push({ ...ev, venue: (ev.venues as any)?.name, reason: `tour title: ${title.slice(0, 50)}` });
      continue;
    }
  }

  console.log();
  console.log('=== LIKELY MUSIC (för reklassificering community → music) ===');
  console.log(`Antal: ${likelyMusic.length}`);
  const byVenue: Record<string, number> = {};
  for (const c of likelyMusic) byVenue[c.venue || '?'] = (byVenue[c.venue || '?'] ?? 0) + 1;
  console.log('Per venue:');
  for (const [v, c] of Object.entries(byVenue).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${c.toString().padStart(4)}  ${v}`);
  }
  console.log();
  console.log('=== LIKELY FAMILY ===');
  console.log(`Antal: ${likelyFamily.length}`);
  console.log();
  console.log('=== LIKELY FAIR ===');
  console.log(`Antal: ${likelyFair.length}`);
  console.log();
  console.log('=== LIKELY TOUR ===');
  console.log(`Antal: ${likelyTour.length}`);
  console.log();
  console.log('=== SAMPLES LIKELY-MUSIC (15) ===');
  for (const c of likelyMusic.slice(0, 15)) {
    const t = (c.title_sv || c.title_en || '?').slice(0, 45);
    console.log(`  ${(c.source || '?').padEnd(22)} | ${(c.venue || '?').padEnd(28)} | ${t}`);
    console.log(`    reason: ${c.reason}`);
  }
  console.log();
  console.log('=== TOTAL SOM VI TOUCHAR ===');
  console.log(`music:  ${likelyMusic.length}`);
  console.log(`family: ${likelyFamily.length}`);
  console.log(`fair:   ${likelyFair.length}`);
  console.log(`tour:   ${likelyTour.length}`);
  console.log(`skip:   ${reviewed.length} (Skyview)`);
  console.log(`totalt: ${likelyMusic.length + likelyFamily.length + likelyFair.length + likelyTour.length + reviewed.length} av ${all.length}`);
}
main();
