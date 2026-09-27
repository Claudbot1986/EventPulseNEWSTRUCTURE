import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function main() {
  // Check current status
  const { data: current } = await supabase
    .from('sources_status')
    .select('source_id, status, consecutive_failures, last_routing_reason')
    .eq('source_id', 'thatsup-stockholm-events')
    .single();

  console.log('Current status:', current);
  console.log('\nThe thatsup-stockholm-events source has no events at its URL.');
  console.log('See docs/scraping-supervisor/thatsup-investigation-2026-09-27.md');
  console.log('\nNo DB update needed — the adapter.json validationPassed=false already prevents re-extraction.');
}

main().catch(console.error);
