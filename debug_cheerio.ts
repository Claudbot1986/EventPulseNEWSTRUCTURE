
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';

const html = readFileSync('/tmp/schack.html', 'utf-8');
const $ = cheerio.load(html);

// Replicate extractFromJsonLd EXACTLY
function extractJsonLdScripts(html: string): any[] {
  const results: any[] = [];
  try {
    const $ = cheerio.load(html);
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $(el).html();
        console.log("Cheerio html() for script:", content ? content.substring(0, 50) + "..." : "NULL/EMPTY");
        if (content) {
          const data = JSON.parse(content);
          results.push(data);
        }
      } catch (e: any) {
        console.log("Parse error:", e.message);
      }
    });
  } catch (e: any) {
    console.log("Load error:", e.message);
  }
  return results;
}

const scripts = extractJsonLdScripts(html);
console.log("\nTotal scripts extracted:", scripts.length);

for (let i = 0; i < scripts.length; i++) {
  console.log("\nScript", i + 1, "type:", typeof scripts[i]);
  if (Array.isArray(scripts[i])) {
    console.log("  Is array with", scripts[i].length, "items");
    console.log("  First item @type:", scripts[i][0]?.['@type']);
  } else if (typeof scripts[i] === 'object') {
    console.log("  Is object with keys:", Object.keys(scripts[i]).join(', '));
    if (scripts[i]['@graph']) {
      console.log("  @graph length:", scripts[i]['@graph'].length);
      if (scripts[i]['@graph'].length > 0) {
        console.log("  First @graph item @type:", scripts[i]['@graph'][0]['@type']);
      }
    }
  }
}
