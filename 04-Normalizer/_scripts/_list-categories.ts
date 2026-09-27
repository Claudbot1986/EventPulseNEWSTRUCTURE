import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  const { data } = await supabase
    .from('categories')
    .select('slug, name_sv, name_en, sort_order')
    .order('sort_order', { ascending: true });
  for (const c of data ?? []) {
    console.log(`${String(c.sort_order ?? '').padStart(4)}  ${c.slug.padEnd(22)}  ${c.name_sv ?? '?'} / ${c.name_en ?? '?'}`);
  }
}

main().catch(console.error);
