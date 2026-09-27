import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('id, source, source_id, ticket_url, title_sv, title_en, category_slug, start_time')
    .eq('source', 'thatsup-stockholm-articles')
    .order('start_time', { ascending: false })
    .limit(10);
  if (error) { console.error(error); return; }
  console.log(`Found ${data?.length ?? 0} events (sample):`);
  for (const e of data ?? []) {
    console.log(`  ${(e.title_sv ?? e.title_en ?? '?').slice(0, 50).padEnd(50)}  src_id=${(e.source_id ?? '').slice(0, 40).padEnd(40)}  start=${(e.start_time ?? '').slice(0, 10)}`);
  }
  
  // What URL pattern do these have?
  console.log('\nSource URLs (first 10):');
  const { data: urlData } = await supabase
    .from('events')
    .select('ticket_url')
    .eq('source', 'thatsup-stockholm-articles')
    .limit(10);
  for (const u of urlData ?? []) {
    console.log(`  ${(u.ticket_url ?? '').slice(0, 100)}`);
  }
}

main().catch(console.error);
