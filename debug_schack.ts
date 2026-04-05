
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';

// Load the HTML
const html = readFileSync('/tmp/schack.html', 'utf-8');
const $ = cheerio.load(html);

// Extract JSON-LD scripts manually
const scripts: string[] = [];
$('script[type="application/ld+json"]').each((_, el) => {
  const content = $(el).html();
  if (content) {
    scripts.push(content);
  }
});

console.log("Found", scripts.length, "JSON-LD scripts");

// Try parsing each script
for (let i = 0; i < scripts.length; i++) {
  console.log("\n=== Script", i + 1, "===");
  try {
    const data = JSON.parse(scripts[i]);
    console.log("Type:", typeof data);
    if (typeof data === 'object') {
      if (data['@type']) console.log("@type:", data['@type']);
      if (data['@graph']) console.log("@graph length:", data['@graph'].length);
      if (data.itemListElement) console.log("itemListElement length:", data.itemListElement.length);
      if (Array.isArray(data)) console.log("Array length:", data.length);
    }
    console.log("Content preview:", scripts[i].substring(0, 200));
  } catch (e: any) {
    console.log("PARSE ERROR:", e.message);
    console.log("Content preview:", scripts[i].substring(0, 200));
  }
}
