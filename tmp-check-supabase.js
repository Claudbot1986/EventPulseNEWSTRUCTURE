import * as dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('id, source_id, source, title_sv, venue_id, start_time, is_free')
    .limit(20);

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  console.log('Events in Supabase:', data?.length ?? 0);
  for (const e of data ?? []) {
    console.log(`  [${e.source}] ${e.title_sv} | venue:${e.venue_id} | ${e.start_time}`);
  }
}

main();
