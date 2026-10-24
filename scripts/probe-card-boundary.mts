/**
 * probe-card-boundary.mts — mäter om substring-matchning på CSS-klasser
 * (t.ex. `[class*="item"]`) matchar UTILITY-klasser som `align-items-center`.
 *
 * Bakgrund (2026-10-24): på scalateatern.se matchar `align-items-center`
 * `[class*="item"]`, så C3:s `closest(...)` snappar kortet till `.col.content`
 * i stället för kortets egen `.post-list--item`. Då saknas datumet i
 * korttexten och evenemanget försvinner helt.
 *
 * Generalization Protection Rule: den här fixen får bara implementeras om
 * mönstret går att verifiera på 2–3 ORELATERADE domäner. Skriptet mäter
 * därför över ett urval kandidatsidor från hela C-kön — inte bara Scalateatern.
 *
 * Kör: npx tsx scripts/probe-card-boundary.mts [antal]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

const CANDIDATE_FILE = path.resolve(process.cwd(), '02-Ingestion/C-candidates-queue.jsonl');

/** Nuvarande substring-semantik (C3 closest + C1 EVENT_CARD_SELECTORS). */
const CURRENT = '[class*="item"]';
/** Föreslagen boundary-semantik: keyword måste avgränsas av icke-bokstäver. */
const BOUNDARY = '[class*="-item"], [class*=" item"], [class$="-item"], [class$=" item"], [class^="item"], [class^="item "]';

interface Dom {
  domain: string;
  falsePositives: number;
  realCardsTruncated: number;
  anchorsChanged: number;
  changedClasses: string[];
  weekdayPlusDateCards: number;
  weekdayPlusDateExamples: string[];
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
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
    return await res.text();
  } catch {
    return null;
  }
}

const WEEKDAY_RX = /\b(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b/i;
const YEARLESS_RX = /\b([0-3]?\d)\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)\b(?!\s*,?\s*\d{4})/i;

async function analyse(domain: string, html: string): Promise<Dom> {
  const $ = cheerio.load(html);

  // 1. Element som matchar substring "[class*=\"item\"]" men INTE boundary.
  const falsePositives = $(CURRENT).filter((_: any, el: any) => $(el).is(BOUNDARY) === false).length;

  // 2. Anchors vars kort ändras av fixen (card-resolution ändras).
  let anchorsChanged = 0;
  let realCardsTruncated = 0;
  const changedClasses = new Set<string>();
  $('a[href]').each((_: any, el: any) => {
    const $a = $(el);
    const current = $a.closest(
      'li, article, [class*="event"], [class*="item"], [class*="card"], [class*="kalender"], [class*="program"]'
    );
    const boundary = $a.closest(
      'li, article, [class*="event"], [class*="-item"], [class*="card"], [class*="kalender"], [class*="program"]'
    );
    if (current.length === boundary.length) return;
    anchorsChanged++;
    const cls = (current.attr('class') || '').toLowerCase();
    changedClasses.add(cls.slice(0, 60));
    // Är den nuvarande kortet en "utility"-truncering?
    if (/align-items|justify-items|flex-items|list-items/.test(cls)) realCardsTruncated++;
  });

  // 3. Kort som har BÅDE veckodag och "D MMM" (datum-precedens-konflikt).
  let weekdayPlusDateCards = 0;
  const examples: string[] = [];
  const CARDISH = '[class*="item"], [class*="event"], [class*="card"], [class*="post"], [class*="show"], [class*="program"], [class*="kalender"], li, article';
  $(CARDISH).each((_: any, el: any) => {
    const txt = $(el).text().replace(/\s+/g, ' ');
    if (txt.length > 400) return;
    const wd = txt.match(WEEKDAY_RX);
    const dm = txt.match(YEARLESS_RX);
    if (wd && dm) {
      weekdayPlusDateCards++;
      if (examples.length < 2) examples.push(`${wd[1]} + ${dm[0]} :: ${txt.slice(0, 70)}`);
    }
  });

  return {
    domain,
    falsePositives,
    realCardsTruncated,
    anchorsChanged,
    changedClasses: [...changedClasses].slice(0, 4),
    weekdayPlusDateCards,
    weekdayPlusDateExamples: examples,
  };
}

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? 40);
  const rows = fs
    .readFileSync(CANDIDATE_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((d: any) => d?.url);

  const byType = new Map<string, any[]>();
  for (const r of rows) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type)!.push(r);
  }
  const picked: any[] = [];
  const types = [...byType.keys()].sort();
  let i = 0;
  while (picked.length < limit && types.length > 0) {
    const t = types[i % types.length];
    const bucket = byType.get(t)!;
    if (bucket.length === 0) {
      types.splice(i % types.length, 1);
      continue;
    }
    picked.push(bucket.shift());
    i++;
  }

  console.log(`Analyserar ${picked.length} sidor…\n`);
  const results: Dom[] = [];
  const CONCURRENCY = 6;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < picked.length) {
      const r = picked[cursor++];
      const html = await fetchHtml(r.url);
      if (!html) continue;
      const domain = new URL(r.url).hostname.replace(/^www\./, '');
      try {
        results.push(await analyse(domain, html));
      } catch {
        /* skip */
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const withFp = results.filter((r) => r.falsePositives > 0);
  const withTrunc = results.filter((r) => r.realCardsTruncated > 0);
  const withAnchorChange = results.filter((r) => r.anchorsChanged > 0);
  const withWdDate = results.filter((r) => r.weekdayPlusDateCards > 0);

  console.log('═══ A. Substring-matchning träffar utility-klasser ═══');
  console.log(`sidor med falska träffar: ${withFp.length}/${results.length}`);
  console.log(`domäner: ${withFp.map((r) => r.domain).join(', ')}`);
  console.log('\n═══ B. Anchors vars kort ändras vid fixen ═══');
  console.log(`sidor med ändrade anchors: ${withAnchorChange.length}/${results.length}`);
  for (const r of withAnchorChange) {
    console.log(`  ${r.domain}: ${r.anchorsChanged} anchors, ${r.realCardsTruncated} trunceringar`);
    for (const c of r.changedClasses) console.log(`      gammalt kort: "${c}"`);
  }
  console.log('\n═══ C. Kort med både veckodag och D MMM (datum-precedens) ═══');
  console.log(`sidor med konflikter: ${withWdDate.length}/${results.length}`);
  console.log(`domäner: ${withWdDate.map((r) => r.domain).join(', ')}`);
  for (const r of withWdDate.slice(0, 8)) {
    for (const ex of r.weekdayPlusDateExamples) console.log(`  ${r.domain}: ${ex}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
