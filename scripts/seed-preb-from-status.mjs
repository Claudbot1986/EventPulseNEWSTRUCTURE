/**
 * Seed — lägger tillbaka de källor som stod som "network, N events" men
 * saknade databasrader i preB-kön, så att B-gatet kan köas om efter fixen.
 *
 * Kör: node scripts/seed-preb-from-status.mjs [--dry]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATUS = path.join(ROOT, 'runtime/sources_status.jsonl');
const PREB = path.join(ROOT, 'runtime/preB-queue.jsonl');
const dry = process.argv.includes('--dry');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const rows = readFileSync(STATUS, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
const latest = new Map();
for (const r of rows) latest.set(r.sourceId, r);

const candidates = [...latest.values()].filter(
  (r) => r.lastPathUsed === 'network' && (r.lastEventsFound ?? 0) > 0,
);
const sourceIds = candidates.map((r) => r.sourceId);

const counts = new Map();
for (let i = 0; i < sourceIds.length; i += 100) {
  const { data, error } = await supabase
    .from('events')
    .select('source')
    .in('source', sourceIds.slice(i, i + 100));
  if (error) {
    console.error('DB-fel:', error.message);
    process.exit(1);
  }
  for (const row of data ?? []) {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  }
}

const stuck = candidates.filter((r) => (counts.get(r.sourceId) ?? 0) === 0);
console.log(`network-path med påstådda events: ${candidates.length}`);
console.log(`utan databasrader (ska köas om):  ${stuck.length}`);

// Endast källor som faktiskt finns i sources/ — annars kan B-gatet inte köa dem.
// Källor i _retired/_quarantine är ute ur pipelinen (isSkipped) och ska inte
// köas om; deras stale statusrader hanteras separat.
const retiredIdx = new Set(
  JSON.parse(readFileSync(path.join(ROOT, 'sources/_retired/INDEX.json'), 'utf8')).map(
    (e) => e.sourceId,
  ),
);
const quarantinedIdx = new Set(
  JSON.parse(readFileSync(path.join(ROOT, 'sources/_quarantine/INDEX.json'), 'utf8')).map(
    (e) => e.sourceId,
  ),
);
const missing = [];
const outOfPipeline = [];
for (const r of stuck) {
  if (retiredIdx.has(r.sourceId) || quarantinedIdx.has(r.sourceId)) {
    outOfPipeline.push(r.sourceId);
    continue;
  }
  const srcPath = path.join(ROOT, 'sources', `${r.sourceId}.jsonl`);
  if (!existsSync(srcPath)) missing.push(r.sourceId);
}
console.log(`redan ute ur pipelinen (retired/quarantined): ${outOfPipeline.length}`);
console.log(`saknar källfil i sources/:                    ${missing.length}`);
if (missing.length) console.log('  ' + missing.join('\n  '));

const runnable = stuck.filter((r) => !missing.includes(r.sourceId) && !outOfPipeline.includes(r.sourceId));
console.log(`köbara:                                      ${runnable.length}`);

if (dry) {
  console.log('\nDRY RUN — inget skrivs.');
  process.exit(0);
}

const now = new Date().toISOString();
const entries = runnable.map((r) => ({
  sourceId: r.sourceId,
  queueName: 'preB',
  queuedAt: now,
  priority: 1,
  attempt: 1,
  queueReason: `retry-after-bfix: previous run claimed ${r.lastEventsFound} events but produced 0 DB rows`,
}));
writeFileSync(PREB, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
console.log(`\nSkrev ${entries.length} entries till runtime/preB-queue.jsonl`);
