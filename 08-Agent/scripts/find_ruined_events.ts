/**
 * 08-Agent/scripts/find_ruined_events.ts
 *
 * Hittar events vars image_url pekar på någon av de 10 RUINED-filerna
 * i `ai-generated/`. Skriver ut id + gammal URL + ny URL för varje.
 * Används som indata till repoint-skriptet som uppdaterar events.image_url.
 *
 *   npx tsx --env-file=.env 08-Agent/scripts/find_ruined_events.ts
 */
import { createClient } from '@supabase/supabase-js';

const RUINED = [
  '-.png',
  '-banan-kompaniet.png',
  '-bioskandia.png',
  '-cirkus.png',
  '-mariatorget3.png',
  '-tyrol.png',
  '10cc-konsertsalen.png',
  '5secondsofsummer-everyonesastarworldtourplatinumtickets-hovet.png',
  '6lackfllan-fllan.png',
  'aaprocky-dontbedumbworldtourplatinumtickets-.png',
];

interface MatchedEvent {
  id: string;
  oldUrl: string;
  newUrl: string;
  title: string;
  ruinedFile: string;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const allEvents: { id: string; image_url: string; title_sv: string | null; title_en: string | null }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('id, image_url, title_sv, title_en')
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allEvents.push(...(data as { id: string; image_url: string; title_sv: string | null; title_en: string | null }[]));
    if (data.length < 1000) break;
    offset += data.length;
  }
  console.log(`[find] events totalt: ${allEvents.length}`);

  const matched: MatchedEvent[] = [];
  for (const ev of allEvents) {
    if (!ev.image_url) continue;
    for (const r of RUINED) {
      const marker = `/ai-generated/${r}`;
      if (ev.image_url.includes(marker)) {
        const newUrl = ev.image_url.replace('/ai-generated/', '/ai-stamped/');
        const title = ev.title_sv ?? ev.title_en ?? '(no title)';
        matched.push({ id: ev.id, oldUrl: ev.image_url, newUrl, title, ruinedFile: r });
        break;
      }
    }
  }

  console.log(`[find] events med ai-generated/<ruined>: ${matched.length}`);
  const byFile: Record<string, number> = {};
  for (const m of matched) byFile[m.ruinedFile] = (byFile[m.ruinedFile] || 0) + 1;
  console.log('per fil:');
  for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.toString().padStart(3)}  ${f}`);
  }
  console.log('');
  console.log('alla events:');
  for (const m of matched) {
    console.log(`  ${m.id}  ${m.title.slice(0, 50)}`);
    console.log(`    OLD: ${m.oldUrl}`);
    console.log(`    NEW: ${m.newUrl}`);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[find] FATAL:', msg);
  process.exit(1);
});
