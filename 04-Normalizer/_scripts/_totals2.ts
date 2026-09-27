import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Get all events, check status distribution carefully
  const { data: allEvents } = await supabase
    .from('events')
    .select('id, status, category_slug');
  
  const total = allEvents?.length ?? 0;
  console.log(`Total events: ${total}`);
  
  // Status distribution
  const sm = new Map<string, number>();
  for (const e of allEvents ?? []) sm.set(e.status ?? '(null)', (sm.get(e.status ?? '(null)') ?? 0) + 1);
  console.log('\nPer status:');
  for (const [s, n] of [...sm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(s ?? 'null').padEnd(20)} ${n}`);
  }

  // Now do per-category for ALL events (regardless of status, since the DB doesn't seem to have many non-published)
  const cm = new Map<string, number>();
  for (const e of allEvents ?? []) cm.set(e.category_slug ?? '(null)', (cm.get(e.category_slug ?? '(null)') ?? 0) + 1);
  console.log('\nPer category_slug (alla events):');
  let totalCat = 0;
  for (const [s, n] of [...cm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(s ?? 'null').padEnd(22)} ${n}`);
    totalCat += n;
  }
  console.log(`  ${'─'.repeat(22)} ${totalCat}`);
}

main().catch(console.error);
