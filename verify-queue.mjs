import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await supabase
  .from('events')
  .select('id, source, title_sv, created_at')
  .order('created_at', { ascending: false })
  .limit(10);

if (error) {
  console.error('ERROR:', error.message);
} else {
  console.log('Recent 10 events:');
  for (const e of data || []) {
    console.log(`  ${e.source}: ${e.title_sv || '(no title)'} | ${e.created_at}`);
  }
}
