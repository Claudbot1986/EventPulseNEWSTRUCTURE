import { screenUrl } from './C1-preHtmlGate/C1-preHtmlGate.js';

async function main() {
  console.log('Testing JS-rendered detection...\n');

  const tests = [
    'https://jarfalla.se/evenemang',
    'https://malmo.se/',
    'https://konserthuset.se/program-och-biljetter/kalender',
  ];

  for (const url of tests) {
    try {
      const r = await screenUrl(url);
      console.log(`${url}`);
      console.log(`  likelyJsRendered: ${r.likelyJsRendered}`);
      console.log(`  reason: ${r.reason}`);
      console.log(`  categorization: ${r.categorization}`);
      console.log('');
    } catch (e) {
      console.log(`${url} -> ERROR: ${(e as Error).message}`);
    }
  }
}

main().catch(console.error);