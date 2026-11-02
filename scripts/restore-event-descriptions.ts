/**
 * scripts/restore-event-descriptions.ts — ÅTERSTÄLLNING från backup.
 *
 * Paret till `scripts/backup-event-descriptions.ts`. Återställer de
 * beskrivningsrelaterade kolumnerna till ögonblicksbildens värden.
 *
 * Säkerhet:
 *   - `--dry-run` är DEFAULT. Ingenting skrivs utan `--apply`.
 *   - Endast kolumner i DESCRIPTION_COLUMNS återställs — aldrig t.ex.
 *     start_time, venue eller titel. Det gör att en återställning inte
 *     slår tillbaka en legitim korrigering som re-ingestion gjort.
 *   - En rad återställs bara om värdet faktiskt skiljer sig.
 *   - Manifestvärden som är sammanfattade ({__summary:true}) kan inte
 *     återställas utan full backup — de rapporteras och hoppas över.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/restore-event-descriptions.ts \
 *     --from=runtime/backups/event-descriptions-<stamp>.json            # dry-run
 *   node --env-file=.env --import tsx scripts/restore-event-descriptions.ts \
 *     --from=runtime/backups/event-descriptions-<stamp>.json --apply
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const DESCRIPTION_COLUMNS = [
  'description_sv',
  'description_en',
  'description_license',
  'description_attribution',
  'description_source_url',
  'raw_description',
  'raw_description_captured_at',
  'eventpulse_summary',
  'eventpulse_summary_facts',
  'eventpulse_summary_provenance',
  'eventpulse_summary_generated_at',
  'eventpulse_summary_model',
  'event_profile',
  'editorial_description',
  'editorial_description_generated_at',
  'editorial_info_level',
  'editorial_model',
  'editorial_prompt_version',
] as const;

function argOf(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const from = argOf('from');
if (!from) {
  console.error('FATAL: ange --from=<manifest|full-backup>');
  process.exit(1);
}
const APPLY = hasFlag('apply');
const file = path.resolve(PROJECT_ROOT, from);
if (!fs.existsSync(file)) {
  console.error(`FATAL: filen finns inte: ${file}`);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows: any[] = payload.rows ?? [];
const isManifest = Boolean(payload.columns) && !payload.rows?.[0]?.raw_description;

console.log(`ÅTERSTÄLLNING från ${from}`);
console.log(`  rader i snapshot: ${rows.length} · manifest: ${isManifest ? 'ja' : 'nej (full backup)'}`);
console.log(`  läge: ${APPLY ? 'APPLY (skriver)' : 'DRY-RUN (skriver inte)'}\n`);

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const needsFullBackup = new Set<string>();
let rowsChanged = 0;
let cellsChanged = 0;

for (const snap of rows) {
  const { data: current, error } = await db.from('events').select('*').eq('id', snap.id).single();
  if (error || !current) {
    console.log(`  ✗ ${snap.id}: raden finns inte längre — hoppas över`);
    continue;
  }

  const patch: Record<string, unknown> = {};
  for (const col of DESCRIPTION_COLUMNS) {
    const want = snap[col];
    if (want && typeof want === 'object' && (want as any).__summary) {
      needsFullBackup.add(col);
      continue;
    }
    const have = current[col];
    const same = JSON.stringify(have ?? null) === JSON.stringify(want ?? null);
    if (!same) {
      patch[col] = want ?? null;
      cellsChanged++;
    }
  }

  if (Object.keys(patch).length === 0) continue;
  rowsChanged++;

  if (APPLY) {
    const { error: upErr } = await db.from('events').update(patch).eq('id', snap.id);
    if (upErr) {
      console.log(`  ✗ ${snap.id}: uppdatering misslyckades — ${upErr.message}`);
      rowsChanged--;
      continue;
    }
    console.log(`  ↩ ${snap.id}: återställde ${Object.keys(patch).length} kolumner`);
  } else {
    console.log(`  · ${snap.id}: skulle återställa ${Object.keys(patch).join(', ')}`);
  }
}

console.log(`\n${APPLY ? 'ÅTERSTÄLLDE' : 'SKULDE ÅTERSTÄLLA'}: ${rowsChanged} rader, ${cellsChanged} celler.`);
if (needsFullBackup.size > 0) {
  console.log(
    `  Kolumner som manifestet inte kan återställa (behöver full backup): ${[...needsFullBackup].join(', ')}`,
  );
}
if (!APPLY) console.log('  (inget skrivdes — lägg till --apply för att återställa)');
