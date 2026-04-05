import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('Testing Supabase connection...');
const { data, error } = await supabase.from('events').select('count', { count: 'exact', head: true });
if (error) {
  console.error('ERROR:', error.message);
} else {
  console.log('OK - events count:', data);
}
