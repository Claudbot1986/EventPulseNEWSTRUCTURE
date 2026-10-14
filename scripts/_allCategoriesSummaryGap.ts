import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();

  // Per-kategori: antal events utan summary
  const cats = ['music','theatre-drama','theatre-comedy','opera','dance','circus','musical-theatre','classical','rock','pop','jazz','electronic','hip-hop','exhibition','film','talks-lectures','workshop','sports','family','kids','food','wine-tasting','flea-market','community'];
  for (const cat of cats) {
    const { count: total } = await sb.from('events').select('id', { count: 'exact', head: true })
      .eq('category_slug', cat).gt('start_time', now);
    const { count: noSummary } = await sb.from('events').select('id', { count: 'exact', head: true })
      .eq('category_slug', cat).gt('start_time', now).is('eventpulse_summary', null);
    if (noSummary && noSummary > 0) {
      console.log(`  ${cat.padEnd(20)} ${(total || 0).toString().padStart(5)} total, ${noSummary} utan summary`);
    }
  }
  process.exit(0);
}
main();
