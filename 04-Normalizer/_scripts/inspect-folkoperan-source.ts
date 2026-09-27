import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data } = await c
    .from('events')
    .select('id, source, source_url, title_sv, title_en, start_time, ticket_url, created_at')
    .eq('source', 'folkoperan')
    .eq('title_sv', 'Folkoperan')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log(`Hittade ${data?.length ?? 0} events (visar 10 senaste):`);
  for (const r of data ?? []) {
    console.log(`  ${r.id.slice(0, 8)} | ${r.start_time} | src_url=${r.source_url ?? '(null)'}`);
    console.log(`    ticket_url=${r.ticket_url?.slice(0, 100) ?? '(null)'}`);
    console.log(`    created_at=${r.created_at}`);
  }

  // Räkna per source_url-mönster
  const { data: all } = await c
    .from('events')
    .select('source_url, ticket_url')
    .eq('source', 'folkoperan')
    .eq('title_sv', 'Folkoperan');

  const urlPatterns = new Map<string, number>();
  for (const r of all ?? []) {
    const url = r.source_url ?? '(null)';
    const m = url.match(/^https?:\/\/[^/]+/);
    const pattern = m ? m[0] : '(unknown)';
    urlPatterns.set(pattern, (urlPatterns.get(pattern) ?? 0) + 1);
  }
  console.log('');
  console.log('source_url-mönster:');
  for (const [p, n] of Array.from(urlPatterns.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} — ${p}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });