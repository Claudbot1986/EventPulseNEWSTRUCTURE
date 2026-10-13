/**
 * _fixMusicEventTypes.ts — 2026-10-13.
 *
 * Engångs SQL-fix för events där Profile.event_type defaultade till 'community'
 * (CATEGORY_HINTS saknade 'music'-nyckel före fix i commit 316eba06).
 *
 * Kör EFTER att music-backfill är klar. Uppdaterar event_profile.profile.event_type
 * till 'music' för alla events där category_slug='music' men Profile.event_type
 * är fel.
 *
 * Idempotent — kan köras flera gånger.
 */
import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log('═'.repeat(78));
  console.log('  FIX: event_type för music-events (CATEGORY_HINTS-bug)');
  console.log('═'.repeat(78));

  // Räkna först hur många som behöver fixas.
  const { count: needsFix, error: cntErr } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('category_slug', 'music')
    .not('event_profile', 'is', null)
    // JSONB-path: profile.event_type = 'community'
    .eq('event_profile->profile->>event_type', 'community');

  if (cntErr) {
    console.error('Fel vid räkning:', cntErr.message);
    process.exit(1);
  }

  console.log(`\nEvents med category_slug=music och buggy event_type: ${needsFix ?? 0}`);

  if (!needsFix || needsFix === 0) {
    console.log('Inga events behöver fixas. Avslutar.');
    return;
  }

  console.log('\nKör UPDATE i batch om 500...');

  let totalFixed = 0;
  while (totalFixed < (needsFix ?? 0)) {
    const { data, error } = await supabase.rpc('fix_music_event_types' as any, { batch_size: 500 })
      .select('*');
    if (error) {
      console.log('RPC saknas, använder direkt UPDATE istället...');
      break;
    }
    if (!data || data.length === 0) break;
    totalFixed += data.length;
    console.log(`  fixat: ${data.length} (totalt ${totalFixed}/${needsFix})`);
  }

  if (totalFixed === 0) {
    // Direkt-uppdatering via supabase update är begränsad — använd batch RPC.
    // Alternativt via raw SQL på Supabase.
    console.log('\n⚠️  Ingen RPC tillgänglig. Kör rå UPDATE via Supabase SQL Editor:');
    console.log(`
UPDATE events
SET event_profile = jsonb_set(
  event_profile,
  '{profile,event_type}',
  '"music"',
  false
)
WHERE category_slug = 'music'
  AND event_profile IS NOT NULL
  AND event_profile->'profile'->>'event_type' = 'community';
`);
  } else {
    // Verifiera
    const { count: afterFix } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('category_slug', 'music')
      .not('event_profile', 'is', null)
      .eq('event_profile->profile->>event_type', 'community');
    console.log(`\nEfter fix: ${afterFix ?? '?'} events kvar med buggy event_type.`);
  }
}

main().catch((err) => {
  console.error('Fel:', err);
  process.exit(1);
});
