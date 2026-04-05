
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';

const html = readFileSync('/tmp/schack.html', 'utf-8');
const $ = cheerio.load(html);

// Replicate extractFromJsonLd EXACTLY with logging
const scripts: any[] = [];
$('script[type="application/ld+json"]').each((_, el) => {
  try {
    const content = $(el).html();
    console.log("Raw content length:", content?.length);
    console.log("Raw content start:", content?.substring(0, 30));
    if (content) {
      const data = JSON.parse(content);
      console.log("Parsed successfully, type:", typeof data, Array.isArray(data) ? "array" : "object");
      scripts.push(data);
    }
  } catch (e: any) {
    console.log("Parse error:", e.message);
    console.log("Content that failed:", content?.substring(0, 100));
  }
});

console.log("\nTotal scripts:", scripts.length);

// Check script 2 specifically
console.log("\nScript 2 details:");
console.log("  Is array?", Array.isArray(scripts[1]));
console.log("  Length:", scripts[1]?.length);
console.log("  First item:", JSON.stringify(scripts[1]?.[0]).substring(0, 200));

// Test Zod validation
import { z } from 'zod';
const JsonLdEventSchema = z.object({
  '@type': z.union([z.literal('Event'), z.string()]).optional(),
  name: z.string().optional(),
  startDate: z.string().optional(),
});

if (Array.isArray(scripts[1])) {
  let validCount = 0;
  for (const item of scripts[1]) {
    const result = JsonLdEventSchema.safeParse(item);
    if (result.success) validCount++;
  }
  console.log("\nZod valid events in script 2:", validCount, "out of", scripts[1].length);
  
  // Check the @type field
  let eventCount = 0;
  for (const item of scripts[1]) {
    if (item['@type'] === 'Event') eventCount++;
  }
  console.log("Items with @type === 'Event':", eventCount);
}
