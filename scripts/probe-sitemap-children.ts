/**
 * probe-sitemap-children.ts — bevis för C0-fixen (sitemap → event-sidor).
 *
 * Hypotes: en sitemap-XML som vinner C0:s densitetslopp ger INGA events
 * (112/112 traces: C1_NO_MAIN_ARTICLE, 0 successes). Om vi i stället
 * EXPANDERAR sitemapen till dess <loc>-barn (sorterade på <lastmod>, nyast
 * först) och mäter DESS density som vanliga sidor, kan källor som idag dör ge
 * events.
 *
 * Mätscript — ingen produktionskod ändras.
 *
 *   npx tsx scripts/probe-sitemap-children.ts --sources a,b,c --max-children 8
 */

import { fetchAllSitemaps } from '../02-Ingestion/C-htmlGate/tools/scrapingBeeDeep.js';
import { screenUrl } from '../02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.js';
import { extractFromHtml } from '../02-Ingestion/F-eventExtraction/universal-extractor.js';
import { getSource } from '../02-Ingestion/tools/sourceRegistry.js';

const args = process.argv.slice(2);
const idx = args.indexOf('--sources');
const sources = idx >= 0 ? (args[idx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
const cIdx = args.indexOf('--max-children');
const MAX_CHILDREN = cIdx >= 0 ? parseInt(args[cIdx + 1], 10) : 8;
if (sources.length === 0) {
  console.error('Ange --sources a,b,c');
  process.exit(2);
}

/** Sitemap-XML: <url><loc>…</loc><lastmod>…</lastmod></url> */
function parseSitemapEntries(xml: string): Array<{ loc: string; lastmod: string }> {
  const out: Array<{ loc: string; lastmod: string }> = [];
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  for (const b of blocks) {
    const loc = b.match(/<loc[^>]*>([^<]*)<\/loc>/i)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = b.match(/<lastmod[^>]*>([^<]*)<\/lastmod>/i)?.[1]?.trim() || '';
    out.push({ loc, lastmod });
  }
  return out;
}

/** Path-token som tyder på en event-sida — samma familj som C0:s koncept. */
const EVENT_PATH_TOKENS = [
  'repertoar', 'forestallning', 'program', 'programme', 'agenda', 'kalender',
  'calendar', 'kalendarium', 'evenemang', 'event', 'show', 'shows', 'shower',
  'produktion', 'scen', 'forestailling', 'konsert', 'festival', 'spelning',
  'aktivitet', 'verksamhet',
];

function looksLikeEventPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return EVENT_PATH_TOKENS.some((t) => p.includes(`/${t}`) || p.includes(`-${t}-`) || p.includes(`-${t}`));
}

const summary: Array<{ sourceId: string; children: number; eventLike: number; sampled: number; events: number }> = [];

for (const sourceId of sources) {
  const source = getSource(sourceId);
  if (!source) {
    console.log(`\n### ${sourceId}: EJ I REGISTRET`);
    continue;
  }
  const base = new URL(source.url).origin;

  const entries: Array<{ loc: string; lastmod: string; ts: number }> = [];
  try {
    const sm = await fetchAllSitemaps(base);
    for (const su of sm.urls) {
      try {
        const res = await fetch(su, { redirect: 'follow' });
        if (!res.ok) continue;
        for (const e of parseSitemapEntries(await res.text())) {
          entries.push({ loc: e.loc, lastmod: e.lastmod, ts: e.lastmod ? Date.parse(e.lastmod) || 0 : 0 });
        }
      } catch { /* skip */ }
    }
  } catch (e) {
    console.log(`\n### ${sourceId} — sitemap-fel: ${(e as Error).message.slice(0, 70)}`);
  }

  // Same-origin + event-liknande path
  const eventLike = entries.filter((e) => {
    try {
      const o = new URL(e.loc);
      return o.origin === base && looksLikeEventPath(o.pathname);
    } catch {
      return false;
    }
  });

  // Nyast ändrade först (sitemap-standard: <lastmod> = "senast ändrad")
  const ordered = [...eventLike].sort((a, b) => b.ts - a.ts);

  console.log(`\n### ${sourceId} — ${source.url}`);
  console.log(`  sitemap-barn=${entries.length} | event-liknande=${eventLike.length}`);

  let events = 0;
  const sampled = ordered.slice(0, MAX_CHILDREN);
  for (const e of sampled) {
    try {
      const c1 = await screenUrl(e.loc);
      const html = (c1 as any).html;
      if (!html) {
        console.log(`    -      ${e.loc}`);
        continue;
      }
      const res = extractFromHtml(html, sourceId, e.loc);
      const n = res.events?.length || 0;
      events += n;
      console.log(`    ${String(n).padStart(3)} ev  ${e.loc}  (c1=${(c1 as any).categorization}, lastmod=${e.lastmod.slice(0, 10)})`);
    } catch (err) {
      console.log(`    fel    ${e.loc}: ${(err as Error).message.slice(0, 50)}`);
    }
  }
  console.log(`  → ${events} events från ${sampled.length} sidor`);
  summary.push({ sourceId, children: entries.length, eventLike: eventLike.length, sampled: sampled.length, events });
}

console.log('\n=== SAMMANFATTNING ===');
for (const s of summary) {
  console.log(
    `  ${s.sourceId.padEnd(42)} barn=${String(s.children).padStart(5)} ev-likn=${String(s.eventLike).padStart(4)} provade=${String(s.sampled).padStart(2)} events=${s.events}`,
  );
}
const withEvents = summary.filter((s) => s.events > 0);
console.log(`\nkällor som ger events via sitemap-expansion: ${withEvents.length}/${summary.length}`);
