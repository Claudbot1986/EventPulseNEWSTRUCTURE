/**
 * probe-sitemap-expansion.ts — bevis för/emo mot C0-fixen.
 *
 * Hypotes: C0 väljer sitemap-XML som vinnare eftersom <lastmod>-datum ger
 * hög "event density". Om vi i stället EXPANDERAR sitemapen till dess <loc>-
 * barn (riktiga event-sidor) kan vi få events från källor som idag dör med
 * C1_NO_MAIN_ARTICLE.
 *
 * Detta är ett MÄTSCRIPT — ingen produktionskod ändras. Det kör samma
 * kodvägar som gaten: fetch → parseXmlSitemap → screenUrl → extractFromHtml.
 *
 * Användning:
 *   npx tsx scripts/probe-sitemap-expansion.ts --sources a,b,c --max-children 6
 */

import { fetchAllSitemaps, parseXmlSitemap } from '../02-Ingestion/C-htmlGate/tools/scrapingBeeDeep.js';
import { screenUrl } from '../02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.js';
import { extractFromHtml } from '../02-Ingestion/F-eventExtraction/universal-extractor.js';
import { getSource } from '../02-Ingestion/tools/sourceRegistry.js';

const args = process.argv.slice(2);
const idx = args.indexOf('--sources');
const sources = idx >= 0 ? (args[idx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
const cIdx = args.indexOf('--max-children');
const MAX_CHILDREN = cIdx >= 0 ? parseInt(args[cIdx + 1], 10) : 6;

if (sources.length === 0) {
  console.error('Ange --sources a,b,c');
  process.exit(2);
}

/** Path-token som tyder på en event-sida (samma familj som C0:s koncept). */
const EVENT_PATH_TOKENS = [
  'repertoar', 'forestallning', 'program', 'programme', 'agenda', 'kalender',
  'calendar', 'evenemang', 'event', 'show', 'shows', 'shower', 'produktion',
  'scen', 'forestailling', 'konsert', 'festival', 'spelning',
];

function looksLikeEventPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return EVENT_PATH_TOKENS.some((t) => p.includes(`/${t}`) || p.includes(`-${t}-`) || p.includes(`-${t}`));
}

const summary: Array<{ sourceId: string; sitemapChildren: number; sampled: number; events: number; eventUrls: string[] }> = [];

for (const sourceId of sources) {
  const source = getSource(sourceId);
  if (!source) {
    console.log(`\n### ${sourceId}: HITTADES INTE i registret`);
    continue;
  }
  console.log(`\n### ${sourceId} — ${source.url}`);

  const base = new URL(source.url).origin;
  let children: string[] = [];
  try {
    const sm = await fetchAllSitemaps(base);
    for (const sitemapUrl of sm.urls) {
      try {
        const res = await fetch(sitemapUrl, { redirect: 'follow' });
        if (!res.ok) continue;
        const xml = await res.text();
        children.push(...parseXmlSitemap(xml));
      } catch {
        /* skip */
      }
    }
  } catch (e) {
    console.log(`  sitemap-hämtning misslyckades: ${(e as Error).message.slice(0, 100)}`);
  }

  // Endast same-origin + event-liknande paths
  const eventLike = [...new Set(children)].filter((u) => {
    try {
      const o = new URL(u);
      if (o.origin !== base) return false;
      return looksLikeEventPath(o.pathname);
    } catch {
      return false;
    }
  });

  console.log(`  sitemap-barn: ${children.length} totalt | ${eventLike.length} event-liknande`);

  // Prioritera DJUPA paths (/shower/xyz, /repertoar/xyz) framför kategorisidor
  // (/forestallningar/) — de senare är samlingssidor, inte enskilda eventsidor.
  const deepFirst = [...eventLike].sort((a, b) => {
    const da = new URL(a).pathname.split('/').filter(Boolean).length;
    const db = new URL(b).pathname.split('/').filter(Boolean).length;
    const trailingA = new URL(a).pathname.endsWith('/') ? 1 : 0;
    const trailingB = new URL(b).pathname.endsWith('/') ? 1 : 0;
    return trailingA - trailingB || db - da;
  });

  let events = 0;
  const eventUrls: string[] = [];
  const sampled = deepFirst.slice(0, MAX_CHILDREN);
  for (const u of sampled) {
    try {
      const c1 = await screenUrl(u);
      const html = (c1 as any).html;
      if (!html) continue;
      const res = extractFromHtml(html, sourceId, u);
      const n = res.events?.length || 0;
      if (n > 0) {
        events += n;
        eventUrls.push(`${u} (${n})`);
        console.log(`    EVENTS ${n}  ${u}`);
      } else {
        console.log(`    0      ${u}  (c1=${(c1 as any).categorization})`);
      }
    } catch (e) {
      console.log(`    fel    ${u}: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  console.log(`  → ${events} events från ${sampled.length} provade sidor (av ${eventLike.length} event-liknande)`);
  summary.push({ sourceId, sitemapChildren: children.length, sampled: sampled.length, events, eventUrls });
}

console.log('\n=== SAMMANFATTNING ===');
for (const s of summary) {
  console.log(`  ${s.sourceId.padEnd(34)} barn=${String(s.sitemapChildren).padStart(5)} provade=${String(s.sampled).padStart(3)} events=${s.events}`);
}
const withEvents = summary.filter((s) => s.events > 0);
console.log(`\nkällor som ger events via sitemap-expansion: ${withEvents.length}/${summary.length}`);
