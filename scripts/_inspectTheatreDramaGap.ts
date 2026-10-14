import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();

  const { data, error } = await sb.from('events')
    .select('id, title_sv, title_en, start_time, eventpulse_summary, raw_description, venues(name)')
    .eq('category_slug', 'theatre-drama')
    .gt('start_time', now)
    .is('eventpulse_summary', null)
    .limit(30);
  if (error) { console.error(error); process.exit(1); }
  console.log(`Theatre-drama events WITHOUT summary: ${(data || []).length}`);
  for (const r of data ?? []) {
    const t = (r.title_sv || r.title_en || '?').slice(0, 45);
    const v = (r.venues as any)?.name || '?';
    const raw = (r.raw_description || '').slice(0, 70);
    console.log(`  ${t.padEnd(45)} @ ${v.slice(0, 22)} | start=${r.start_time?.slice(0, 16) || 'NULL'}`);
    console.log(`    raw: ${raw}`);
  }
}
main();
