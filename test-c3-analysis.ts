/**
 * Test script: Analysera C3/HTML-extraction parametrar på 20 källor
 * Körs med: npx tsx test-c3-analysis.ts
 */
import { extractFromHtml } from './F-eventExtraction/extractor';
import { fetchHtml } from './tools/fetchTools';
import { load } from 'cheerio';

// 20 testkällor från candidate-lists, olika kategorier
const TEST_URLS = [
  // Arena/High potential
  { url: 'https://strawberryarena.se/evenemang/', name: 'Strawberry Arena', category: 'arena' },
  { url: 'https://www.aviciiarena.se', name: 'Avicii Arena', category: 'arena' },
  { url: 'https://annexet.se/', name: 'Annexet', category: 'arena' },
  // Konserthus/Teater
  { url: 'https://www.konserthuset.se/program-och-biljetter/kalender', name: 'Konserthuset', category: 'konserthus' },
  { url: 'https://www.gso.se/konserthuset/', name: 'Göteborgs Konserthus', category: 'konserthus' },
  { url: 'https://www.varakonserthus.se/', name: 'Vara Konserthus', category: 'konserthus' },
  { url: 'https://folkoperan.se/', name: 'Folkoperan', category: 'opera' },
  // Kulturhus/Museum
  { url: 'https://dunkerskulturhus.se/pa-scen/musik/', name: 'Dunkers Kulturhus', category: 'kulturhus' },
  { url: 'https://artipelag.se/hander-pa-artipelag/', name: 'Artipelag', category: 'kulturhus' },
  { url: 'https://hallandskonstmuseum.se/evenemang/', name: 'Hallands Konstmuseum', category: 'museum' },
  // Kommun/Stad
  { url: 'https://evenemang.malmo.se/', name: 'Malmö Stad', category: 'kommun' },
  { url: 'https://www.gavle.se/gavlekalendern/', name: 'Gävlekalendern', category: 'kommun' },
  { url: 'https://www.bollnas.se/turism/upplev-bollnas/evenemang', name: 'Bollnäs', category: 'kommun' },
  { url: 'https://destinationuppsala.se/', name: 'Destination Uppsala', category: 'kommun' },
  // Festival/Nöje
  { url: 'https://www.liseberg.se/parken/evenemang/', name: 'Liseberg', category: 'nojespark' },
  { url: 'https://alivefestival.se/', name: 'Alive Festival', category: 'festival' },
  // Sport
  { url: 'https://www.svenskfotboll.se/', name: 'Svensk Fotboll', category: 'sport' },
  { url: 'https://schack.se/evenemang/lund-open-10/2026-03-24/', name: 'Lund Open Schack', category: 'sport' },
  // Media/Aggregator
  { url: 'https://www.dagen.se/kalendern/', name: 'Dagen', category: 'media' },
  { url: 'https://www.visitstockholm.se/event/', name: 'Visit Stockholm', category: 'turistbyra' },
];

interface ExtractionAnalysis {
  url: string;
  name: string;
  category: string;
  fetchOk: boolean;
  error?: string;
  // C3 AI extraction params
  htmlSize?: number;
  bodyTextLen?: number;
  truncatedAt?: number;
  // extractFromHtml results
  eventsFound: number;
  eventTitles: string[];
  // URL date strategy detection
  hasUrlDatePatternA: boolean;
  hasUrlDatePatternB: boolean;
  hasIsoPathDate: boolean;
  hasSwedishDate: boolean;
  // Scope analysis
  scopeElements: number;
  eventLinksFound: number;
  navLinksSkipped: number;
  // Sub-link discovery signals
  internalLinksFound: number;
  kalenderLinks: number;
  eventPathLinks: number;
}

function analyzeHtml(html: string, url: string): ExtractionAnalysis {
  const $ = load(html);
  const result: ExtractionAnalysis = {
    url,
    name: '',
    category: '',
    fetchOk: true,
    eventsFound: 0,
    eventTitles: [],
    hasUrlDatePatternA: false,
    hasUrlDatePatternB: false,
    hasIsoPathDate: false,
    hasSwedishDate: false,
    scopeElements: 0,
    eventLinksFound: 0,
    navLinksSkipped: 0,
    internalLinksFound: 0,
    kalenderLinks: 0,
    eventPathLinks: 0,
  };

  result.htmlSize = Buffer.byteLength(html, 'utf8');

  // URL date pattern detection (used by extractFromHtml)
  const urlDateRegexA = /\/?(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\/?/g;
  const urlDateRegexB = /\/?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\/?/g;
  const isoPathDateRegex = /\/(\d{4})\/(\d{2})\/(\d{2})\//g;
  const sweDateRegex = /(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(\d{4})/gi;

  result.hasUrlDatePatternA = urlDateRegexA.test(url);
  result.hasUrlDatePatternB = urlDateRegexB.test(url);
  result.hasIsoPathDate = isoPathDateRegex.test(url);

  const bodyText = $('body').text();
  result.bodyTextLen = bodyText.length;
  result.hasSwedishDate = sweDateRegex.test(bodyText);

  // Scope elements count
  result.scopeElements = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list').length;

  // Count internal links
  const scope = $('main, article, [role="main"], .content, .event-content, .kalender, .event-list');
  const allLinks = scope.find('a[href]');
  result.internalLinksFound = allLinks.length;

  // Count kalender and event-path links
  allLinks.each((_: any, el: any) => {
    const href = $(el).attr('href') || '';
    if (href.includes('/kalender/')) result.kalenderLinks++;
    if (/\/event\//.test(href)) result.eventPathLinks++;
  });

  // Count nav/footer links skipped by extractFromHtml
  const navFooterLinks = $('nav a[href], footer a[href]').length;
  result.navLinksSkipped = navFooterLinks;

  return result;
}

async function main() {
  console.log('=== C3/HTML Extraction Parameter Analysis ===\n');
  console.log(`Testing ${TEST_URLS.length} sources...\n`);

  const results: ExtractionAnalysis[] = [];

  for (const { url, name, category } of TEST_URLS) {
    process.stdout.write(`Testing ${name}... `);
    try {
      const fetchResult = await fetchHtml(url, { timeout: 15000 });
      if (!fetchResult.success || !fetchResult.html) {
        results.push({ url, name, category, fetchOk: false, error: fetchResult.error, eventsFound: 0, eventTitles: [], hasUrlDatePatternA: false, hasUrlDatePatternB: false, hasIsoPathDate: false, hasSwedishDate: false, scopeElements: 0, eventLinksFound: 0, navLinksSkipped: 0, internalLinksFound: 0, kalenderLinks: 0, eventPathLinks: 0 });
        console.log(`FAIL: ${fetchResult.error}`);
        continue;
      }

      const analysis = analyzeHtml(fetchResult.html, url);
      analysis.name = name;
      analysis.category = category;

      // Run extractFromHtml
      const extractResult = extractFromHtml(fetchResult.html, name, url);
      analysis.eventsFound = extractResult.events.length;
      analysis.eventTitles = extractResult.events.slice(0, 5).map(e => e.title);

      results.push(analysis);
      console.log(`OK: ${analysis.eventsFound} events, ${analysis.htmlSize} bytes, ${analysis.bodyTextLen} text chars`);
    } catch (e) {
      results.push({ url, name, category, fetchOk: false, error: (e as Error).message, eventsFound: 0, eventTitles: [], hasUrlDatePatternA: false, hasUrlDatePatternB: false, hasIsoPathDate: false, hasSwedishDate: false, scopeElements: 0, eventLinksFound: 0, navLinksSkipped: 0, internalLinksFound: 0, kalenderLinks: 0, eventPathLinks: 0 });
      console.log(`ERROR: ${(e as Error).message}`);
    }
  }

  // Print summary table
  console.log('\n\n=== RESULTS TABLE ===\n');

  const header = '| # | Källa | Kat | Fetch | Events | URL-DateA | URL-DateB | IsoPath | SweDate | Scope | IntLinks | KalLinks | EventLinks | NavSkip | HTML-kB | Text-kB |';
  const sep = '|---|-------|-----|-------|--------|-----------|-----------|---------|---------|--------|----------|----------|-----------|---------|---------|--------|';
  console.log(header);
  console.log(sep);

  results.forEach((r, i) => {
    const htmlKb = r.htmlSize ? Math.round(r.htmlSize / 1024) : 0;
    const textKb = r.bodyTextLen ? Math.round(r.bodyTextLen / 1024) : 0;
    const fetchOk = r.fetchOk ? '✓' : '✗';
    const events = r.eventsFound > 0 ? `✓${r.eventsFound}` : '0';
    const urlDateA = r.hasUrlDatePatternA ? '✓' : '';
    const urlDateB = r.hasUrlDatePatternB ? '✓' : '';
    const isoPath = r.hasIsoPathDate ? '✓' : '';
    const sweDate = r.hasSwedishDate ? '✓' : '';
    console.log(`| ${i+1} | ${r.name.substring(0,15)} | ${r.category.substring(0,5)} | ${fetchOk} | ${events} | ${urlDateA} | ${urlDateB} | ${isoPath} | ${sweDate} | ${r.scopeElements} | ${r.internalLinksFound} | ${r.kalenderLinks} | ${r.eventPathLinks} | ${r.navLinksSkipped} | ${htmlKb} | ${textKb} |`);
  });

  // Category summary
  console.log('\n\n=== CATEGORY SUMMARY ===\n');
  const catStats: Record<string, { total: number; withEvents: number; totalEvents: number }> = {};
  for (const r of results) {
    if (!catStats[r.category]) catStats[r.category] = { total: 0, withEvents: 0, totalEvents: 0 };
    catStats[r.category].total++;
    if (r.eventsFound > 0) catStats[r.category].withEvents++;
    catStats[r.category].totalEvents += r.eventsFound;
  }

  console.log('| Kategori | Totalt | Med events | Totalt events |');
  console.log('|----------|--------|------------|---------------|');
  for (const [cat, stats] of Object.entries(catStats)) {
    console.log(`| ${cat} | ${stats.total} | ${stats.withEvents} | ${stats.totalEvents} |`);
  }

  // Parameter effectiveness analysis
  console.log('\n\n=== PARAMETER EFFECTIVENESS ===\n');

  const withUrlDateA = results.filter(r => r.hasUrlDatePatternA);
  const withUrlDateB = results.filter(r => r.hasUrlDatePatternB);
  const withIsoPath = results.filter(r => r.hasIsoPathDate);
  const withSweDate = results.filter(r => r.hasSwedishDate);
  const withKalenderLinks = results.filter(r => r.kalenderLinks > 0);
  const withEventPathLinks = results.filter(r => r.eventPathLinks > 0);

  function avgEvents(arr: ExtractionAnalysis[]) {
    const withEvts = arr.filter(r => r.eventsFound > 0);
    return withEvts.length > 0 ? (withEvts.reduce((s, r) => s + r.eventsFound, 0) / withEvts.length).toFixed(1) : '0';
  }

  function pctWithEvents(arr: ExtractionAnalysis[]) {
    const withEvts = arr.filter(r => r.eventsFound > 0);
    return `${withEvts.length}/${arr.length} (${Math.round(withEvts.length / arr.length * 100)}%)`;
  }

  console.log('| Parameter | Antal | Med events | % | Snitt events |');
  console.log('|-----------|-------|------------|---|--------------|');
  console.log(`| URL-DateA (/YYYY-MM-DD-HHMM/) | ${withUrlDateA.length} | ${pctWithEvents(withUrlDateA)} | ${Math.round(withUrlDateA.length/results.length*100)}% | ${avgEvents(withUrlDateA)} |`);
  console.log(`| URL-DateB (/YYYYMMDD-HHMM/) | ${withUrlDateB.length} | ${pctWithEvents(withUrlDateB)} | ${Math.round(withUrlDateB.length/results.length*100)}% | ${avgEvents(withUrlDateB)} |`);
  console.log(`| ISO-Path (/YYYY/MM/DD/) | ${withIsoPath.length} | ${pctWithEvents(withIsoPath)} | ${Math.round(withIsoPath.length/results.length*100)}% | ${avgEvents(withIsoPath)} |`);
  console.log(`| Swedish date in text | ${withSweDate.length} | ${pctWithEvents(withSweDate)} | ${Math.round(withSweDate.length/results.length*100)}% | ${avgEvents(withSweDate)} |`);
  console.log(`| /kalender/ links | ${withKalenderLinks.length} | ${pctWithEvents(withKalenderLinks)} | ${Math.round(withKalenderLinks.length/results.length*100)}% | ${avgEvents(withKalenderLinks)} |`);
  console.log(`| /event/ links | ${withEventPathLinks.length} | ${pctWithEvents(withEventPathLinks)} | ${Math.round(withEventPathLinks.length/results.length*100)}% | ${avgEvents(withEventPathLinks)} |`);
  console.log(`| Scope elements | ${results.filter(r => r.scopeElements > 0).length} | - | - | - |`);

  // Show sources that got events
  console.log('\n\n=== SOURCES WITH EVENTS ===\n');
  const withEvents = results.filter(r => r.eventsFound > 0).sort((a, b) => b.eventsFound - a.eventsFound);
  for (const r of withEvents) {
    console.log(`\n## ${r.name} (${r.category}) — ${r.eventsFound} events`);
    console.log(`URL: ${r.url}`);
    console.log(`Signals: URL-DateA=${r.hasUrlDatePatternA} URL-DateB=${r.hasUrlDatePatternB} ISO-Path=${r.hasIsoPathDate} SweDate=${r.hasSwedishDate}`);
    console.log(`Links: internal=${r.internalLinksFound} kalender=${r.kalenderLinks} event=${r.eventPathLinks}`);
    for (const title of r.eventTitles) {
      console.log(`  - ${title}`);
    }
  }

  if (withEvents.length === 0) {
    console.log('Inga events hittades. extractFromHtml behöver sub-link discovery för dessa källor.');
  }
}

main().catch(console.error);
