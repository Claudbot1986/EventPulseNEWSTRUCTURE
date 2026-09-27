import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Pick a small number of events
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .is('link_last_checked_at', null)
    .limit(5);

  console.log(`Found ${events?.length} events to test`);

  for (const e of events ?? []) {
    const t0 = Date.now();
    const { error } = await supabase.rpc('update_link_health_cf', {
      p_event_id: e.id,
      p_new_status: 'ok',
      p_checked_at: new Date().toISOString(),
    });
    const dt = Date.now() - t0;
    if (error) {
      console.log(`  FAIL ${e.id}: ${error.message} (${dt}ms)`);
    } else {
      console.log(`  OK   ${e.id} (${dt}ms)`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
