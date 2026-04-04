/**
 * Test: Kör extractFromHtml på 20 källor och analysera C3-parametrar
 */
const { extractFromHtml } = await import('./02-Ingestion/F-eventExtraction/extractor');
const { fetchHtml } = await import('./02-Ingestion/tools/fetchTools');

const TEST_URLS = [
  { url: 'https://strawberryarena.se/evenemang/', name: 'Strawberry Arena', category: 'arena' },
  { url: 'https://www.aviciiarena.se', name: 'Avicii Arena', category: 'arena' },
  { url: 'https://annexet.se/', name: 'Annexet', category: 'arena' },
  { url: 'https://www.konserthuset.se/program-och-biljetter/kalender', name: 'Konserthuset', category: 'konserthus' },
  { url: 'https://www.gso.se/konserthuset/', name: 'Göteborgs Konserthus', category: 'konserthus' },
  { url: 'https://www.varakonserthus.se/', name: 'Vara Konserthus', category: 'konserthus' },
  { url: 'https://folkoperan.se/', name: 'Folkoperan', category: 'opera' },
  { url: 'https://dunkerskulturhus.se/pa-scen/musik/', name: 'Dunkers Kulturhus', category: 'kulturhus' },
  { url: 'https://artipelag.se/hander-pa-artipelag/', name: 'Artipelag', category: 'kulturhus' },
  { url: 'https://hallandskonstmuseum.se/evenemang/', name: 'Hallands Konstmuseum', category: 'museum' },
  { url: 'https://evenemang.malmo.se/', name: 'Malmö Stad', category: 'kommun' },
  { url: 'https://www.gavle.se/gavlekalendern/', name: 'Gävlekalendern', category: 'kommun' },
  { url: 'https://www.bollnas.se/turism/upplev-bollnas/evenemang', name: 'Bollnäs', category: 'kommun' },
  { url: 'https://destinationuppsala.se/', name: 'Destination Uppsala', category: 'kommun' },
  { url: 'https://www.liseberg.se/parken/evenemang/', name: 'Liseberg', category: 'nojespark' },
  { url: 'https://alivefestival.se/', name: 'Alive Festival', category: 'festival' },
  { url: 'https://www.svenskfotboll.se/', name: 'Svensk Fotboll', category: 'sport' },
  { url: 'https://schack.se/evenemang/lund-open-10/2026-03-24/', name: 'Lund Open Schack', category: 'sport' },
  { url: 'https://www.dagen.se/kalendern/', name: 'Dagen', category: 'media' },
  { url: 'https://www.visitstockholm.se/event/', name: 'Visit Stockholm', category: 'turistbyra' },
];

async function main() {
  const results: any[] = [];

  for (const { url, name, category } of TEST_URLS) {
    process.stdout.write(`Testing ${name}... `);
    try {
      const fetchResult = await fetchHtml(url, { timeout: 15000 });
      if (!fetchResult.success || !fetchResult.html) {
        results.push({ name, category, fetch_ok: false, error: fetchResult.error, events: 0 });
        console.log(`FAIL: ${fetchResult.error}`);
        continue;
      }
      const extract = extractFromHtml(fetchResult.html, name, url);
      results.push({ name, category, fetch_ok: true, events: extract.events.length });
      console.log(`OK: ${extract.events.length} events`);
    } catch (e: any) {
      results.push({ name, category, fetch_ok: false, error: e.message, events: 0 });
      console.log(`ERROR: ${e.message}`);
    }
  }

  // Print events summary
  console.log('\n\n=== EVENTS FOUND ===');
  const withEvents = results.filter(r => r.events > 0).sort((a, b) => b.events - a.events);
  for (const r of withEvents) {
    console.log(`${r.name} (${r.category}): ${r.events} events`);
  }
  if (withEvents.length === 0) {
    console.log('INGA EVENTS — extractFromHtml hittade 0 events på alla 20 källor');
  }
  console.log(`\nTotal: ${withEvents.length}/20 med events`);

  // Save
  const fs = await import('fs');
  fs.writeFileSync('/tmp/c3_events_results.json', JSON.stringify(results, null, 2));
}

main().catch(console.error);
