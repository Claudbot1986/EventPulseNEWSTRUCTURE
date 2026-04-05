
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';

// Load the HTML
const html = readFileSync('/tmp/schack.html', 'utf-8');
const $ = cheerio.load(html);

// Simulate extractFromJsonLd logic exactly
function extractJsonLdScripts(html: string): any[] {
  const results: any[] = [];
  try {
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $(el).html();
        if (content) {
          const data = JSON.parse(content);
          results.push(data);
        }
      } catch {
        // Skip malformed JSON
      }
    });
  } catch {
    // Skip parse errors
  }
  return results;
}

function extractFromArray(data: any[], source: string): any[] {
  const events: any[] = [];
  for (const item of data) {
    if (item['@type'] === 'Event') {
      events.push(item);
    }
  }
  return events;
}

const jsonLdScripts = extractJsonLdScripts(html);
console.log("Found", jsonLdScripts.length, "JSON-LD scripts");

let totalExtracted = 0;
for (let i = 0; i < jsonLdScripts.length; i++) {
  const data = jsonLdScripts[i];
  
  if (Array.isArray(data)) {
    const arrayEvents = extractFromArray(data, 'schack');
    console.log("Script", i + 1, "- Array - extractFromArray found", arrayEvents.length, "events");
    totalExtracted += arrayEvents.length;
  } else if (typeof data === 'object' && data !== null) {
    if (data['@graph'] && Array.isArray(data['@graph'])) {
      let graphEvents = 0;
      for (const item of data['@graph']) {
        if (item['@type'] === 'Event') graphEvents++;
      }
      console.log("Script", i + 1, "- @graph - found", graphEvents, "events");
    }
  }
}

console.log("\nTotal extracted from JSON-LD:", totalExtracted);
