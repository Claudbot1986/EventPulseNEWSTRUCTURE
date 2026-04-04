import { evaluateAiExtract } from './02-Ingestion/C-htmlGate/C3-aiExtractGate/C3-aiExtractGate';
import { fetchHtml } from './02-Ingestion/tools/fetchTools';

const url = 'https://www.berwaldhallen.se';
console.log('Testing C3 with MiniMax on Berwaldhallen...');

const htmlResult = await fetchHtml(url, { timeout: 15000 });
if (!htmlResult.success || !htmlResult.html) {
  console.log('Fetch failed');
  process.exit(1);
}

const c3 = await evaluateAiExtract(url, htmlResult.html, { useAi: true });
console.log('C3 Result:');
console.log('Verdict:', c3.verdict);
console.log('Events found:', c3.events.length);
console.log('Scopes found:', c3.scopes.length);
console.log('Reasoning:', c3.reasoning.substring(0, 200));
if (c3.events.length > 0) {
  console.log('\nFirst event:', JSON.stringify(c3.events[0], null, 2));
}