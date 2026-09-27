import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();
  const { count: uncheckedPast } = await c.from('events').select('id', { count: 'exact', head: true })
    .eq('status', 'published').not('ticket_url', 'is', null)
    .is('link_last_checked_at', null).lt('start_time', now);
  const { count: uncheckedFuture } = await c.from('events').select('id', { count: 'exact', head: true })
    .eq('status', 'published').not('ticket_url', 'is', null)
    .is('link_last_checked_at', null).gte('start_time', now);
  const { count: totalUnchecked } = await c.from('events').select('id', { count: 'exact', head: true })
    .eq('status', 'published').not('ticket_url', 'is', null)
    .is('link_last_checked_at', null);
  console.log('Aldrig-kontrollerade totalt:    ', totalUnchecked);
  console.log('  i dåtid (start_time < now):  ', uncheckedPast);
  console.log('  i framtid (start_time >= now):', uncheckedFuture);
}
main().catch((e) => { console.error(e); process.exit(1); });