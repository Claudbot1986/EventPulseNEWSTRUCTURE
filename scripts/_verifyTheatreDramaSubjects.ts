import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();
  // Paginerad select för att hämta ALLA
  const all: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from('events')
      .select('event_profile')
      .eq('category_slug', 'theatre-drama').gt('start_time', now)
      .not('event_profile', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  const data = all;
  let withSubj = 0, subjNames: Record<string, number> = {};
  for (const r of data ?? []) {
    const p = r.event_profile as any;
    const sm = p?.profile?.subject_metadata;
    if (sm && Object.keys(sm).length > 0) {
      withSubj++;
      for (const k of Object.keys(sm)) subjNames[k] = (subjNames[k] ?? 0) + 1;
    }
  }
  console.log('theatre-drama total:        ', data?.length);
  console.log('with subject_metadata hits: ', withSubj, '(' + (100*withSubj/(data?.length||1)).toFixed(1) + '%)');
  console.log();
  console.log('Top 30 subjects matched:');
  for (const [k, v] of Object.entries(subjNames).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log('  ' + v.toString().padStart(4) + '  ' + k);
  }
}
main();
