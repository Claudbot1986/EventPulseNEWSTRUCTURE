/**
 * Probe — letar efter publika evenemangs-API:er som INTE syns i wp-json-index
 * och som faktiskt innehåller händelser.
 *
 * B-gatets inspector hittar /wp-json/tribe/events/v1/events på vissa
 * WordPress-sajter. Frågan: har någon av de 47 källorna publika evenemang
 * i sitt Tribe-API (total > 0)?
 *
 * Kör: node scripts/probe-tribe-endpoints.mjs
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const { fetchJson } = await import(path.join(ROOT, '02-Ingestion/tools/fetchTools.ts'));
const { getSource } = await import(path.join(ROOT, '02-Ingestion/tools/sourceRegistry.ts'));
const { extractEventsFromPayload } = await import(
  path.join(ROOT, '02-Ingestion/B-JSON-feedGate/networkEventExtractor.ts')
);

const PREC = path.join(ROOT, 'runtime/postB-preC-queue.jsonl');
const queued = readFileSync(PREC, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const withEvents = [];
let checked = 0;

for (const entry of queued) {
  const src = getSource(entry.sourceId);
  if (!src) continue;
  let origin;
  try {
    origin = new URL(src.url).origin;
  } catch {
    continue;
  }

  for (const p of ['/wp-json/tribe/events/v1/events?per_page=5', '/wp-json/tribe/events/v1/events']) {
    const url = origin + p;
    const res = await fetchJson(url, { timeout: 15000 });
    checked += 1;
    if (!res.success || !res.data) continue;
    const d = res.data;
    const total = Number(d?.total ?? 0);
    const arr = Array.isArray(d?.events) ? d.events : Array.isArray(d) ? d : [];
    if (total > 0 || arr.length > 0) {
      const extracted = extractEventsFromPayload(d, entry.sourceId);
      withEvents.push({ sourceId: entry.sourceId, url, total, arrLen: arr.length, extracted: extracted.length });
      console.log(
        `HIT ${entry.sourceId}  ${url}\n    total=${total} events=${arr.length} extraherade=${extracted.length}`,
      );
      if (arr.length > 0) {
        const e = arr[0];
        console.log(`    nycklar: ${Object.keys(e).slice(0, 12).join(', ')}`);
        console.log(`    start_date=${e.start_date ?? e.startDate ?? '(saknas)'} title=${JSON.stringify(e.title).slice(0, 60)}`);
      }
    }
    break; // en variant per domän räcker
  }
}

console.log(`\nKontrollerade ${checked} endpoint-anrop över ${queued.length} källor.`);
console.log(`API:er med publika evenemang: ${withEvents.length}`);
for (const w of withEvents) console.log(`  ${w.sourceId}: total=${w.total} extraherade=${w.extracted}`);
