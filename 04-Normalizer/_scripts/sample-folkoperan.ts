import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Hämta 5 folkoperan-events för att se exakt hur datan ser ut
  const { data } = await c
    .from('events')
    .select('id, source, title_sv, title_en, source_url, ticket_url, start_time')
    .eq('source', 'folkoperan')
    .limit(5);

  console.log('SAMPEL FOLKOPERAN-EVENTS:');
  console.log(JSON.stringify(data, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });