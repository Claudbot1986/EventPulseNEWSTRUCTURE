import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await c
    .from('events')
    .select('id, start_time')
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
    .eq('source', 'folkoperan')
    .order('start_time');

  const now = new Date();
  let past = 0, future = 0;
  for (const r of data ?? []) {
    if (!r.start_time) continue;
    if (new Date(r.start_time) < now) past++;
    else future++;
  }
  console.log(`Totalt: ${data?.length}`);
  console.log(`Passerat start_time: ${past}`);
  console.log(`Framtida: ${future}`);

  console.log(`\nDatumintervall:`);
  const dates = (data ?? []).map(r => r.start_time?.slice(0, 10) ?? '').filter(Boolean).sort();
  if (dates.length > 0) {
    console.log(`  Första: ${dates[0]}`);
    console.log(`  Sista:  ${dates[dates.length - 1]}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });