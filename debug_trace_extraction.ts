
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';
import { z } from 'zod';

// Load the HTML
const html = readFileSync('/tmp/schack.html', 'utf-8');
const $ = cheerio.load(html);

// Replicate extractFromJsonLd exactly
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

// Define schema here to replicate extractor
const JsonLdEventSchema = z.object({
  '@type': z.union([z.literal('Event'), z.string()]).optional(),
  '@id': z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  url: z.union([z.string().url(), z.string()]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.union([z.object({ name: z.string() }), z.string()]).optional(),
});

function extractFromArray(data: any[], source: string): any[] {
  const events: any[] = [];
  for (const item of data) {
    if (item['@type'] === 'Event') {
      const event = JsonLdEventSchema.safeParse(item);
      if (event.success) {
        events.push(event.data);
      }
    }
  }
  return events;
}

function extractFromGraph(data: any, source: string): any[] {
  const events: any[] = [];
  if (!data['@graph']) return events;
  for (const item of data['@graph']) {
    if (item['@type'] === 'Event') {
      const event = JsonLdEventSchema.safeParse(item);
      if (event.success) events.push(event.data);
    }
  }
  return events;
}

let totalRawCount = 0;
let totalEvents = 0;

for (let i = 0; i < jsonLdScripts.length; i++) {
  const data = jsonLdScripts[i];
  console.log("\n=== Script", i + 1, "===");
  
  // Try as array
  if (Array.isArray(data)) {
    console.log("Type: array with", data.length, "items");
    const arrayEvents = extractFromArray(data, 'schack');
    console.log("extractFromArray found:", arrayEvents.length, "valid events");
    totalRawCount += data.length;
    totalEvents += arrayEvents.length;
    
    // Show first few
    for (let j = 0; j < Math.min(3, data.length); j++) {
      if (data[j]['@type'] === 'Event') {
        console.log("  Item", j, ":", data[j].name, "| startDate:", data[j].startDate);
      }
    }
  } else if (typeof data === 'object' && data !== null) {
    console.log("Type: object with keys:", Object.keys(data).join(', '));
    
    // Try @graph
    if (data['@graph']) {
      const graphEvents = extractFromGraph(data, 'schack');
      console.log("extractFromGraph found:", graphEvents.length, "valid events");
    }
  }
}

console.log("\n=== SUMMARY ===");
console.log("Total raw count:", totalRawCount);
console.log("Total valid events:", totalEvents);
