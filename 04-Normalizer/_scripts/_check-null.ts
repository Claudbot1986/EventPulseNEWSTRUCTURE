import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('id', { count: 'exact' })
    .is('source', null);
  console.log('null source count:', data?.length ?? 0, 'error:', error?.message ?? 'none');
}

main().catch(console.error);
