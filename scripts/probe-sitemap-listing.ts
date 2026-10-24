/**
 * probe-sitemap-listing.ts — mät om sitemapens LISTINGSidor ger fler events
 * än enskilda eventsidor.
 *
 * Hypotes: en sitemap innehåller både enskilda eventsidor (/shower/xyz) och
 * LISTINGSidor (/forestallningar/, /program/, /kalender/). En listingsida ger
 * många events med EN fetch — bättre än att prova enskilda sidor.
 *
 * Mätscript — ingen produktionskod ändras.
 *
 *   npx tsx scripts/probe-sitemap-listing.ts --sources a,b,c
 */

import { fetchAllSitemaps, parseXmlSitemap } from '../02-Ingestion/C-htmlGate/tools/scrapingBeeDeep.js';
import { screenUrl } from '../02-Ingestion/C-htmlGate/C1-preHtmlGate/C1-preHtmlGate.js';
import { extractFromHtml } from '../02-Ingestion/F-eventExtraction/universal-extractor.js';
import { getSource } from '../02-Ingestion/tools/sourceRegistry.js';

const args = process.argv.slice(2);
const idx = args.indexOf('--sources');
const sources = idx >= 0 ? (args[idx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
if (sources.length === 0) {
  console.error('Ange --sources a,b,c');
  process.exit(2);
}

/** Sökord som markerar en LISTINGSIDA (samling av många events). */
const LISTING_TOKENS = [
  'forestallningar', 'repertoar', 'program', 'kalender', 'calendar', 'agenda',
  'evenemang', 'events', 'show', 'shows', 'shower', 'kalendarium', 'spelprogram',
];

function isListingPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  const segs = p.split('/').filter(Boolean);
  // Listingsidor: kort path, gärna med avslutande slash, sista segmentet är ett
  // listningsord (ej ett djupt evenemang).
  if (segs.length > 3) return false;
  return LISTING_TOKENS.some((t) => segs.some((s) => s === t || s.startsWith(t)));
}

for (const sourceId of sources) {
  const source = getSource(sourceId);
  if (!source) {
    console.log(`\n### ${sourceId}: EJ I REGISTRET`);
    continue;
  }
  console.log(`\n### ${sourceId} — ${source.url}`);
  const base = new URL(source.url).origin;

  let children: string[] = [];
  try {
    const sm = await fetchAllSitemaps(base);
    for (const su of sm.urls) {
      try {
        const res = await fetch(su, { redirect: 'follow' });
        if (!res.ok) continue;
        children.push(...parseXmlSitemap(await res.text()));
      } catch { /* skip */ }
    }
  } catch (e) {
    console.log(`  sitemap-fel: ${(e as Error).message.slice(0, 80)}`);
  }

  const listings = [...new Set(children)].filter((u) => {
    try {
      const o = new URL(u);
      return o.origin === base && isListingPath(o.pathname);
    } catch {
      return false;
    }
  });
  console.log(`  barn=${children.length} | listingsidor=${listings.length}`);

  let total = 0;
  for (const u of listings.slice(0, 10)) {
    try {
      const c1 = await screenUrl(u);
      const html = (c1 as any).html;
      if (!html) {
        console.log(`    -      ${u} (ingen html)`);
        continue;
      }
      const res = extractFromHtml(html, sourceId, u);
      const n = res.events?.length || 0;
      total += n;
      console.log(`    ${String(n).padStart(3)} ev  ${u}  (c1=${(c1 as any).categorization})`);
    } catch (e) {
      console.log(`    fel    ${u}: ${(e as Error).message.slice(0, 50)}`);
    }
  }
  console.log(`  → ${total} events från ${Math.min(10, listings.length)} listingsidor`);
}
