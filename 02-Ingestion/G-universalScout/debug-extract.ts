import { fetchHtml } from '../tools/fetchTools.js';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor.js';

async function main() {
  const r = await fetchHtml('https://jarfalla.se/evenemang', { timeout: 20000 });
  console.log('HTML length:', r.html?.length);
  console.log('Has AppRegistry:', r.html?.includes('AppRegistry.registerInitialState'));
  console.log('Has events string:', r.html?.includes('"events"'));
  
  if (r.html) {
    // Find AppRegistry pattern
    const idx = r.html.indexOf('AppRegistry.registerInitialState');
    if (idx >= 0) {
      console.log('\nAppRegistry context:', r.html.slice(idx, idx + 500));
    }
    
    const ex = extractFromHtml(r.html, 'test', 'https://jarfalla.se/evenemang');
    console.log('\nEvents:', ex.events.length);
    console.log('Methods:', ex.methodsUsed);
    console.log('Errors:', ex.parseErrors);
    console.log('Method breakdown:', ex.methodBreakdown);
  }
}

main().catch(console.error);
