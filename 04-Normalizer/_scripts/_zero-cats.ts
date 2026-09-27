import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  const { data: cats } = await supabase
    .from('categories')
    .select('slug, name_sv, name_en, sort_order')
    .order('sort_order', { ascending: true });
  
  // Categories with events
  const used = new Set([
    'music','culture','theatre-comedy','opera','theatre-drama','art-exhibitions',
    'community','classical','exhibition','talks-lectures','sports','food','dance',
    'wine-tasting','kids','family','musical','theater','workshop','flea-market',
    'musikaler','art','design','circus','barn','festivals','food-drink','nightlife',
  ]);
  
  console.log('Categories med 0 events:');
  for (const c of cats ?? []) {
    if (!used.has(c.slug)) {
      console.log(`  ${String(c.sort_order).padStart(4)}  ${c.slug.padEnd(22)}  ${c.name_sv ?? '?'}`);
    }
  }
}

main().catch(console.error);
