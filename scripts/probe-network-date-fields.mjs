/**
 * Probe — söker efter datumfält i API-svar för de källor som B-gatet nu
 * korrekt avvisar.
 *
 * Frågan per källa: innehåller API-svaret NÅGOT datumfält någonstans i
 * payloaden? Om ja — var? Om nej — har källan ingen händelsedatum i sin
 * API, och rätt väg är HTML (C-gate), inte nätverks-API.
 *
 * Kör: node scripts/probe-network-date-fields.mjs [--limit N]
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(import.meta.dirname, '..');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 20;

const { inspectUrl } = await import(
  path.join(ROOT, '02-Ingestion/B-JSON-feedGate/networkInspector.ts')
);
const { extractEventsFromPayload } = await import(
  path.join(ROOT, '02-Ingestion/B-JSON-feedGate/networkEventExtractor.ts')
);
const { fetchJson } = await import(path.join(ROOT, '02-Ingestion/tools/fetchTools.ts'));

// Källorna som B-gatet nyss körde om och avvisade.
const PREC = path.join(ROOT, 'runtime/postB-preC-queue.jsonl');
if (!existsSync(PREC)) {
  console.error('SAKNAS: runtime/postB-preC-queue.jsonl');
  process.exit(1);
}
const queued = readFileSync(PREC, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

/** Datumlika fält — samma lista som B-gatens extractor tittar på, plus
 *  publiceringsdatum som vi INTE får använda. */
const DATE_KEYS = new Set([
  'starttime', 'startdate', 'start_date', 'start_datetime', 'eventdate', 'event_date',
  'eventstart', 'begindate', 'startsat', 'starts_at', 'endtime', 'enddate', 'end_date',
  'endsat', 'ends_at', 'date', 'date_gmt', 'modified', 'modified_gmt', 'published',
  'published_gmt', 'created', 'timestamp', 'when', 'datetime', 'event_time',
]);

/** Samla alla datumlika fält med sin sökväg. */
function scanDates(value, pathPrefix = '', out = [], depth = 0) {
  if (depth > 8 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    if (value.length === 0) return out;
    scanDates(value[0], `${pathPrefix}[0]`, out, depth + 1);
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value)) {
    const p = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (DATE_KEYS.has(k.toLowerCase()) && (typeof v === 'string' || typeof v === 'number')) {
      out.push({ path: p, value: String(v).slice(0, 40) });
    }
    if (v && typeof v === 'object') scanDates(v, p, out, depth + 1);
  }
  return out;
}

function shape(value, depth = 0) {
  if (depth > 2) return '…';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).slice(0, 8);
    return `{${keys.join(',')}}`;
  }
  return typeof value;
}

const sample = queued.slice(0, LIMIT);
console.log(`postB-preC: ${queued.length} källor, provtar ${sample.length}\n`);

let withRealDates = 0;
for (const entry of sample) {
  const sourceId = entry.sourceId;
  let src;
  try {
    const mod = await import(path.join(ROOT, '02-Ingestion/tools/sourceRegistry.ts'));
    src = mod.getSource(sourceId);
  } catch {}
  if (!src) {
    console.log(`── ${sourceId}: ingen källfil — hoppas`);
    continue;
  }

  let inspector;
  try {
    inspector = await inspectUrl(src.url);
  } catch (e) {
    console.log(`── ${sourceId}: inspect-fel ${e.message}`);
    continue;
  }
  const candidates = [
    ...inspector.candidates.filter((c) => c.label === 'likely_event_api'),
    ...inspector.candidates.filter((c) => c.label === 'possible_api'),
  ].slice(0, 3);

  console.log(`── ${sourceId}  ${src.url}`);
  if (candidates.length === 0) {
    console.log('   inga API-kandidater hittade');
    continue;
  }

  for (const c of candidates) {
    const res = await fetchJson(c.url, { timeout: 15000 });
    if (!res.success || !res.data) {
      console.log(`   ${c.url} → fetch-fel: ${res.error}`);
      continue;
    }
    const dates = scanDates(res.data);
    const extracted = extractEventsFromPayload(res.data, sourceId);
    // "Riktiga" datum = fält som B-gatens extractor faktiskt läser.
    const real = dates.filter((d) =>
      /starttime|startdate|start_date|start_datetime|eventdate|event_date|eventstart|begindate|startsat|starts_at/i.test(
        d.path.split('.').pop(),
      ),
    );
    if (real.length > 0) withRealDates += 1;
    console.log(
      `   ${c.url}\n     shape=${shape(res.data)} datumfält=${dates.length} ` +
      `(händelsedatum=${real.length}) extraherade=${extracted.length}`,
    );
    for (const d of dates.slice(0, 6)) console.log(`       ${d.path} = ${d.value}`);
    if (dates.length > 6) console.log(`       … ${dates.length - 6} till`);
  }
  console.log('');
}

console.log(`\nKällor med HÄNDELSEDATUM i API-svaret: ${withRealDates}/${sample.length}`);
