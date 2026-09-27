import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: rows } = await supabase
    .from('events')
    .select('source')
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .gte('start_time', new Date().toISOString());

  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  console.log(`Antal källor med framtida events + ticket_url: ${sorted.length}`);
  console.log(`Totalt antal framtida events med ticket_url:   ${rows?.length ?? 0}`);
  console.log('TOP 15 källor (efter antal events):');
  for (const [src, n] of sorted.slice(0, 15)) {
    console.log(`  ${String(n).padStart(5)} — ${src}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
