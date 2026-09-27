import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Check what the booking-domain events had as source BEFORE we fixed them.
  // We can't see that, but we can check which source ids exist with that prefix
  // and see if any raw_data was captured for those that had source=NULL.

  // Get all unique sources whose ticket_url contains boka.berwaldhallen
  const { data: events } = await supabase
    .from('events')
    .select('source, source_id, ticket_url, raw_data')
    .like('ticket_url', '%boka.berwaldhallen%')
    .order('created_at', { ascending: false })
    .limit(50);

  console.log('Recent boka.berwaldhallen events:');
  const sources = new Map<string, number>();
  for (const e of events ?? []) {
    const s = e.source ?? '(null)';
    sources.set(s, (sources.get(s) ?? 0) + 1);
  }
  for (const [s, n] of sources) console.log(`  ${s}: ${n}`);
  console.log('\nSample raw_data shapes:');
  for (const e of (events ?? []).slice(0, 3)) {
    console.log(`  source=${e.source}  source_id=${(e.source_id ?? 'null').slice(0, 50)}`);
    if (e.raw_data && typeof e.raw_data === 'object') {
      console.log(`    raw keys: ${Object.keys(e.raw_data as object).slice(0, 20).join(', ')}`);
    }
  }
}

main().catch(console.error);
