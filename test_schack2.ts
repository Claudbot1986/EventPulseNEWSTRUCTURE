
import { extractFromHtml } from './02-Ingestion/F-eventExtraction/extractor';
import { readFileSync } from 'fs';

async function test() {
  const html = readFileSync('/tmp/schack.html', 'utf-8');
  const result = await extractFromHtml(html, 'https://schack.se/evenemang');
  console.log(JSON.stringify(result, null, 2));
}

test();
