/**
 * audit-nav-titles-db.ts — negativ kontroll för navigations-/CTA-titlar.
 *
 * Frågan: om vi börjar blockera "Köp biljetter", "Datum", "Nyheter" … som
 * event-titlar, råkar vi då blockera riktiga events som redan finns i DB?
 *
 * Läser ALLA events (titel + source + start_time) och rapporterar:
 *   - hur många rader som exakt matchar kandidatlista
 *   - hur många av dem som ligger i framtiden (då skulle de förloras)
 *   - urval av träffarna för manuell granskning
 *
 *   npx tsx scripts/audit-nav-titles-db.ts
 */

import { createClient } from '@supabase/supabase-js';

const CANDIDATES = [
  'köp biljetter', 'biljetter', 'biljetter här', 'biljetter här.', 'mer info',
  'läs mer', 'läs mer om föreställningen', 'på startsidan', 'nyheter',
  'kalendarium', 'datum', 'på gång', 'om föreställningen', 'medverkande',
  'historik', 'click here', 'köp biljett', 'boka', 'book', 'buy',
];

const norm = (s: string | null | undefined): string =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim();

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const rows: Array<{ title: string; source: string; start_time: string | null }> = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('events')
      .select('title_sv, source, start_time')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as typeof rows));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`events i DB: ${rows.length}`);

  const set = new Set(CANDIDATES.map(norm));
  const hits = rows.filter((r) => set.has(norm(r.title)));
  const future = hits.filter((r) => !r.start_time || new Date(r.start_time) > new Date());

  console.log(`\nträffar mot kandidatlista: ${hits.length}`);
  console.log(`  varav framtida (skulle förloras vid nyimport): ${future.length}`);
  console.log('\n--- alla träffar ---');
  for (const h of hits) {
    console.log(`  ${(h.title ?? '').slice(0, 40).padEnd(40)} | ${(h.source ?? '').slice(0, 26).padEnd(26)} | ${h.start_time ?? '—'}`);
  }

  // Negativ kontroll: titles som BÖR gå igenom (liknande ord men riktiga event)
  console.log('\n--- nästan-träffar (ordet innehåller kandidatordet) ---');
  const near = rows.filter((r) => {
    const t = norm(r.title);
    if (set.has(t)) return false;
    return CANDIDATES.some((c) => t.includes(norm(c)));
  });
  const byTitle = new Map<string, number>();
  for (const r of near) byTitle.set(norm(r.title), (byTitle.get(norm(r.title)) ?? 0) + 1);
  for (const [t, n] of [...byTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`  ${String(n).padStart(4)}  ${t}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
