import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Paginate through ALL events to get accurate counts
  const PAGE = 1000;
  const counts = new Map<string, number>();
  let total = 0;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('category_slug')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error(error); return; }
    if (data && data.length > 0) {
      for (const e of data) {
        const s = e.category_slug ?? '(null)';
        counts.set(s, (counts.get(s) ?? 0) + 1);
        total++;
      }
      offset += data.length;
      hasMore = data.length === PAGE;
    } else hasMore = false;
  }

  console.log(`Total events: ${total}\n`);
  console.log('category_slug'.padEnd(22) + 'events');
  console.log('─'.repeat(35));
  let totalCat = 0;
  for (const [slug, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(slug.padEnd(22) + String(n).padStart(6));
    totalCat += n;
  }
  console.log('─'.repeat(35));
  console.log('TOTAL'.padEnd(22) + String(totalCat).padStart(6));
}

main().catch(console.error);
