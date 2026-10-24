/**
 * list-xml-winners.ts — vilka källor dog för att .xml vann C0-densitetsloppet?
 *
 * Läser ALLA batch-traces och listar unika källor där effectiveUrl pekar på
 * en .xml-fil (sitemap-index). Beviset: dessa 112 traces slutade alla i
 * C1_NO_MAIN_ARTICLE, noll lyckades.
 *
 *   npx tsx scripts/list-xml-winners.ts
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const REPORTS = join(process.cwd(), '02-Ingestion', 'C-htmlGate', 'reports');

interface Trace {
  sourceId?: string;
  effectiveUrl?: string;
  exitReason?: string;
  success?: boolean;
  eventsFound?: number;
  c0WinnerUrl?: string;
}

const perSource = new Map<string, { traces: number; xml: number; successes: number; reasons: Set<string>; url: string }>();
const xmlTraceOutcomes: Array<{ sourceId: string; url: string; exitReason: string; success: boolean; eventsFound: number }> = [];

const batches = readdirSync(REPORTS).filter((d) => d.startsWith('batch-') && !d.includes('template'));
for (const b of batches) {
  const f = join(REPORTS, b, 'batch-traces.jsonl');
  let raw: string;
  try { raw = readFileSync(f, 'utf8'); } catch { continue; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let t: Trace;
    try { t = JSON.parse(line) as Trace; } catch { continue; }
    const id = t.sourceId;
    if (!id) continue;
    const rec = perSource.get(id) ?? { traces: 0, xml: 0, successes: 0, reasons: new Set<string>(), url: '' };
    rec.traces++;
    const url = t.effectiveUrl || t.c0WinnerUrl || '';
    if (/\.xml(\?|$|\/)/i.test(url)) {
      rec.xml++;
      rec.url = url;
      xmlTraceOutcomes.push({
        sourceId: id,
        url,
        exitReason: t.exitReason ?? '',
        success: t.success === true,
        eventsFound: t.eventsFound ?? 0,
      });
    }
    if (t.success || (t.eventsFound ?? 0) > 0) rec.successes++;
    if (t.exitReason) rec.reasons.add(t.exitReason);
    perSource.set(id, rec);
  }
}

const xmlWinners = [...perSource.entries()]
  .filter(([, r]) => r.xml > 0)
  .sort((a, b) => b[1].xml - a[1].xml);

console.log(`\n=== XML-VINNARE: ${xmlWinners.length} källor ===\n`);
let totalXml = 0;
for (const [id, r] of xmlWinners) {
  totalXml += r.xml;
  console.log(
    `${id.padEnd(44)} xmlTraces=${String(r.xml).padStart(3)}/${String(r.traces).padStart(3)} succ=${r.successes}  ${[...r.reasons].join(',')}`,
  );
}
console.log(`\nTotalt: ${totalXml} xml-traces över ${xmlWinners.length} källor.`);

// Negativ kontroll: xml-traces som LYCKADES (ska vara 0)
const xmlSuccess = xmlTraceOutcomes.filter((t) => t.success || t.eventsFound > 0);
console.log(`\nNEGATIV KONTROLL — xml-traces SOM LYCKADES: ${xmlSuccess.length} (ska vara 0)`);
for (const t of xmlSuccess) {
  console.log(`  ${t.sourceId}: success=${t.success} events=${t.eventsFound} exit=${t.exitReason} url=${t.url}`);
}

// Vilka exit-reasons fick xml-traces?
const byReason = new Map<string, number>();
for (const t of xmlTraceOutcomes) byReason.set(t.exitReason, (byReason.get(t.exitReason) ?? 0) + 1);
console.log('\nXML-traces per exitReason:');
for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${reason}`);
}
