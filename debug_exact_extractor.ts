
import { readFileSync } from 'fs';
import { extractFromJsonLd } from './02-Ingestion/F-eventExtraction/extractor';

const html = readFileSync('/tmp/schack.html', 'utf-8');
const result = extractFromJsonLd(html, 'schack', 'https://schack.se/evenemang');
console.log(JSON.stringify(result, null, 2));
