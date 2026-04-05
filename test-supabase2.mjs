import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('Testing Supabase events table...');
// Try without count first
const { data, error } = await supabase.from('events').select('*').limit(3);
if (error) {
  console.error('ERROR:', error.message);
} else {
  console.log('OK - sample events:', data?.length || 0);
  if (data?.length > 0) console.log('First:', JSON.stringify(data[0]).substring(0, 200));
}
