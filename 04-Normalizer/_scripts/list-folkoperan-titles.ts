/**
 * list-folkoperan-titles.ts — lista alla events där titel är "Folkoperan".
 *
 * Bakgrund (Steg 3.6 audit 2026-09-27): 116 events har titel = "Folkoperan"
 * — extraheraren har tappat det riktiga event-namnet och bara tagit
 * operahusets namn. Användaren bad om en lista för att förstå vad
 * som faktiskt finns där (kanske har de description, kanske inte).
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/list-folkoperan-titles.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

interface Row {
  id: string;
  source: string;
  start_time: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  ticket_url: string | null;
  link_status: string | null;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[list-folkoperan-titles] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas');
    process.exit(1);
  }
  const c = createClient(url, key, { auth: { persistSession: false } });

  const PAGE = 1000;
  const all: Row[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await c
      .from('events')
      .select('id, source, start_time, title_sv, title_en, description_sv, description_en, ticket_url, link_status')
      .eq('status', 'published')
      .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`[list-folkoperan-titles] FATAL: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.error(`Antal events med titel "Folkoperan": ${all.length}`);
  console.error('');

  // Gruppera per källa (de flesta borde vara från folkoperan-adaptern)
  const bySource = new Map<string, number>();
  for (const r of all) {
    bySource.set(r.source ?? '(null)', (bySource.get(r.source ?? '(null)') ?? 0) + 1);
  }
  console.error('PER KÄLLA:');
  for (const [s, n] of Array.from(bySource.entries()).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(4)} — ${s}`);
  }
  console.error('');

  // Beskrivning-fynd
  const hasDesc = all.filter((r) => (r.description_sv && r.description_sv.length > 0) || (r.description_en && r.description_en.length > 0));
  console.error(`Av dessa har beskrivning (sv/en): ${hasDesc.length} / ${all.length}`);
  console.error('');

  // Sortera på start_time och skriv ut alla 116
  all.sort((a, b) => a.start_time.localeCompare(b.start_time));

  console.error('ALLA 116 events (sorterade på start_time):');
  console.error('═══════════════════════════════════════════════════════════');
  for (const r of all) {
    const date = r.start_time.slice(0, 10);
    const time = r.start_time.slice(11, 16);
    const hasDescMark = (r.description_sv && r.description_sv.length > 0) || (r.description_en && r.description_en.length > 0) ? '📝' : '  ';
    const linkMark = r.link_status === 'broken' ? '❌' : r.link_status === 'ok' ? '✅' : '  ';
    const svTitle = r.title_sv ?? '-';
    const enTitle = r.title_en ?? '-';
    console.error(`  ${date} ${time}  ${hasDescMark} ${linkMark}  [${r.source?.padEnd(12) ?? '(null)'}] sv="${svTitle.slice(0, 30)}" en="${enTitle.slice(0, 30)}"`);
  }

  // Stickprov: events som HAR beskrivning — vad står det?
  console.error('');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('STICKPROV: events som HAR beskrivning (första 5):');
  console.error('═══════════════════════════════════════════════════════════');
  for (const r of hasDesc.slice(0, 5)) {
    const date = r.start_time.slice(0, 10);
    const desc = (r.description_sv ?? r.description_en ?? '').trim();
    console.error(`  ${date} [${r.source}]`);
    console.error(`    titel: sv="${r.title_sv ?? '-'}" en="${r.title_en ?? '-'}"`);
    console.error(`    desc:  ${desc.slice(0, 200)}${desc.length > 200 ? '...' : ''}`);
    console.error('');
  }

  // Stickprov: events som SAKNAR beskrivning — först 5 + senaste
  console.error('═══════════════════════════════════════════════════════════');
  console.error('STICKPROV: events som SAKNAR beskrivning (första 5):');
  console.error('═══════════════════════════════════════════════════════════');
  const noDesc = all.filter((r) => !(r.description_sv && r.description_sv.length > 0) && !(r.description_en && r.description_en.length > 0));
  for (const r of noDesc.slice(0, 5)) {
    const date = r.start_time.slice(0, 10);
    console.error(`  ${date} [${r.source}] id=${r.id.slice(0, 8)} ticket_url=${r.ticket_url?.slice(0, 80) ?? '-'}`);
  }
  console.error(`  ...totalt ${noDesc.length} events saknar beskrivning helt`);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[list-folkoperan-titles] FATAL: ${msg}`);
  process.exit(1);
});