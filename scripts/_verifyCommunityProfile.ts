import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const now = new Date().toISOString();

  const { count: total } = await sb.from('events').select('id', { count: 'exact', head: true })
    .eq('category_slug', 'community').gt('start_time', now);
  const { count: withProfile } = await sb.from('events').select('id', { count: 'exact', head: true })
    .eq('category_slug', 'community').gt('start_time', now).not('event_profile', 'is', null);
  const { count: withSummary } = await sb.from('events').select('id', { count: 'exact', head: true })
    .eq('category_slug', 'community').gt('start_time', now).not('eventpulse_summary', 'is', null);
  console.log(`Community events:        ${total}`);
  console.log(`With event_profile:       ${withProfile} (${(100 * (withProfile ?? 0) / (total ?? 1)).toFixed(1)}%)`);
  console.log(`With eventpulse_summary:  ${withSummary} (${(100 * (withSummary ?? 0) / (total ?? 1)).toFixed(1)}%)`);

  // info_level distribution
  const { data: levels } = await sb.from('events')
    .select('editorial_info_level')
    .eq('category_slug', 'community').gt('start_time', now)
    .not('event_profile', 'is', null);
  const dist: Record<string, number> = {};
  for (const r of levels ?? []) {
    const l = r.editorial_info_level || 'NULL';
    dist[l] = (dist[l] ?? 0) + 1;
  }
  console.log();
  console.log('editorial_info_level distribution:');
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${v} (${(100 * v / (levels?.length || 1)).toFixed(1)}%)`);
  }

  // Subject hits
  const { data: withSubj } = await sb.from('events')
    .select('event_profile')
    .eq('category_slug', 'community').gt('start_time', now)
    .not('event_profile', 'is', null);
  let withSubjectHits = 0;
  let subjectNames: Record<string, number> = {};
  for (const r of withSubj ?? []) {
    const p = r.event_profile as any;
    const sm = p?.profile?.subject_metadata;
    if (sm && Object.keys(sm).length > 0) {
      withSubjectHits++;
      for (const k of Object.keys(sm)) subjectNames[k] = (subjectNames[k] ?? 0) + 1;
    }
  }
  console.log();
  console.log(`With subject_metadata hits: ${withSubjectHits} (${(100*withSubjectHits/(withSubj?.length||1)).toFixed(1)}%)`);
  console.log('Top subjects matched:');
  for (const [k, v] of Object.entries(subjectNames).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }
}
main();
