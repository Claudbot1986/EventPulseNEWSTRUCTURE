import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. Vad hände med title_en för de 69 orphan?
  const { data: orphan } = await c
    .from('events')
    .select('id, title_sv, title_en, start_time')
    .eq('source', 'folkoperan')
    .eq('title_sv', 'Folkoperan')
    .order('start_time');

  console.log(`Orphan (title_sv=Folkoperan): ${orphan?.length}`);
  let enAlsoFolkoperan = 0;
  let enDifferent = 0;
  for (const r of orphan ?? []) {
    if (r.title_en === 'Folkoperan') enAlsoFolkoperan++;
    else enDifferent++;
  }
  console.log(`  title_en också 'Folkoperan': ${enAlsoFolkoperan}`);
  console.log(`  title_en annorlunda: ${enDifferent}`);

  // 2. Hur ser orphan-start_time ut?
  const dates = (orphan ?? []).map(r => r.start_time?.slice(0, 10) ?? '').filter(Boolean).sort();
  console.log(`\nOrphan start_time-intervall:`);
  if (dates.length > 0) {
    console.log(`  Första: ${dates[0]}`);
    console.log(`  Sista:  ${dates[dates.length - 1]}`);
  }

  // 3. Är dessa events från 2026-12 (dvs bortom nuvarande HTML-omfång)?
  const byMonth = new Map<string, number>();
  for (const d of dates) {
    const ym = d.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1);
  }
  console.log(`\nPer månad:`);
  for (const [ym, n] of Array.from(byMonth.entries()).sort()) {
    console.log(`  ${ym}: ${n}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });