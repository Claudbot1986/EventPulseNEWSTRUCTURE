/**
 * scripts/backup-event-descriptions.ts — BACKUP före beskrivnings-backfill.
 *
 * 2026-11-02 — användarens beslut: de 89 events som helt saknar beskrivning
 * ska tas in i den nattliga ingestion-kedjan, och de som behöver ändring
 * ska backfillas. Det skriver till produktions-DB → det MÅSTE finnas en
 * återställbar ögonblicksbild först.
 *
 * Två artefakter:
 *   1. runtime/backups/event-descriptions-<stamp>.json
 *      FULLständiga rader (alla 76 kolumner, inkl. rå källtext).
 *      Ligger i runtime/ → gitignored, eftersom rå källtext inte ska in i git.
 *      Full fidelity för återställning.
 *
 *   2. docs/audit/backup/event-descriptions-<stamp>.manifest.json
 *      MANIFEST med de beskrivningsrelaterade kolumnerna, UTAN rå källtext.
 *      Committas → beviset på vad som ändrades + återställning av
 *      beskrivningsfälten direkt från git.
 *
 * Återställning: scripts/restore-event-descriptions.ts --apply
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/backup-event-descriptions.ts \
 *     --ids-from=docs/audit/data/events-without-description-HEM-flow-2026-11-02.csv
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();

/** Kolumner som beskrivnings-backfillen kan ändra. Restoreringens scope. */
export const DESCRIPTION_COLUMNS = [
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

const idsFrom = argOf('ids-from');
const idsArg = argOf('ids');
const stamp = argOf('stamp') || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

let ids: string[] = [];
if (idsFrom) {
  const raw = fs.readFileSync(path.resolve(PROJECT_ROOT, idsFrom), 'utf8').trim();
  ids = raw
    .split('\n')
    .slice(1)
    .map((l) => l.split(',')[0].replace(/"/g, '').trim())
    .filter(Boolean);
} else if (idsArg) {
  ids = idsArg.split(',').map((s) => s.trim()).filter(Boolean);
}

if (ids.length === 0) {
  console.error('FATAL: inga event-id. Ange --ids-from=<csv> eller --ids=a,b,c');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`BACKUP: ${ids.length} event-id (stamp ${stamp})`);

const rows: any[] = [];
let off = 0;
for (;;) {
  const { data, error } = await db.from('events').select('*').in('id', ids).range(off, off + 999);
  if (error) throw error;
  if (!data?.length) break;
  rows.push(...data);
  off += 1000;
  if (data.length < 1000) break;
}

if (rows.length !== ids.length) {
  console.warn(`VARNING: ${ids.length} id begärda, ${rows.length} rader hittade.`);
}

// ─── 1. Full backup (gitignored, inkl. råtext) ─────────────────────────────
const fullDir = path.resolve(PROJECT_ROOT, 'runtime/backups');
fs.mkdirSync(fullDir, { recursive: true });
const fullFile = path.join(fullDir, `event-descriptions-${stamp}.json`);
fs.writeFileSync(
  fullFile,
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      stamp,
      reason: 'backup före beskrivnings-backfill av events som saknar beskrivning',
      row_count: rows.length,
      rows,
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`  full backup (gitignored): ${fullFile}`);

// ─── 2. Manifest (committas, UTAN rå källtext) ─────────────────────────────
const manifestRows = rows.map((r) => {
  const out: Record<string, unknown> = { id: r.id };
  for (const c of DESCRIPTION_COLUMNS) {
    const v = r[c];
    // Rå källtext och profiler kan vara stora — sammanfatta dem, behåll
    // existens + längd så manifestet bevisar vad som fanns.
    if (typeof v === 'string' && v.length > 400) {
      out[c] = { __summary: true, length: v.length, head: v.slice(0, 200) };
    } else if (v && typeof v === 'object') {
      out[c] = { __summary: true, keys: Object.keys(v as object) };
    } else {
      out[c] = v;
    }
  }
  return out;
});

const manifestDir = path.resolve(PROJECT_ROOT, 'docs/audit/backup');
fs.mkdirSync(manifestDir, { recursive: true });
const manifestFile = path.join(manifestDir, `event-descriptions-${stamp}.manifest.json`);
fs.writeFileSync(
  manifestFile,
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      stamp,
      reason: 'backup före beskrivnings-backfill av events som saknar beskrivning',
      row_count: rows.length,
      columns: DESCRIPTION_COLUMNS,
      note:
        'Manifest utan rå källtext. Full backup (inkl. råtext) ligger i runtime/backups/ och är gitignored.',
      rows: manifestRows,
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`  manifest (committas):    ${manifestFile}`);

// ─── 3. Sammanfattning ─────────────────────────────────────────────────────
const withDesc = rows.filter((r) => (r.editorial_description || '').trim().length > 0).length;
const withProfile = rows.filter(
  (r) => r.event_profile && Object.keys(r.event_profile as object).length > 0,
).length;
const withRaw = rows.filter((r) => (r.raw_description || '').trim().length > 0).length;
const withSummary = rows.filter((r) => (r.eventpulse_summary || '').trim().length > 0).length;

console.log('\nFÖRE-STATE:');
console.log(`  rader:              ${rows.length}`);
console.log(`  editorial_description: ${withDesc}`);
console.log(`  event_profile:      ${withProfile}`);
console.log(`  raw_description:    ${withRaw}`);
console.log(`  eventpulse_summary: ${withSummary}`);
console.log('\nÅterställning: node --env-file=.env --import tsx scripts/restore-event-descriptions.ts --from=<manifest> [--apply]');
