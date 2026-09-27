import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Total count (all statuses)
  const { count: totalAll } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });
  console.log(`Total events (alla status): ${totalAll}`);

  // By status
  const { data: byStatus } = await supabase
    .from('events')
    .select('status');
  const sm = new Map<string, number>();
  for (const e of byStatus ?? []) sm.set(e.status ?? '(null)', (sm.get(e.status ?? '(null)') ?? 0) + 1);
  console.log('\nPer status:');
  for (const [s, n] of [...sm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(s ?? 'null').padEnd(12)} ${n}`);
  }

  // By category_slug (all statuses, all events)
  const { data: byCat } = await supabase
    .from('events')
    .select('category_slug');
  const cm = new Map<string, number>();
  for (const e of byCat ?? []) cm.set(e.category_slug ?? '(null)', (cm.get(e.category_slug ?? '(null)') ?? 0) + 1);
  console.log('\nPer category_slug (alla status):');
  for (const [s, n] of [...cm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(s ?? 'null').padEnd(22)} ${n}`);
  }
}

main().catch(console.error);
