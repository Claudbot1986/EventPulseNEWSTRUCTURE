import { extractFromApi } from './networkEventExtractor';

async function main() {
  console.log('=== TESTING NETWORK EVENT EXTRACTION ===\n');
  
  const result = await extractFromApi(
    'https://www.berwaldhallen.se/api/services/tixly/data',
    'berwaldhallen',
    { timeout: 15000 }
  );

  console.log('API URL:', result.apiUrl);
  console.log('Events extracted:', result.events.length);
  console.log('Raw items:', result.rawCount);
  console.log('Parse errors:', result.parseErrors.length);
  
  if (result.parseErrors.length > 0) {
    console.log('\nErrors:');
    result.parseErrors.forEach(e => console.log('  -', e));
  }
  
  if (result.events.length > 0) {
    console.log('\n--- First 5 events ---');
    result.events.slice(0, 5).forEach((e, i) => {
      console.log(`${i+1}. ${e.title}`);
      console.log(`   Start: ${e.startTime}`);
      console.log(`   Price: ${e.price?.min}-${e.price?.max}`);
      console.log(`   Status: ${e.status}`);
      console.log('');
    });
    
    console.log('--- Last 3 events ---');
    result.events.slice(-3).forEach((e, i) => {
      console.log(`${i+1}. ${e.title}`);
      console.log(`   Start: ${e.startTime}`);
      console.log('');
    });
  }
  
  console.log('=== TEST COMPLETE ===');
}

main().catch(console.error);
