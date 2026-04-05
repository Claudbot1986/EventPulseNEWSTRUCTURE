
import { readFileSync } from 'fs';
import * as cheerio from 'cheerio';
import { z } from 'zod';

// Replicate extractor.ts exactly
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

// Schemas from schema.ts
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

const JsonLdItemListSchema = z.object({
  '@context': z.string().optional(),
  '@type': z.literal('ItemList'),
  itemListElement: z.union([z.array(z.any()), z.array(z.any())]),
});

const JsonLdGraphSchema = z.object({
  '@context': z.string().optional(),
  '@graph': z.array(JsonLdEventSchema),
});

function extractFromItemList(data: any, source: string): any[] {
  const events: any[] = [];
  const parsed = JsonLdItemListSchema.safeParse(data);
  console.log("  extractFromItemList safeParse success:", parsed.success);
  if (!parsed.success) return events;
  console.log("  ItemListSchema matched!");
  return events;
}

function extractFromGraph(data: any, source: string): any[] {
  const events: any[] = [];
  const parsed = JsonLdGraphSchema.safeParse(data);
  console.log("  extractFromGraph safeParse success:", parsed.success);
  if (!parsed.success) {
    console.log("  Graph safeParse error:", JSON.stringify(parsed.error));
    return events;
  }
  for (const item of parsed.data['@graph']) {
    if (item['@type'] === 'Event' || item['@type'] === 'EventSeries') {
      if (item['@type'] === 'Event') {
        const event = JsonLdEventSchema.safeParse(item);
        if (event.success) events.push(event.data);
      }
    }
  }
  return events;
}

function extractFromArray(data: any[], source: string): any[] {
  const events: any[] = [];
  console.log("  extractFromArray called with", data.length, "items");
  for (const item of data) {
    if (item['@type'] === 'Event') {
      const event = JsonLdEventSchema.safeParse(item);
      if (event.success) events.push(event.data);
    }
  }
  console.log("  extractFromArray found", events.length, "valid events");
  return events;
}

function extractSingleEvent(data: any, source: string): any | null {
  if (data['@type'] !== 'Event') return null;
  const event = JsonLdEventSchema.safeParse(data);
  if (event.success) return event.data;
  return null;
}

// Main function
function extractFromJsonLd(html: string, source: string, sourceUrl?: string): any {
  const events: any[] = [];
  const parseErrors: string[] = [];
  const seenKeys = new Set<string>();
  const jsonLdScripts = extractJsonLdScripts(html);
  let rawCount = 0;

  console.log("Total JSON-LD scripts:", jsonLdScripts.length);

  for (let i = 0; i < jsonLdScripts.length; i++) {
    const data = jsonLdScripts[i];
    console.log("\n=== Processing Script", i + 1, "===");
    console.log("  typeof data:", typeof data);
    console.log("  Array.isArray:", Array.isArray(data));
    
    try {
      // Try ItemList
      const itemListEvents = extractFromItemList(data, source);
      console.log("  ItemList events:", itemListEvents.length);

      // Try @graph
      const graphEvents = extractFromGraph(data, source);
      console.log("  Graph events:", graphEvents.length);
      for (const event of graphEvents) {
        rawCount++;
        const parsed = JsonLdEventSchema.safeParse(event);
        if (parsed.success) events.push(parsed.data);
      }

      // Try direct array
      if (Array.isArray(data)) {
        console.log("  Calling extractFromArray...");
        const arrayEvents = extractFromArray(data, source);
        console.log("  Array events:", arrayEvents.length);
        for (const event of arrayEvents) {
          rawCount++;
          const parsed = JsonLdEventSchema.safeParse(event);
          if (parsed.success) events.push(parsed.data);
        }
      }

      // Try single Event
      const single = extractSingleEvent(data, source);
      if (single) {
        console.log("  Single Event found!");
        rawCount++;
        const parsed = JsonLdEventSchema.safeParse(single);
        if (parsed.success) events.push(parsed.data);
      }
    } catch (e: any) {
      parseErrors.push(`JSON-LD parse error: ${e.message}`);
    }
  }

  console.log("\n=== FINAL ===");
  console.log("rawCount:", rawCount);
  console.log("events:", events.length);
  return { events, rawCount, parseErrors };
}

const html = readFileSync('/tmp/schack.html', 'utf-8');
const result = extractFromJsonLd(html, 'schack', 'https://schack.se/evenemang');
console.log("\nResult:", JSON.stringify(result, null, 2));
