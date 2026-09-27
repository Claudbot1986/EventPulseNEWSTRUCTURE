import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // What statuses exist?
  const { data: statusData } = await supabase
    .from('events')
    .select('status');
  const sm = new Map<string, number>();
  for (const e of statusData ?? []) {
    const s = e.status ?? '(null)';
    sm.set(s, (sm.get(s) ?? 0) + 1);
  }
  console.log('Status counts:');
  for (const [s, n] of [...sm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(s ?? 'null').padEnd(15)} ${n}`);
  }

  // When status='published', also check start_time (might be future/past)
  const { data: pt } = await supabase
    .from('events')
    .select('start_time, status')
    .eq('status', 'published');
  const now = Date.now();
  let future = 0, past = 0;
  for (const e of pt ?? []) {
    const t = Date.parse(e.start_time ?? '');
    if (t > now) future++;
    else past++;
  }
  console.log(`\nstatus=published:`);
  console.log(`  future start: ${future}`);
  console.log(`  past start:   ${past}`);

  // Now show category counts for status=published AND future (what users actually see)
  const { data: pubFuture } = await supabase
    .from('events')
    .select('category_slug')
    .eq('status', 'published')
    .gte('start_time', new Date().toISOString());
  console.log(`\nPublished+future: ${pubFuture?.length ?? 0} events`);

  // Now full breakdown
  const cm = new Map<string, number>();
  for (const e of pubFuture ?? []) cm.set(e.category_slug ?? '(null)', (cm.get(e.category_slug ?? '(null)') ?? 0) + 1);
  console.log('\nPer category (published + future):');
  for (const [s, n] of [...cm.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(s ?? 'null').padEnd(22)} ${n}`);
  }
}

main().catch(console.error);
