import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Inspect recent berwaldhallen events to understand raw_data shape
  const { data, error } = await supabase
    .from('events')
    .select('id, source, source_id, ticket_url, raw_data, created_at')
    .eq('source', 'berwaldhallen')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) { console.error(error); return; }
  for (const e of data ?? []) {
    console.log(`---`);
    console.log(`id:        ${e.id}`);
    console.log(`source:    ${e.source}`);
    console.log(`source_id: ${(e.source_id ?? '').slice(0, 80)}`);
    console.log(`url:       ${(e.ticket_url ?? '').slice(0, 80)}`);
    console.log(`created:   ${e.created_at}`);
    if (e.raw_data && typeof e.raw_data === 'object') {
      const rd = e.raw_data as Record<string, unknown>;
      console.log(`raw keys: ${Object.keys(rd).slice(0, 20).join(', ')}`);
    }
  }
  console.log('\n=== Also: berwaldhallen-tixly ===');
  const { data: tixly } = await supabase
    .from('events')
    .select('id, source, source_id, ticket_url, created_at')
    .eq('source', 'berwaldhallen-tixly')
    .order('created_at', { ascending: false })
    .limit(5);
  for (const e of tixly ?? []) {
    console.log(`  ${e.id}  ${e.source_id?.slice(0, 60)}  ${(e.ticket_url ?? '').slice(0, 60)}  ${e.created_at}`);
  }
  console.log('\n=== Also: berwaldhallen-boka (booking domain?) ===');
  const { data: boka } = await supabase
    .from('events')
    .select('id, source, source_id, ticket_url, created_at')
    .like('ticket_url', '%boka.berwaldhallen.se%')
    .order('created_at', { ascending: false })
    .limit(10);
  for (const e of boka ?? []) {
    console.log(`  ${e.id}  src=${e.source}  ${e.source_id?.slice(0, 60)}  ${e.created_at}`);
  }
}

main().catch(console.error);
