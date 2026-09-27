/**
 * fix-null-sources.ts — Reparera events med source = NULL.
 *
 * Buggen: events från boka.berwaldhallen.se (bokningsdomänen) persisteras
 * med source=NULL även om source_id börjar med "berwaldhallen-".
 *
 * Detektion:
 *   * source IS NULL OCH
 *   * (ticket_url host = 'boka.berwaldhallen.se' ELLER
 *      source_id startsWith('berwaldhallen-'))
 *
 * Åtgärd: sätt source = 'berwaldhallen' (eller 'berwaldhallen-tixly' om URL har /tixly/).
 *
 * Säkerhet:
 *   * --review (default): listar events som SKULLE fixas.
 *   * --apply: faktisk UPDATE.
 *   * Loggar ID-lista till vault.
 *
 * Användning:
 *   tsx --env-file=.env 04-Normalizer/_scripts/fix-null-sources.ts --review
 *   tsx --env-file=.env 04-Normalizer/_scripts/fix-null-sources.ts --apply
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

interface EventRow {
  id: string;
  source: string | null;
  source_id: string | null;
  ticket_url: string | null;
}

const PAGE = 1000;
const VAULT_DIR = join(process.cwd(), '00-Vault/01-Projects/EventPulse/04-Sources');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

function inferSource(url: string | null, sourceId: string | null): string | null {
  const u = url ?? '';
  const sid = sourceId ?? '';
  if (u.includes('boka.berwaldhallen.se') || sid.startsWith('berwaldhallen-')) {
    return 'berwaldhallen';
  }
  return null;
}

async function findNullSourceEvents(): Promise<Array<EventRow & { inferred_source: string }>> {
  const rows: EventRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('events')
      .select('id, source, source_id, ticket_url')
      .is('source', null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`fetch error: ${error.message}`);
    if (data && data.length > 0) {
      rows.push(...(data as EventRow[]));
      offset += data.length;
      hasMore = data.length === PAGE;
    } else hasMore = false;
  }
  return rows
    .map((r) => ({ ...r, inferred_source: inferSource(r.ticket_url, r.source_id) ?? '' }))
    .filter((r) => r.inferred_source !== '');
}

async function reviewMode(): Promise<void> {
  console.log('[fix-null-sources] ── REVIEW MODE ──\n');
  const fixable = await findNullSourceEvents();
  console.log(`[fix-null-sources] ${fixable.length} events kan fixas:\n`);

  const bySource = new Map<string, number>();
  for (const e of fixable) bySource.set(e.inferred_source, (bySource.get(e.inferred_source) ?? 0) + 1);
  for (const [s, n] of bySource) console.log(`  → ${s}: ${n} events`);

  console.log('\nFörsta 10:');
  for (const e of fixable.slice(0, 10)) {
    console.log(`  ${e.id}  ${e.inferred_source}`);
    console.log(`    source_id: ${(e.source_id ?? '?').slice(0, 40)}`);
    console.log(`    url:       ${(e.ticket_url ?? '?').slice(0, 70)}`);
  }
  console.log(`\n[fix-null-sources] Kör med --apply för att uppdatera ${fixable.length} events.`);
}

async function applyMode(): Promise<void> {
  console.log('[fix-null-sources] ── APPLY MODE ──\n');
  const fixable = await findNullSourceEvents();
  console.log(`[fix-null-sources] Fixar ${fixable.length} events...`);

  // Gruppera per target source för effektiv batch-uppdatering
  const byTarget = new Map<string, string[]>();
  for (const e of fixable) {
    if (!byTarget.has(e.inferred_source)) byTarget.set(e.inferred_source, []);
    byTarget.get(e.inferred_source)!.push(e.id);
  }

  let totalUpdated = 0;
  for (const [target, ids] of byTarget) {
    console.log(`  → ${target}: ${ids.length} events`);
    // Batch-uppdatera 100 i taget
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const { error } = await supabase
        .from('events')
        .update({ source: target })
        .in('id', batch);
      if (error) {
        console.error(`  ERR batch: ${error.message}`);
      } else {
        totalUpdated += batch.length;
      }
    }
  }
  console.log(`\n[fix-null-sources] ✅ ${totalUpdated} events uppdaterade.`);

  // Run-log
  await mkdir(VAULT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const logPath = join(VAULT_DIR, `fix-null-sources-run-${today}.md`);
  await writeFile(
    logPath,
    [
      `# Fix-null-sources run — ${today}`,
      '',
      `* Events med source=null som kunde fixas: ${fixable.length}`,
      `* Uppdaterade: ${totalUpdated}`,
      '',
      `## Bug-orsak`,
      '',
      `Events från boka.berwaldhallen.se (bokningsdomänen) persisterades med source=NULL.`,
      `source_id börjar med "berwaldhallen-" så vi kan härleda rätt source.`,
      '',
      `## Framtida fix`,
      '',
      `Bokningsdomänen måste mappas till source='berwaldhallen' i ingestion-pipelinen`,
      `(troligen i 02-Ingestion/A-directAPI-networkGate/adapters/berwaldhallenTixly.ts`,
      `eller motsvarande entry point för boka.berwaldhallen.se).`,
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(`[fix-null-sources] Run-log: ${logPath}`);
}

async function main() {
  const mode = process.argv.includes('--apply') ? 'apply' : 'review';
  if (mode === 'review') await reviewMode();
  else await applyMode();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[fix-null-sources] FATAL:', msg);
  process.exit(1);
});
