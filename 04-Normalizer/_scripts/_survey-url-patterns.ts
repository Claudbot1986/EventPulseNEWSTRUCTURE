import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Get top sources by event count
  const { data } = await supabase
    .from('events')
    .select('source, ticket_url')
    .not('ticket_url', 'is', null)
    .gte('start_time', new Date(Date.now() - 30 * 86400 * 1000).toISOString())
    .limit(2000);
  
  if (!data) return;

  // Group by source, sample 3 URLs each
  const bySource = new Map<string, string[]>();
  for (const e of data) {
    const s = e.source ?? '(null)';
    if (!bySource.has(s)) bySource.set(s, []);
    const list = bySource.get(s)!;
    if (list.length < 3 && e.ticket_url) list.push(e.ticket_url);
  }

  // For top 15 sources, extract URL paths and look for category indicators
  console.log('Top sources — sample URL paths:\n');
  const sources = [...bySource.entries()].slice(0, 15);
  for (const [source, urls] of sources) {
    console.log(`\n=== ${source} ===`);
    for (const url of urls) {
      try {
        const u = new URL(url);
        const path = u.pathname;
        // Look for category-indicative segments
        const segs = path.split('/').filter(Boolean);
        console.log(`  ${u.hostname.replace(/^www\./, '')}${path.slice(0, 80)}`);
        // Highlight interesting path parts
        const interesting = segs.filter(s => /konsert|teater|dans|film|barn|utställ|show|föreställ|evenemang|event|gala|opera|kultur|mat|festival|loppis|marknad|spel|sport|match/i.test(s));
        if (interesting.length > 0) {
          console.log(`    INTERESTING: ${interesting.join('/')}`);
        }
      } catch { /* skip */ }
    }
  }
}

main().catch(console.error);
