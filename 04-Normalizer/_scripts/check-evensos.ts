import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Verify the evensos-stockholm situation
  const { data: sample } = await supabase
    .from('events')
    .select('id, title_sv, title_en, source, ticket_url, link_status, consecutive_broken_count, link_last_checked_at')
    .eq('status', 'published')
    .eq('source', 'evensos-stockholm')
    .not('ticket_url', 'is', null)
    .order('consecutive_broken_count', { ascending: false, nullsFirst: false })
    .limit(15);

  console.log(`Sample evensos-stockholm events:`);
  for (const r of sample ?? []) {
    console.log(`  cf=${r.consecutive_broken_count}  link_status=${r.link_status}  checked=${r.link_last_checked_at?.slice(0, 16)}`);
    console.log(`    ${(r.title_sv ?? r.title_en ?? '').slice(0, 70)}`);
    console.log(`    ${(r.ticket_url ?? '').slice(0, 100)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
