/**
 * Probe — mäter blast radius av B-gatets falska "success".
 *
 * Frågan: hur många källor står i sources_status som "network-path, N events"
 * men som har NOLL rader i events-tabellen?
 *
 * Kör: node scripts/probe-network-blast-radius.mjs
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATUS = path.join(ROOT, 'runtime/sources_status.jsonl');

if (!existsSync(STATUS)) {
  console.error('SAKNAS: runtime/sources_status.jsonl');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const rows = readFileSync(STATUS, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

// Sista statusraden per sourceId vinner.
const latest = new Map();
for (const r of rows) latest.set(r.sourceId, r);

const networkSources = [...latest.values()].filter(
  (r) => r.lastPathUsed === 'network' && (r.lastEventsFound ?? 0) > 0,
);

console.log(`sources_status: ${rows.length} rader, ${latest.size} unika källor`);
console.log(`network-path med lastEventsFound>0: ${networkSources.length}`);

const sourceIds = networkSources.map((r) => r.sourceId);
const counts = new Map();
for (let i = 0; i < sourceIds.length; i += 100) {
  const chunk = sourceIds.slice(i, i + 100);
  const { data, error } = await supabase
    .from('events')
    .select('source')
    .in('source', chunk);
  if (error) {
    console.error('DB-fel:', error.message);
    process.exit(1);
  }
  for (const row of data ?? []) {
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  }
}

const withRows = networkSources.filter((r) => (counts.get(r.sourceId) ?? 0) > 0);
const withoutRows = networkSources.filter((r) => (counts.get(r.sourceId) ?? 0) === 0);

console.log(`\n=== ${withoutRows.length} källor: "network, N events" men 0 rader i DB ===`);
for (const r of withoutRows.sort((a, b) => (b.lastEventsFound ?? 0) - (a.lastEventsFound ?? 0))) {
  console.log(
    `  ${r.sourceId.padEnd(34)} lastEventsFound=${String(r.lastEventsFound).padStart(4)}  ` +
    `status=${r.status}  reason=${String(r.lastRoutingReason ?? '').slice(0, 70)}`,
  );
}

console.log(`\n=== ${withRows.length} källor: har faktiskt rader i DB ===`);
for (const r of withRows) {
  console.log(`  ${r.sourceId.padEnd(34)} rows=${counts.get(r.sourceId)} lastEventsFound=${r.lastEventsFound}`);
}

const claimed = withoutRows.reduce((s, r) => s + (r.lastEventsFound ?? 0), 0);
console.log(`\nPåstådda events utan databasrader: ${claimed}`);
