import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Test 1: enklaste möjliga query
  const r1 = await c.from('events').select('id').limit(1);
  console.log('Test 1 (alla events, 1 rad):', JSON.stringify(r1.data), 'error:', r1.error?.message ?? 'none');

  // Test 2: filtrera på title_sv='Folkoperan' (utan or)
  const r2 = await c.from('events').select('id, source, title_sv, source_url, ticket_url').eq('title_sv', 'Folkoperan').limit(2);
  console.log('Test 2 (title_sv=Folkoperan):', JSON.stringify(r2.data, null, 2), 'error:', r2.error?.message ?? 'none');

  // Test 3: testa med .or() och .range()
  const r3 = await c.from('events').select('id, source, title_sv, source_url, ticket_url, created_at')
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
    .order('created_at', { ascending: false })
    .range(0, 4);
  console.log('Test 3 (or + range):', JSON.stringify(r3.data, null, 2), 'error:', r3.error?.message ?? 'none');
}
main().catch((e) => { console.error(e); process.exit(1); });