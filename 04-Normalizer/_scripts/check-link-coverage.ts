import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { count: totalEvents } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published');

  const { count: withUrl } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null);

  const { count: checked } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('link_last_checked_at', 'is', null);

  const { data: latestCheck } = await supabase
    .from('events')
    .select('link_last_checked_at')
    .not('link_last_checked_at', 'is', null)
    .order('link_last_checked_at', { ascending: false })
    .limit(1)
    .single();

  const { data: earliestCheck } = await supabase
    .from('events')
    .select('link_last_checked_at')
    .not('link_last_checked_at', 'is', null)
    .order('link_last_checked_at', { ascending: true })
    .limit(1)
    .single();

  console.log(`Totalt events (published):         ${totalEvents}`);
  console.log(`Events med ticket_url:              ${withUrl}`);
  console.log(`Events som HAR kollats någonsin:   ${checked}`);
  console.log(`Aldrig-kontrollerade:               ${(withUrl ?? 0) - (checked ?? 0)}`);
  console.log(`Första check-tidpunkt:              ${earliestCheck?.link_last_checked_at ?? '(ingen)'}`);
  console.log(`Senaste check-tidpunkt:             ${latestCheck?.link_last_checked_at ?? '(ingen)'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
