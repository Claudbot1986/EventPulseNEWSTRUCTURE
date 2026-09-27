import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Hämta alla 106 events med rätt kolumner (använd range för paginering)
  const all: any[] = [];
  let offset = 0;
  const PAGE = 200;
  while (true) {
    const { data, error } = await c.from('events').select('id, source, title_sv, title_en, ticket_url, start_time, created_at, freshness_at')
      .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('Error:', error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`Totalt ${all.length} events med titel "Folkoperan"`);

  // Per source
  const bySource = new Map<string, number>();
  for (const r of all) {
    bySource.set(r.source ?? '(null)', (bySource.get(r.source ?? '(null)') ?? 0) + 1);
  }
  console.log('PER source:');
  for (const [s, n] of Array.from(bySource.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} — ${s}`);
  }

  // ticket_url-mönster (för att förstå vilken kö som producerade dem)
  const urlPatterns = new Map<string, number>();
  for (const r of all) {
    const url = r.ticket_url ?? '(null)';
    let key = url;
    try {
      const u = new URL(url);
      key = `${u.hostname}${u.pathname.split('/').slice(0, 5).join('/')}`;
    } catch {}
    urlPatterns.set(key, (urlPatterns.get(key) ?? 0) + 1);
  }
  console.log('');
  console.log('TICKET_URL-mönster (top 10):');
  for (const [u, n] of Array.from(urlPatterns.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(4)} — ${u.slice(0, 110)}`);
  }

  // Skapade över tid
  const byDate = new Map<string, number>();
  for (const r of all) {
    const d = (r.created_at ?? '').slice(0, 10);
    byDate.set(d, (byDate.get(d) ?? 0) + 1);
  }
  console.log('');
  console.log('SKAPADE PER DATUM (top 10):');
  for (const [d, n] of Array.from(byDate.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${d} — ${n}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });