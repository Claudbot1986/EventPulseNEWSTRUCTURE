import { extractFromRss } from '../02-Ingestion/B-JSON-feedGate/rssExtractor.js';

async function main() {
  const result = await extractFromRss(
    'https://www.kth.se/om/upptack/kalender?rss=calendar',
    'kth-2'
  );

  console.log('=== RSS SMOKE TEST (kth-2) ===');
  console.log(`format:   ${result.format}`);
  console.log(`rawCount: ${result.rawCount}`);
  console.log(`events:   ${result.events.length}`);
  console.log(`errors:   ${result.parseErrors.length}`);

  if (result.parseErrors.length > 0) {
    console.log('Errors:');
    for (const e of result.parseErrors.slice(0, 5)) console.log(`  ${e}`);
  }

  console.log('\n=== FIRST 3 EVENTS ===');
  for (const ev of result.events.slice(0, 3)) {
    console.log(JSON.stringify(ev, null, 2));
    console.log('---');
  }

  const withDate = result.events.filter(e => e.date).length;
  const withTime = result.events.filter(e => e.time).length;
  const withVenue = result.events.filter(e => e.venue).length;
  const withUrl = result.events.filter(e => e.url).length;
  const avgConf = result.events.reduce((s, e) => s + e.confidence.score, 0) / Math.max(result.events.length, 1);

  console.log('\n=== STATS ===');
  console.log(`with date:  ${withDate}/${result.events.length}`);
  console.log(`with time:  ${withTime}/${result.events.length}`);
  console.log(`with venue: ${withVenue}/${result.events.length}`);
  console.log(`with url:   ${withUrl}/${result.events.length}`);
  console.log(`avg confidence: ${avgConf.toFixed(2)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
