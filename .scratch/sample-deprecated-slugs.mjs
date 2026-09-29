/**
 * sample-deprecated-slugs.mjs — Stickprov för deprecated slugs.
 *
 * Användning:
 *   node --env-file=.env .scratch/sample-deprecated-slugs.mjs
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

const DEPRECATED = [
  'culture', 'art-exhibitions', 'theater', 'musikaler',
  'art', 'design', 'food-drink', 'barn', 'festivals',
];

const PAGE = 1000;

for (const slug of DEPRECATED) {
  const { data, error } = await supabase
    .from('events')
    .select('id, title_sv, title_en, source, category_slug, ticket_url, start_time, description_sv')
    .eq('category_slug', slug)
    .order('start_time', { ascending: false })
    .limit(5);
  if (error) {
    console.error(`Error for ${slug}:`, error.message);
    continue;
  }
  console.log(`\n=== ${slug} (samples) ===`);
  if (!data || data.length === 0) {
    console.log('  (no events)');
    continue;
  }
  for (const e of data) {
    const t = e.title_sv || e.title_en || '(no title)';
    console.log(`  - ${t} | source=${e.source}`);
    if (e.description_sv) {
      console.log(`    desc: ${e.description_sv.slice(0, 120).replace(/\n/g, ' ')}${e.description_sv.length > 120 ? '…' : ''}`);
    }
  }
}

// Also count total for each
console.log('\n=== Counts ===');
for (const slug of DEPRECATED) {
  const { count } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('category_slug', slug);
  console.log(`  ${slug}: ${count}`);
}