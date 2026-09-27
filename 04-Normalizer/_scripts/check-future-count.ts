import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // What does "future" really include?
  const { data: rows } = await supabase
    .from('events')
    .select('id, source, start_time, status')
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .gte('start_time', new Date().toISOString())
    .limit(10);
  console.log('Sample 10 "future" rows:');
  for (const r of rows ?? []) {
    console.log(`  start_time=${r.start_time}  source=${r.source}`);
  }

  // How many have NULL start_time?
  const { count: nullStart } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .is('start_time', null);
  console.log(`Events with NULL start_time: ${nullStart}`);

  // How many with future (strictly > now)?
  const now = new Date().toISOString();
  const { count: future } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .gt('start_time', now);
  console.log(`Events with start_time > now: ${future}`);

  const { count: futureOrEq } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .gte('start_time', now);
  console.log(`Events with start_time >= now: ${futureOrEq}`);

  // Maybe some events have start_time in 1900 (default)?
  const { count: old1970 } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .gte('start_time', '1970-01-01T00:00:00Z');
  console.log(`Events with start_time >= 1970: ${old1970}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
