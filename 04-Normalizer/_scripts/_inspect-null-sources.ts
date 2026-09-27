import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('id, source, source_id, ticket_url, raw_data, created_at')
    .is('source', null)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) { console.error(error); return; }
  for (const e of data ?? []) {
    console.log(`---`);
    console.log(`id:        ${e.id}`);
    console.log(`source:    ${e.source}`);
    console.log(`source_id: ${(e.source_id ?? '').slice(0, 60)}`);
    console.log(`url:       ${(e.ticket_url ?? '').slice(0, 80)}`);
    console.log(`created:   ${e.created_at}`);
    if (e.raw_data && typeof e.raw_data === 'object') {
      const rd = e.raw_data as Record<string, unknown>;
      console.log(`raw.source:    ${JSON.stringify(rd.source ?? '?')}`);
      console.log(`raw.source_id: ${JSON.stringify((rd.source_id ?? '').toString().slice(0, 60))}`);
    }
  }
}

main().catch(console.error);
