/**
 * probe-sitemap-lastmod.ts — finns det ett generiskt sätt att välja "aktuella"
 * sidor ur en sitemap med tusentals barn?
 *
 * Sitemap-XML har standardiserad <lastmod>. Om lastmod varierar kan vi välja
 * de senast ändrade sidorna — generiskt (sitemap-standard), inte sajtspecifikt.
 */

import { fetchAllSitemaps } from '../02-Ingestion/C-htmlGate/tools/scrapingBeeDeep.js';

const bases = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (bases.length === 0) {
  console.error('Ange bas-URL:er');
  process.exit(2);
}

for (const base of bases) {
  const sm = await fetchAllSitemaps(base);
  console.log(`\n=== ${base} — ${sm.urls.length} sitemap-URL:er`);
  for (const su of sm.urls.slice(0, 6)) {
    try {
      const r = await fetch(su, { redirect: 'follow' });
      if (!r.ok) {
        console.log(`   ${su.replace(base, '')} → HTTP ${r.status}`);
        continue;
      }
      const xml = await r.text();
      const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
      const withLm = blocks.filter((b) => /<lastmod>/.test(b)).length;
      const dates = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
      const sorted = [...dates].sort().reverse();
      console.log(
        `   ${su.replace(base, '')} → ${blocks.length} urls, ${withLm} med lastmod` +
          (dates.length ? `, nyaste ${sorted[0]}, äldsta ${sorted[sorted.length - 1]}` : ''),
      );
    } catch (e) {
      console.log(`   ${su.replace(base, '')} → fel ${(e as Error).message.slice(0, 50)}`);
    }
  }
}
