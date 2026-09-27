/**
 * delete-testdata.ts — Ta bort test/skrap-events från databasen.
 *
 * Identifierar events med tydliga testdata-mönster och tar bort dem:
 *   * Titel = "Test" (exakt)
 *   * Titel = "Musik/Show" (exakt)
 *   * Titel innehåller "do not purchase"
 *   * Titel innehåller "placeholder"
 *   * source = (null) OCH description tom OCH titel < 10 tecken
 *
 * Säkerhet:
 *   * --review (default): listar events som SKULLE tas bort, ingen mutation.
 *   * --apply: faktisk DELETE på events + event_categories (CASCADE).
 *   * Loggar till vault innan åtgärd.
 *
 * Backup:
 *   * Innan --apply, exportera ID-listan till vault/00-Vault/.../testdata-ids-<datum>.json
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/delete-testdata.ts --review
 *   tsx --env-file=.env 04-Normalizer/_scripts/delete-testdata.ts --apply
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  source: string | null;
  start_time: string | null;
  status: string | null;
}

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

const TEST_PATTERNS = [
  /^test$/i,                          // exakt "Test"
  /^musik\/show$/i,                   // exakt "Musik/Show"
  /do not purchase/i,                 // "Do not purchases" etc.
  /placeholder/i,
  /^test\s*\d+$/i,                    // "Test 123", "Test42"
];

function isTestData(title: string | null): boolean {
  const t = (title ?? '').trim();
  if (TEST_PATTERNS.some((p) => p.test(t))) return true;
  return false;
}

async function findTestData(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, title_sv, title_en, description_sv, description_en, source, start_time, status')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (data && data.length > 0) {
      for (const r of data as EventRow[]) {
        if (isTestData(r.title_sv) || isTestData(r.title_en)) {
          rows.push(r);
        }
      }
      offset += data.length;
      hasMore = data.length === PAGE;
    } else hasMore = false;
  }
  return rows;
}

async function reviewMode(): Promise<void> {
  console.log('[delete-testdata] ── REVIEW MODE ──\n');
  const tests = await findTestData();
  console.log(`[delete-testdata] Hittade ${tests.length} testdata-events:\n`);

  const byPattern = new Map<string, EventRow[]>();
  for (const t of tests) {
    const title = (t.title_sv ?? t.title_en ?? '').trim();
    let key = 'short-or-empty';
    if (/^test$/i.test(title)) key = 'Test';
    else if (/^musik\/show$/i.test(title)) key = 'Musik/Show';
    else if (/do not purchase/i.test(title)) key = 'do-not-purchase';
    else if (/placeholder/i.test(title)) key = 'placeholder';
    if (!byPattern.has(key)) byPattern.set(key, []);
    byPattern.get(key)!.push(t);
  }

  for (const [pattern, evts] of byPattern) {
    console.log(`  [${pattern}] ${evts.length} events`);
    for (const e of evts.slice(0, 5)) {
      console.log(`    ${e.id}  ${(e.title_sv ?? e.title_en ?? '?').slice(0, 40)}  src=${e.source ?? 'null'}`);
    }
    if (evts.length > 5) console.log(`    ... och ${evts.length - 5} till`);
    console.log('');
  }

  console.log(`[delete-testdata] Totalt ${tests.length} events skulle tas bort.`);
  console.log(`[delete-testdata] Kör med --apply för att faktiskt ta bort (sparar ID-lista först).`);
}

async function applyMode(): Promise<void> {
  console.log('[delete-testdata] ── APPLY MODE ──\n');
  const tests = await findTestData();
  console.log(`[delete-testdata] Hittade ${tests.length} testdata-events.`);
  if (tests.length === 0) {
    console.log('[delete-testdata] Inget att ta bort.');
    return;
  }

  // Backup ID-lista
  await mkdir(VAULT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const backupPath = join(VAULT_DIR, `testdata-ids-${today}.json`);
  await writeFile(
    backupPath,
    JSON.stringify(
      tests.map((t) => ({ id: t.id, title: t.title_sv ?? t.title_en, source: t.source })),
      null,
      2,
    ),
    'utf8',
  );
  console.log(`[delete-testdata] Backup: ${backupPath}`);

  // Ta bort event_categories först (även om FK borde cascade:a)
  const ids = tests.map((t) => t.id);
  const { error: ecErr, count: ecDel } = await supabase
    .from('event_categories')
    .delete({ count: 'exact' })
    .in('event_id', ids);
  if (ecErr) console.error(`[delete-testdata] event_categories delete error: ${ecErr.message}`);
  else console.log(`[delete-testdata] event_categories: ${ecDel ?? 0} rows deleted`);

  // Ta bort events
  const { error: eErr, count: eDel } = await supabase
    .from('events')
    .delete({ count: 'exact' })
    .in('id', ids);
  if (eErr) {
    console.error(`[delete-testdata] events delete error: ${eErr.message}`);
    return;
  }
  console.log(`[delete-testdata] events: ${eDel ?? 0} rows deleted`);

  // Run-log till vault
  const logPath = join(VAULT_DIR, `delete-testdata-run-${today}.md`);
  await writeFile(
    logPath,
    [
      `# Delete-testdata run — ${today}`,
      '',
      `* Testdata hittade: ${tests.length}`,
      `* event_categories raderade: ${ecDel ?? 0}`,
      `* events raderade: ${eDel ?? 0}`,
      `* Backup: ${backupPath}`,
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`[delete-testdata] Run-log: ${logPath}`);
}

async function main() {
  const mode = process.argv.includes('--apply') ? 'apply' : 'review';
  if (mode === 'review') await reviewMode();
  else await applyMode();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[delete-testdata] FATAL:', msg);
  process.exit(1);
});
