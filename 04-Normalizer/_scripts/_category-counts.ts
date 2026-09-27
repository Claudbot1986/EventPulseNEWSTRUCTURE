import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Get all categories
  const { data: cats } = await supabase
    .from('categories')
    .select('slug, name_sv, name_en, sort_order')
    .order('sort_order', { ascending: true });

  // Count events per category_slug (the denormalized primary slug column)
  const { data: counts, error } = await supabase
    .rpc('count_events_by_category');
  
  if (error) {
    // Fallback: query directly
    const { data: events } = await supabase
      .from('events')
      .select('category_slug')
      .eq('status', 'published');
    const map = new Map<string, number>();
    for (const e of events ?? []) {
      const s = e.category_slug ?? '(null)';
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    const total = events?.length ?? 0;
    console.log(`Totalt events (status=published): ${total}\n`);
    console.log('category_slug'.padEnd(22) + 'events');
    console.log('─'.repeat(35));
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    for (const [slug, n] of sorted) {
      console.log(slug.padEnd(22) + String(n).padStart(6));
    }
    // Categories with 0 events
    console.log('\n0 events:');
    for (const c of cats ?? []) {
      if (!map.has(c.slug)) console.log(`  ${c.slug}`);
    }
    return;
  }
  console.log('RPC:', counts);
}

main().catch(console.error);
