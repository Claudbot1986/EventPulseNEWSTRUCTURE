
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

const jsonLdScripts = extractJsonLdScripts(html);
console.log("Found", jsonLdScripts.length, "JSON-LD scripts");

for (let i = 0; i < jsonLdScripts.length; i++) {
  const data = jsonLdScripts[i];
  console.log("\n=== Script", i + 1, "===");
  
  // Try as array
  if (Array.isArray(data)) {
    console.log("Is array with", data.length, "items");
    let eventCount = 0;
    for (const item of data) {
      if (item['@type'] === 'Event') {
        eventCount++;
        if (eventCount <= 3) {
          console.log("  Event", eventCount, ":", item.name, "|", item.startDate);
        }
      }
    }
    console.log("Total @type==Event:", eventCount);
  } else if (typeof data === 'object' && data !== null) {
    console.log("Is object with keys:", Object.keys(data).join(', '));
    if (data['@graph']) {
      console.log("@graph length:", data['@graph'].length);
      let eventCount = 0;
      for (const item of data['@graph']) {
        if (item['@type'] === 'Event') {
          eventCount++;
          if (eventCount <= 3) {
            console.log("  Event", eventCount, ":", item.name, "|", item.startDate);
          }
        }
      }
      console.log("Total @type==Event in @graph:", eventCount);
    }
  }
}
