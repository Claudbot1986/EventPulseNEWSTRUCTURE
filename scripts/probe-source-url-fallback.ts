/**
 * probe-source-url-fallback.ts — mäter om en källas ORIGINELLA URL ger
 * events när C0-vinnaren inte gör det.
 *
 * Frågan (2026-10-24): C0 rankar kandidater efter densitet och bara vinnaren
 * testas vidare. Nästa-kandidat-fallbacken testar de tre näst bästa
 * C0-kandidaterna — men INTE källans egen start-URL. Om start-URL:en pekar
 * på en riktig event-sida (t.ex. ett teaterstycke) så förlorar vi den.
 *
 * Det här skriptet mäter svaret på riktig data, per källa:
 *   - C0-vinnaren (körs igen)
 *   - alternativ 1..3 ur C0-listan (körs igen)
 *   - start-URL:en (körs)
 *
 * Ingen gate ändras här — bara mätning. Resultatet avgör om en fix är
 * befogad och hur bred den är (Generalization Protection Rule).
 *
 * Kör:  npx tsx --env-file=.env scripts/probe-source-url-fallback.ts <sourceId> [<sourceId> ...]
 */

import { screenUrl } from '../02-Ingestion/C-htmlGate/index.js';
import { extractFromHtml } from '../02-Ingestion/F-eventExtraction/universal-extractor.js';
import { discoverEventCandidates } from '../02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.js';

interface Candidate {
  url: string;
  eventDensityScore?: number;
}

const NEXT_CANDIDATE_LIMIT = 3;

async function probe(url: string, sourceId: string): Promise<{ events: number; titles: string[]; bytes: number; fetchError?: string }> {
  try {
    const c1: any = await screenUrl(url);
    const html = c1?.html as string | undefined;
    if (!html) return { events: 0, titles: [], bytes: 0, fetchError: c1?.fetchError ?? 'ingen HTML' };
    const ext = extractFromHtml(html, sourceId, url);
    const titles = ext.events.slice(0, 6).map((e: any) => e.title);
    return { events: ext.events.length, titles, bytes: Buffer.byteLength(html, 'utf8') };
  } catch (e: any) {
    return { events: 0, titles: [], bytes: 0, fetchError: e?.message ?? String(e) };
  }
}

async function main(): Promise<void> {
  const sourceIds = process.argv.slice(2);
  if (sourceIds.length === 0) {
    console.error('Användning: probe-source-url-fallback.ts <sourceId> [...]');
    process.exit(1);
  }

  for (const sourceId of sourceIds) {
    console.log(`\n═══ ${sourceId} ═══`);
    const sourceUrl = SOURCE_URLS[sourceId];
    if (!sourceUrl) {
      console.log(`  (ingen URL känd för ${sourceId})`);
      continue;
    }
    console.log(`  start-URL: ${sourceUrl}`);

    let c0Top: Candidate[] = [];
    let winnerUrl: string | null = null;
    try {
      const c0: any = await discoverEventCandidates(sourceUrl, [], sourceId);
      c0Top = (c0?.topCandidates ?? []) as Candidate[];
      winnerUrl = c0?.winner?.url ?? null;
      console.log(`  C0-vinnare: ${winnerUrl ?? '(ingen)'}  (kandidater: ${c0?.candidates ?? 0})`);
    } catch (e: any) {
      console.log(`  C0-fel: ${e?.message ?? String(e)}`);
    }

    const tried = new Set<string>();
    const queue: Array<{ label: string; url: string }> = [];
    if (winnerUrl) queue.push({ label: 'C0-vinnare', url: winnerUrl });
    for (const c of c0Top.filter((c) => c.url !== winnerUrl).slice(0, NEXT_CANDIDATE_LIMIT)) {
      queue.push({ label: `alt(density=${c.eventDensityScore})`, url: c.url });
    }
    queue.push({ label: 'START-URL', url: sourceUrl });

    for (const item of queue) {
      if (tried.has(item.url)) continue;
      tried.add(item.url);
      const r = await probe(item.url, sourceId);
      const mark = r.events > 0 ? '★ EVENTS' : '   0 events';
      console.log(`  [${mark}] ${item.label.padEnd(22)} ${item.url}`);
      if (r.fetchError) console.log(`       fel: ${r.fetchError}`);
      if (r.events > 0) console.log(`       ${r.events} events: ${r.titles.map((t) => JSON.stringify(t)).join(', ')}`);
    }
  }
}

/** Start-URL:er för källorna som ska mätas. */
const SOURCE_URLS: Record<string, string> = {
  hammarby: 'https://www.hammarbyfotboll.se',
  'iogt-nto': 'https://www.iogt.se',
  wwwiogtse: 'https://www.iogt.se/feed',
  wwwrustourismnewscom:
    'https://www.rustourismnews.com/2026/05/12/sweden-summer-festivals-2026-8-events-to-book-now/',
  nojesfabriken: 'https://www.nojesfabriken.se/nojeskalendern/',
  wwwscalateaternse: 'https://www.scalateatern.se/forestallning/britt-marie-var-har/',
  wwwmusikindustrinse: 'https://www.musikindustrin.se/2026/05/25/mis-festivalguide-2026/',
  kammarencom: 'https://kammaren.com/',
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
