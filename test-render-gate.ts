import { renderPage } from './02-Ingestion/D-renderGate/renderGate';

async function testRender(sourceId: string, url: string) {
  console.log(`Testing D-renderGate on ${sourceId}...`);
  console.log(`URL: ${url}`);
  
  const result = await renderPage(url, { timeout: 25000 });
  
  console.log('---');
  console.log('Success:', result.success);
  console.log('Error:', result.error || 'none');
  console.log('HTML length:', result.html?.length || 0);
  console.log('Render time:', result.metrics?.renderTimeMs, 'ms');
  
  if (result.html) {
    const hasEventContent = result.html.includes('kalender') || 
                            result.html.includes('event') || 
                            result.html.includes('evenemang');
    console.log('Has event content:', hasEventContent);
  }
  
  return result;
}

// Test bor-s-zoo-animagic
await testRender('bor-s-zoo-animagic', 'https://www.animagic.se');
