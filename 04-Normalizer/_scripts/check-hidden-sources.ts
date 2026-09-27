import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Find sources that have at least one event with cf>=2
  const { data: rows } = await supabase
    .from('events')
    .select('source, consecutive_broken_count')
    .eq('status', 'published')
    .not('ticket_url', 'is', null)
    .gte('consecutive_broken_count', 2);

  const sourceMap = new Map<string, { cf2: number; total: number; max_cf: number }>();
  for (const r of rows ?? []) {
    const e = sourceMap.get(r.source) ?? { cf2: 0, total: 0, max_cf: 0 };
    e.cf2++;
    if ((r.consecutive_broken_count ?? 0) > e.max_cf) e.max_cf = r.consecutive_broken_count;
    sourceMap.set(r.source, e);
  }

  // Get total events per source (so we know % hidden)
  const { data: totalRows } = await supabase
    .from('events')
    .select('source')
    .eq('status', 'published')
    .not('ticket_url', 'is', null);

  const totals = new Map<string, number>();
  for (const r of totalRows ?? []) {
    totals.set(r.source, (totals.get(r.source) ?? 0) + 1);
  }

  console.log(`Antal unika källor med cf>=2-event:  ${sourceMap.size}`);
  console.log(`Antal events med cf>=2 totalt:        ${rows?.length ?? 0}`);

  // Top sources by cf>=2 count
  const topSources = Array.from(sourceMap.entries())
    .map(([src, e]) => ({
      src,
      ...e,
      total: totals.get(src) ?? 0,
      hidden_pct: ((e.cf2 / (totals.get(src) ?? 1)) * 100).toFixed(0),
    }))
    .sort((a, b) => b.cf2 - a.cf2)
    .slice(0, 15);

  console.log('\nTOP 15 källor (cf>=2 ⇒ HELA källan döljs i UI):');
  for (const s of topSources) {
    console.log(`  ${String(s.cf2).padStart(4)} cf≥2 / ${String(s.total).padStart(4)} totalt (${s.hidden_pct}% av källan)  max_cf=${s.max_cf}  — ${s.src}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
