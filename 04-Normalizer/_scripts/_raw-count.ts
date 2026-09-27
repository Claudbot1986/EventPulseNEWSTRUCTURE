import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Use count-only with head:true (no row data)
  const { count: c1 } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });
  console.log('count(*, head=true):', c1);

  // Now also try with default filter
  const { count: c2, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published');
  console.log('count(published):', c2, 'error:', error?.message ?? 'none');

  // Also try counting without status filter, default limit
  const { count: c3 } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true });
  console.log('count(id, head=true):', c3);
}

main().catch(console.error);
