#!/usr/bin/env -S npx tsx
/**
 * _build_corpus_for_category.ts — bygg saknad corpus för EN kategori
 * (full + signal + jev) från Supabase events-tabellen.
 *
 * Bakgrund (2026-10-08): Vi vill generera BFL-bilder för barn-familj
 * (2 st) och classical (1 st), men dessa saknar
 * <cat>_full.json / _signal.json / _jev.json som round5-flödet behöver.
 *
 * Output:
 *   - tmp_image_corpus/<cat>_full.json
 *   - tmp_image_corpus/<cat>_signal.json
 *   - tmp_image_corpus/<cat>_jev.json
 *
 * Säkerhet:
 *   - Default = --dry-run (skriver inte)
 *   - --apply skriver JSON-filer
 *
 * Användning:
 *   npx tsx scripts/_build_corpus_for_category.ts --only barn-familj --dry-run
 *   npx tsx scripts/_build_corpus_for_category.ts --only barn-familj --apply
 *   npx tsx scripts/_build_corpus_for_category.ts --only classical --apply
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const argIdx = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const only = argIdx('--only');
const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

const CORPUS = join(process.cwd(), 'tmp_image_corpus');
const TARGET_PER_30 = 30;

// Enkel stop-ordslista för tokenisering
const STOP_WORDS = new Set([
  'i', 'och', 'att', 'det', 'är', 'en', 'ett', 'den', 'för', 'som', 'på', 'med',
  'av', 'till', 'från', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'and',
  'or', 'but', 'föreställning', 'konsert', 'event', 'evenemang', 'stockholm',
  'på', 'i', 'vi', 'du', 'de', 'vi', 'sin', 'sitt', 'sina', 'ska', 'kan', 'finns',
]);

interface EventRow {
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  venue_id: string | null;
}

function tokens(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

function topUnigrams(tokens: string[]): Array<{ w: string; c: number; score: number }> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const arr = [...counts.entries()].map(([w, c]) => ({ w, c, score: c * Math.log(w.length + 1) }));
  arr.sort((a, b) => b.score - a.score);
  return arr.slice(0, 20);
}

function topBigrams(toks: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const b of bigrams(toks)) counts.set(b, (counts.get(b) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
}

async function loadEvents(cat: string): Promise<EventRow[]> {
  const all: EventRow[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await db
      .from('events')
      .select('title_sv, title_en, description_sv, description_en, venue_id')
      .eq('category_slug', cat)
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('events query:', error.message); process.exit(2); }
    if (!data || data.length === 0) break;
    all.push(...(data as EventRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function main(): Promise<void> {
  if (!only) { console.error('Saknar --only <kategori>'); process.exit(2); }
  console.log(`[corpus-build] mode=${isApply ? 'APPLY' : 'DRY-RUN'} cat=${only}`);

  const events = await loadEvents(only);
  console.log(`[corpus-build] hittade ${events.length} events.`);
  if (events.length === 0) {
    console.error(`[corpus-build] inga events för "${only}" — avbryter.`);
    process.exit(2);
  }

  // Plocka ut descriptions
  const descriptions = events
    .map((e) => e.description_sv ?? e.description_en ?? '')
    .filter((d) => d.length > 20);
  const allDescText = descriptions.join('\n');
  const allTitles = events
    .map((e) => e.title_sv ?? e.title_en ?? '')
    .filter((t) => t.length > 0);

  const toks = tokens(allDescText + ' ' + allTitles.join(' '));
  const top1 = topUnigrams(toks);
  const top2 = topBigrams(toks);

  // Hämta venues (om möjligt)
  const venueIds = [...new Set(events.map((e) => e.venue_id).filter((v): v is string => !!v))];
  let venues: string[] = [];
  if (venueIds.length > 0) {
    const { data: vData } = await db
      .from('venues')
      .select('name')
      .in('id', venueIds.slice(0, 200));
    if (vData) {
      venues = (vData as Array<{ name: string }>).map((v) => v.name).filter(Boolean);
    }
  }

  // Sample events med descriptions (för M3-prompten)
  const samples = events
    .filter((e) => (e.description_sv ?? e.description_en ?? '').length > 30)
    .slice(0, 6)
    .map((e) => ({
      title: (e.title_sv ?? e.title_en ?? '?').slice(0, 80),
      venue: venues[0] ?? 'a Stockholm venue',
      description_preview: (e.description_sv ?? e.description_en ?? '').replace(/\s+/g, ' ').slice(0, 200),
    }));

  const fullPath = join(CORPUS, `${only}_full.json`);
  const signalPath = join(CORPUS, `${only}_signal.json`);
  const jevPath = join(CORPUS, `${only}_jev.json`);

  const full = {
    category_slug: only,
    events: events.length,
    library_now: 0, // vi vet att den är 0 (annars kör vi inte detta)
    approx_images_needed: Math.max(0, Math.ceil(events.length / TARGET_PER_30)),
    description_corpus_size: descriptions.length,
    median_desc_len: descriptions.length > 0
      ? Math.round(descriptions.map((d) => d.length).sort((a, b) => a - b)[Math.floor(descriptions.length / 2)])
      : 0,
    avg_desc_len: descriptions.length > 0
      ? Math.round(descriptions.reduce((s, d) => s + d.length, 0) / descriptions.length)
      : 0,
    max_desc_len: descriptions.length > 0 ? Math.max(...descriptions.map((d) => d.length)) : 0,
    tone_samples: descriptions.slice(0, 8).map((d) => d.slice(0, 200)),
    top_bigrams: top2,
    sample_events_with_descriptions: samples,
  };

  const signal = {
    category_slug: only,
    events: events.length,
    docs: descriptions.length,
    top_1grams_distinctive: top1,
    top_2grams_distinctive: top2,
  };

  const jev = {
    category_slug: only,
    signals: {
      top1: top1.slice(0, 8).map((t) => t.w),
      top2: top2.slice(0, 8).map(([b]) => b),
      venues: venues.slice(0, 6),
      sample_titles: allTitles.slice(0, 8),
    },
    q1_signal_words: { prob: 0.30 }, // låg — använd 2 ord
    q2_venue_naming: { prob: venues.length > 0 ? 0.65 : 0.30 },
    q3_artist_naming: { prob: 0.10 },
  };

  console.log('');
  console.log('Plan:');
  console.log(`  ${fullPath}`);
  console.log(`  ${signalPath}`);
  console.log(`  ${jevPath}`);
  console.log(`  events=${full.events}, approx_images_needed=${full.approx_images_needed}`);
  console.log(`  top-ord: ${signal.top_1grams_distinctive.slice(0, 5).map((t) => t.w).join(', ')}`);
  console.log(`  venues: ${jev.signals.venues.slice(0, 3).join(', ') || '(inga venues hittade)'}`);

  if (isDryRun) {
    console.log('');
    console.log('[corpus-build] DRY-RUN: inga filer skrivs. Kör med --apply för att skriva.');
    process.exit(0);
  }

  writeFileSync(fullPath, JSON.stringify(full, null, 2));
  writeFileSync(signalPath, JSON.stringify(signal, null, 2));
  writeFileSync(jevPath, JSON.stringify(jev, null, 2));
  console.log('');
  console.log('[corpus-build] KLART. Kör nu:');
  console.log(`  npx tsx scripts/_generate_bfl_prompts_v4.mjs --only ${only}`);
}

main().catch((err) => { console.error('[corpus-build] FATAL:', err); process.exit(99); });