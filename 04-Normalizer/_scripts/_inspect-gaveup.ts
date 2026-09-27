/**
 * _inspect-gaveup.ts — undersök 189 'gave up'-events (LLM-batch "för lite info")
 * Hämtar events som v2-batchen slutgiltigt lämnade som `community`,
 * tittar på reasoning + titel + källa + beskrivningslängd.
 *
 * 2026-09-27: inga DB-mutationer, read-only.
 */
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error('Supabase creds missing');

const supabase = createClient(url, key, { auth: { persistSession: false } });

const VAULT_DIR = path.resolve(__dirname, '../../00-Vault/01-Projects/EventPulse/04-Sources');
const SUGGESTIONS = path.join(VAULT_DIR, 'retag-suggestions-v2-2026-09-27.jsonl');

interface Suggestion {
  id: string;
  slugs: string[];
  reasoning: string;
}

async function fetchAllCommunityEventIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('id')
      .eq('category_slug', 'community')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) ids.add(r.id);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return ids;
}

async function fetchEventTitles(ids: string[]): Promise<Map<string, { title: string; source: string; description: string | null; venue_name: string | null }>> {
  const out = new Map<string, { title: string; source: string; description: string | null; venue_name: string | null }>();
  // batched lookup: chunks of 200 ids
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, source, description_sv, description_en, location')
      .in('id', slice);
    if (error) throw error;
    if (data) for (const r of data) {
      out.set(r.id, {
        title: r.title_sv ?? r.title_en ?? '',
        source: r.source ?? '',
        description: r.description_sv ?? r.description_en ?? null,
        venue_name: r.location ?? null,
      });
    }
  }
  return out;
}

async function main() {
  const lines = fs.readFileSync(SUGGESTIONS, 'utf8').trim().split('\n').filter(Boolean);
  const suggestions: Suggestion[] = lines.map(l => JSON.parse(l));
  const gaveup = suggestions.filter(s => s.slugs.length === 1 && s.slugs[0] === 'community');
  console.log(`Total v2-suggestions: ${suggestions.length}`);
  console.log(`"Gave up" (only community): ${gaveup.length}`);

  // Reasonings — letar efter "för lite info"-mönster
  const reasoningPatterns = new Map<string, number>();
  for (const g of gaveup) {
    const r = (g.reasoning ?? '').toLowerCase();
    let matched = false;
    if (r.includes('lite info') || r.includes('limited info') || r.includes('för lite')) {
      reasoningPatterns.set('för_lite_info', (reasoningPatterns.get('för_lite_info') ?? 0) + 1);
      matched = true;
    }
    if (r.includes('saknar') || r.includes('missing') || r.includes('no description')) {
      reasoningPatterns.set('saknar_beskrivning', (reasoningPatterns.get('saknar_beskrivning') ?? 0) + 1);
      matched = true;
    }
    if (r.includes('inte specifik') || r.includes('not specific') || r.includes('too generic')) {
      reasoningPatterns.set('för_generisk', (reasoningPatterns.get('för_generisk') ?? 0) + 1);
      matched = true;
    }
    if (!matched) reasoningPatterns.set('övrigt', (reasoningPatterns.get('övrigt') ?? 0) + 1);
  }
  console.log('\nReasoning-patterns:');
  for (const [k, v] of reasoningPatterns) console.log(`  ${k.padEnd(20)} ${v}`);

  // Hämta titlar
  const ids = gaveup.map(g => g.id);
  console.log(`\nHämtar ${ids.length} event-detaljer (titel, källa, beskrivning, venue)...`);
  const titles = await fetchEventTitles(ids);

  // Källa-fördelning
  const sources = new Map<string, number>();
  const descLengths: number[] = [];
  let missingDesc = 0;
  for (const g of gaveup) {
    const ev = titles.get(g.id);
    if (!ev) { sources.set('(unknown)', (sources.get('(unknown)') ?? 0) + 1); continue; }
    sources.set(ev.source ?? '(null)', (sources.get(ev.source ?? '(null)') ?? 0) + 1);
    if (!ev.description || ev.description.length === 0) missingDesc++;
    else descLengths.push(ev.description.length);
  }
  // Sätt location istället för venue_name i CSV
  console.log('\nTop 10 källor:');
  for (const [k, v] of [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${k.padEnd(35)} ${v}`);
  }

  console.log(`\nMissing description: ${missingDesc} / ${gaveup.length}`);
  if (descLengths.length) {
    descLengths.sort((a, b) => a - b);
    const median = descLengths[Math.floor(descLengths.length / 2)];
    const avg = Math.round(descLengths.reduce((a, b) => a + b, 0) / descLengths.length);
    console.log(`Description length — median: ${median}, mean: ${avg}, max: ${descLengths[descLengths.length - 1]}`);
  }

  // Title-keyword frekvens
  const wordCounts = new Map<string, number>();
  for (const g of gaveup) {
    const ev = titles.get(g.id);
    if (!ev?.title) continue;
    const words = ev.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    for (const w of words) {
      wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    }
  }
  console.log('\nTop 25 title-ord (längd > 3):');
  for (const [w, c] of [...wordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${w.padEnd(20)} ${c}`);
  }

  // Skriv CSV för manuell granskning
  const csvPath = path.join(VAULT_DIR, 'gaveup-events-2026-09-27.csv');
  const rows: string[] = ['id,source,title,venue,desc_len,reasoning'];
  for (const g of gaveup) {
    const ev = titles.get(g.id);
    const esc = (v: string | null | undefined) => (v ?? '').replace(/"/g, '""').slice(0, 200);
    rows.push(`${g.id},${esc(ev?.source)},${esc(ev?.title)},${esc(ev?.venue_name)},${ev?.description?.length ?? 0},${esc(g.reasoning)}`);
  }
  void fetchAllCommunityEventIds; // not used in this run
  fs.writeFileSync(csvPath, rows.join('\n') + '\n', 'utf8');
  console.log(`\nCSV skriven: ${csvPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
