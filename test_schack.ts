
import { extractFromHtml } from './02-Ingestion/F-eventExtraction/extractor';
import { fetch } from 'undici';

async function test() {
  const html = await fetch('https://schack.se/evenemang').then(r => r.text());
  const result = await extractFromHtml(html, 'https://schack.se/evenemang');
  console.log(JSON.stringify(result, null, 2));
}

test();
