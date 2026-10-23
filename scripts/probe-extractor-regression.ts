/**
 * probe-extractor-regression.ts — mäter om C3-ändringen (kort-expansion,
 * titel-källa, datum-precedens) har ändrat utfallet för andra källor.
 *
 * Metod: batch-220-traces innehåller den URL som faktiskt extraherades per
 * källa ("effectiveUrl") och antalet universal-extractor-events då
 * ("c3EventsFound"). Vi hämtar samma URL:er igen, kör den NUvarande
 * extractor-koden på exakt samma HTML och jämför.
 *
 * Negativ kontroll: källor som inte berörs ska ha exakt samma antal.
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractEvents } from '../02-Ingestion/F-eventExtraction/universal-extractor.js';

const TRACE_DIR = '02-Ingestion/C-htmlGate/reports';
const CACHE_DIR = '/tmp/reg-html';

interface Trace {
  sourceId: string;
  effectiveUrl: string | null;
  c3EventsFound: number;
  c3MethodBreakdown: Record<string, number>;
  eventsFound: number;
}

function loadTraces(): Trace[] {
  const dirs = fs
    .readdirSync(TRACE_DIR)
    .filter((d) => d.startsWith('batch-'))
    .map((d) => ({ d, t: fs.statSync(path.join(TRACE_DIR, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 2);
  const traces: Trace[] = [];
  for (const { d } of dirs) {
    const f = path.join(TRACE_DIR, d, 'batch-traces.jsonl');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      try {
        traces.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
  }
  // En källa kan förekomma i flera batcher — senaste vinner.
  const byId = new Map<string, Trace>();
  for (const t of traces) if (t.sourceId) byId.set(t.sourceId, t);
  return [...byId.values()];
}

async function fetchHtml(url: string, sourceId: string): Promise<string | null> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${sourceId}.html`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept-Language': 'sv-SE,sv;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    fs.writeFileSync(file, html);
    return html;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const traces = loadTraces().filter((t) => t.effectiveUrl);
  console.log(`Jämför ${traces.length} källor mot senaste batch-trace\n`);

  const rows: Array<{ id: string; before: number; after: number; delta: number; titles: string[] }> = [];
  let cursor = 0;
  const CONCURRENCY = 5;
  async function worker(): Promise<void> {
    while (cursor < traces.length) {
      const t = traces[cursor++];
      const html = await fetchHtml(t.effectiveUrl!, t.sourceId);
      if (!html) continue;
      let after = 0;
      const titles: string[] = [];
      try {
        const r = extractEvents(html, t.sourceId, t.effectiveUrl!);
        after = r.events.length;
        titles.push(...r.events.map((e: any) => e.title));
      } catch (e: any) {
        console.log(`  ! ${t.sourceId}: ${e?.message}`);
      }
      rows.push({ id: t.sourceId, before: t.c3EventsFound, after, delta: after - t.c3EventsFound, titles });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  rows.sort((a, b) => a.delta - b.delta);
  const changed = rows.filter((r) => r.delta !== 0);
  const same = rows.filter((r) => r.delta === 0);

  console.log('═══ OFörändrade ═══');
  console.log(`antal: ${same.length}/${rows.length}`);
  console.log('\n═══ FÖRÄNDRADE ═══');
  console.log(`antal: ${changed.length}/${rows.length}`);
  for (const r of changed) {
    const arrow = r.delta > 0 ? '▲' : '▼';
    console.log(`  ${arrow} ${r.id.padEnd(28)} ${r.before} → ${r.after}  (${r.delta > 0 ? '+' : ''}${r.delta})`);
    if (r.delta < 0) {
      console.log(`      titlar nu: ${r.titles.slice(0, 6).map((t) => JSON.stringify(t.slice(0, 40))).join(', ')}`);
    }
  }
  const down = changed.filter((r) => r.delta < 0);
  const up = changed.filter((r) => r.delta > 0);
  console.log(`\nsummering: ${up.length} upp, ${down.length} ner, ${same.length} oförändrade`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
