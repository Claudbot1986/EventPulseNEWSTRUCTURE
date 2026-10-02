/**
 * _inspect-source-titles.ts — look at titles of remaining community events
 * from sources that are candidates for new sourceCategoryDefaults entries.
 *
 * Helps decide if a single default category is justified (≥ 50 % AND the
 * candidates look uniform — Generalization Protection Rule).
 */
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

for (const candidate of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '../..')]) {
  dotenvConfig({ path: resolve(candidate, '.env') });
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SOURCES = ['jarfalla', 'stockholm-live', 'mosebacke-2', 'berwaldhallen-tixly', 'konstkalendern'];

async function main() {
  for (const source of SOURCES) {
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, source, category_slug')
      .eq('source', source)
      .eq('category_slug', 'community')
      .limit(20);
    if (error) { console.error(source, error.message); continue; }
    console.log(`\n── ${source} (showing ${data?.length ?? 0} community events) ──`);
    for (const r of (data ?? []) as Array<{ title: string | null; title_sv: string | null; description_sv: string | null }>) {
      const title = r.title_sv ?? r.title ?? '(no title)';
      const desc = (r.description_sv ?? '').slice(0, 80);
      console.log(`  • ${title}${desc ? ` — ${desc}` : ''}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
