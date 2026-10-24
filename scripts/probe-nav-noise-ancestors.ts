/**
 * probe-nav-noise-ancestors.ts — varför blir navigationslänkar till events?
 *
 * C3 (extractSwedishRelativeDates) gör varje <a> till en event-titel om dess
 * "kort"-förfader innehåller ett datum. Navigationslänkar ("På startsidan",
 * "Nyheter", "Köp biljetter", "Läs mer" …) fångas ibland, eftersom
 * uthoppslistan bara täcker nav/footer/.nav/breadcrumb och enstaka ord.
 *
 * Detta skript hämtar de faktiska sidorna och dumpar ANCESTOR-KEDJAN för varje
 * störd länktext, så att en generell regel kan motiveras med bevis istället för
 * gissning. Mätscript — ingen produktionskod ändras.
 *
 *   npx tsx scripts/probe-nav-noise-ancestors.ts --sources postmuseum,rival,oscarsteatern
 */

import { screenUrl } from '../02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.js';
import { getSource } from '../02-Ingestion/tools/sourceRegistry.js';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const idx = args.indexOf('--sources');
const sources = idx >= 0 ? (args[idx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];

// Länktexter som vi misstänker är stördning — från körning 2026-10-24.
const SUSPECT_TEXTS = [
  'på startsidan', 'nyheter', 'kalendarium', 'emelie sandahl', 'köp biljetter',
  'biljetter här.', 'biljetter', 'mer info', 'läs mer', 'click here',
  'om föreställningen', 'medverkande', 'datum', 'på gång', 'historik',
  'dansens hus', 'stora scen, barnhusgatan 12-14',
];

interface Trace {
  sourceId: string;
  effectiveUrl?: string;
  c0WinnerUrl?: string;
}

function loadTraces(): Map<string, Trace> {
  const map = new Map<string, Trace>();
  const p = '02-Ingestion/C-htmlGate/reports/batch-219/batch-traces.jsonl';
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line) as Trace;
      map.set(t.sourceId, t);
    } catch { /* skip */ }
  }
  return map;
}

const traces = loadTraces();

for (const sourceId of sources) {
  const source = getSource(sourceId);
  const trace = traces.get(sourceId);
  const url = trace?.effectiveUrl || trace?.c0WinnerUrl || source?.url;
  console.log(`\n${'═'.repeat(78)}\n### ${sourceId}  →  ${url}`);
  if (!url) { console.log('  ingen URL'); continue; }

  const c1 = await screenUrl(url);
  const html = (c1 as any).html as string | undefined;
  if (!html) { console.log(`  ingen HTML: ${(c1 as any).fetchError ?? 'okänd'}`); continue; }

  // Minimal HTML-parsing: hitta <a ...>text</a> och deras ancestry via cheerio.
  const { load } = await import('cheerio');
  const $ = load(html);

  const found: string[] = [];
  $('a[href]').each((_: unknown, el: any) => {
    const $a = $(el);
    const text = $a.text().trim().replace(/\s+/g, ' ');
    if (!text) return;
    if (!SUSPECT_TEXTS.includes(text.toLowerCase())) return;

    const chain: string[] = [];
    let node = $a;
    for (let depth = 0; depth < 7; depth++) {
      const $p = node.parent();
      if (!$p.length) break;
      const el2 = $p.get(0);
      if (!el2 || (el2 as any).name === 'html') break;
      const tag = (el2 as any).name;
      const cls = (($p.attr('class') || '').split(/\s+/).filter(Boolean)).slice(0, 3).join('.');
      const id = $p.attr('id') || '';
      chain.push(`${tag}${id ? '#' + id : ''}${cls ? '.' + cls : ''}`);
      node = $p;
    }
    const $card = $a.closest('li, article, [class*="event"], [class*="item"], [class*="card"], [class*="kalender"], [class*="program"]');
    const cardCls = ($card.attr('class') || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    found.push(
      `    "${text}"\n` +
      `      href     = ${($a.attr('href') || '').slice(0, 80)}\n` +
      `      ancestry = ${chain.join(' < ')}\n` +
      `      card     = ${cardCls ? cardCls : '(ingen)'} (${$card.length ? 'hittad' : 'saknas'})`,
    );
  });

  if (found.length === 0) console.log('  (inga misstänkta länktexter på sidan)');
  else console.log(found.join('\n'));
}
