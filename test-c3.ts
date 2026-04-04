import { evaluateAiExtract } from './02-Ingestion/C-htmlGate/C3-aiExtractGate/C3-aiExtractGate';
import { fetchHtml } from './02-Ingestion/tools/fetchTools';

const url = 'https://www.berwaldhallen.se';
console.log('Testing C3 on Berwaldhallen...');

const htmlResult = await fetchHtml(url, { timeout: 15000 });
if (!htmlResult.success || !htmlResult.html) {
  console.log('Fetch failed');
  process.exit(1);
}

const c3 = await evaluateAiExtract(url, htmlResult.html);
console.log('C3 Result:', JSON.stringify(c3, null, 2));