import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Use count queries for accurate distribution
  const { count: total } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null);

  const { count: checked } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .not('link_last_checked_at', 'is', null);

  const { count: ok } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .eq('link_status', 'ok');

  const { count: broken } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .eq('link_status', 'broken');

  const { count: neverChecked } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .is('link_last_checked_at', null);

  const { count: cf2plus } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .gte('consecutive_broken_count', 2);

  console.log(`Totalt (published + has ticket_url): ${total}`);
  console.log(`Någonsin HEAD-kontrollerade:         ${checked}`);
  console.log(`  ok:                                ${ok}`);
  console.log(`  broken:                            ${broken}`);
  console.log(`Aldrig kontrollerade:                ${neverChecked}`);
  console.log(`consecutive_broken_count >= 2:       ${cf2plus}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
