/**
 * JSON-LD Diagnostic Tool — Phase 1
 *
 * Reads a URL, extracts ALL JSON-LD blocks, lists their @types,
 * tests them against the existing extractFromJsonLd() extractor,
 * and reports WHY the result is success/no-jsonld/wrong-type.
 *
 * No HTML heuristics, no headless rendering, no E2E chain.
 * Uses only the existing extractor.ts implementation.
 *
 * Usage:
 *   npx tsx src/jsonLdDiagnostic.ts <url>
 *   npx tsx src/jsonLdDiagnostic.ts --batch <urls.txt>
 *   npx tsx src/jsonLdDiagnostic.ts --file <html-file>
 */

import { fetchHtml } from '../../02-Ingestion/tools/fetchTools';
import { extractFromJsonLd } from '../../02-Ingestion/F-eventExtraction/extractor';
import { checkUrlSanity } from '../../00-ScoutingEvidence/scouting/urlSanity';
import { load } from 'cheerio';

// ─── Types ─────────────────────────────────────────────────────────────────

type Diagnosis = 'success' | 'no-jsonld' | 'wrong-type' | 'fetch-failed' | 'parse-error' | 'unknown';

interface JsonLdBlock {
  index: number;
  '@type': string | string[] | null;
  '@context'?: string;
  sizeBytes: number;
  rawPreview: string;
}

interface DiagnosticResult {
  url: string;
  diagnosis: Diagnosis;
  reason: string; // WHY this diagnosis
  htmlSize?: number;
  jsonLdBlocks: JsonLdBlock[];
  foundTypes: string[];
  extractorResult: {
    rawCount: number;
    eventsExtracted: number;
    parseErrors: string[];
  };
  blockDiagnoses: Array<{
    index: number;
    '@type': string[];
    isEvent: boolean;
    extractorPath: string; // which extraction path was used
    blockResult: 'success' | 'skipped' | 'no-match';
  }>;
}

// ─── Extract all JSON-LD blocks from HTML ────────────────────────────────────

function extractAllJsonLd(html: string): JsonLdBlock[] {
  const results: JsonLdBlock[] = [];
  const $ = load(html);
  let index = 0;

  $('script[type="application/ld+json"]').each((_: any, el: any) => {
    try {
      const content = $(el).html() || '';
      const parsed = JSON.parse(content);
      const type = parsed['@type'] ?? null;
      const types = Array.isArray(type) ? type : type ? [type] : [];

      results.push({
        index: index++,
        '@type': type,
        '@context': parsed['@context'],
        sizeBytes: content.length,
        rawPreview: content.substring(0, 200).replace(/\s+/g, ' '),
      });
    } catch {
      // skip malformed
    }
  });

  return results;
}

// ─── Diagnose a single block ────────────────────────────────────────────────

function diagnoseBlock(block: JsonLdBlock, extractor: any): {
  isEvent: boolean;
  extractorPath: string;
  blockResult: 'success' | 'skipped' | 'no-match';
} {
  const types = Array.isArray(block['@type']) ? block['@type'] : block['@type'] ? [block['@type']] : [];

  // Check if any type is Event
  const isEvent = types.some((t: string) =>
    t === 'Event' || t === 'MusicEvent' || t === 'SportsEvent' || t === 'TheaterEvent' || t?.includes('Event')
  );

  if (isEvent) {
    return { isEvent: true, extractorPath: 'JsonLdEventSchema', blockResult: 'success' };
  }

  // Classify by container type
  if (types.includes('ItemList')) {
    return { isEvent: false, extractorPath: 'JsonLdItemListSchema', blockResult: 'skipped' };
  }
  if (types.includes('WebSite')) {
    return { isEvent: false, extractorPath: 'JsonLdWebsiteSchema', blockResult: 'skipped' };
  }
  if (types.includes('WebPage')) {
    return { isEvent: false, extractorPath: 'JsonLdWebPageSchema', blockResult: 'skipped' };
  }
  if (types.includes('Organization')) {
    return { isEvent: false, extractorPath: 'JsonLdOrganizationSchema', blockResult: 'skipped' };
  }
  if (types.includes('BreadcrumbList')) {
    return { isEvent: false, extractorPath: 'BreadcrumbList', blockResult: 'skipped' };
  }
  if (types.includes('EventSeries')) {
    return { isEvent: false, extractorPath: 'JsonLdEventSeriesSchema', blockResult: 'skipped' };
  }
  if (types.includes('Place')) {
    return { isEvent: false, extractorPath: 'PlaceSchema', blockResult: 'skipped' };
  }
  if (types.includes('CollectionPage') || types.includes('ListPage')) {
    return { isEvent: false, extractorPath: 'CollectionPage', blockResult: 'skipped' };
  }
  if (types.includes('@graph')) {
    return { isEvent: false, extractorPath: '@graph', blockResult: 'skipped' };
  }

  return { isEvent: false, extractorPath: 'unknown', blockResult: 'no-match' };
}

export { diagnoseUrl, type DiagnosticResult };

// ─── Main diagnostic function ──────────────────────────────────────────────

async function diagnoseUrl(url: string): Promise<DiagnosticResult> {
  // Step 0: Use urlSanity to follow redirects and get final URL
  const sanity = await checkUrlSanity(url);
  const fetchUrl = sanity.finalUrl ?? url;

  // Step 1: Fetch
  const fetchResult = await fetchHtml(fetchUrl, { timeout: 15000 });

  if (!fetchResult.success || !fetchResult.html) {
    return {
      url,
      diagnosis: 'fetch-failed',
      reason: `HTTP ${fetchResult.statusCode ?? 'unknown'}: ${fetchResult.error ?? 'no response'}`,
      jsonLdBlocks: [],
      foundTypes: [],
      extractorResult: { rawCount: 0, eventsExtracted: 0, parseErrors: [] },
      blockDiagnoses: [],
    };
  }

  if (fetchResult.html.length < 200) {
    return {
      url,
      diagnosis: 'fetch-failed',
      reason: `HTML too small (${fetchResult.html.length} bytes) — likely JS-rendered or empty page`,
      htmlSize: fetchResult.html.length,
      jsonLdBlocks: [],
      foundTypes: [],
      extractorResult: { rawCount: 0, eventsExtracted: 0, parseErrors: [] },
      blockDiagnoses: [],
    };
  }

  // Step 2: Extract all JSON-LD blocks
  const blocks = extractAllJsonLd(fetchResult.html);

  if (blocks.length === 0) {
    return {
      url,
      diagnosis: 'no-jsonld',
      reason: 'No <script type="application/ld+json"> tags found in HTML. Page has no structured data at all.',
      htmlSize: fetchResult.html.length,
      jsonLdBlocks: [],
      foundTypes: [],
      extractorResult: { rawCount: 0, eventsExtracted: 0, parseErrors: [] },
      blockDiagnoses: [],
    };
  }

  // Step 3: Collect all found types
  const allTypes = new Set<string>();
  for (const block of blocks) {
    const types = Array.isArray(block['@type']) ? block['@type'] : block['@type'] ? [block['@type']] : [];
    for (const t of types) allTypes.add(t as string);
    // Also check nested @graph items
    try {
      const $ = load(fetchResult.html);
      const scripts = $('script[type="application/ld+json"]');
      // Already extracted above, skip
    } catch {}
  }

  // Step 4: Run extractor
  const extractResult = extractFromJsonLd(fetchResult.html, 'diagnostic', url);

  // Step 5: Diagnose each block
  const blockDiagnoses = blocks.map(block => {
    return diagnoseBlock(block, extractResult);
  });

  // Step 6: Determine overall diagnosis and reason
  let diagnosis: Diagnosis;
  let reason: string;

  const eventBlocks = blockDiagnoses.filter(d => d.isEvent);
  const eventSchemaBlocks = blockDiagnoses.filter(d => d.extractorPath === 'JsonLdEventSchema');
  const containerBlocks = blockDiagnoses.filter(d => d.blockResult === 'skipped');
  const noMatchBlocks = blockDiagnoses.filter(d => d.blockResult === 'no-match');

  if (extractResult.events.length > 0) {
    diagnosis = 'success';
    reason = `Found ${extractResult.events.length} Event objects via ${extractResult.events.length === eventSchemaBlocks.length ? 'direct Event schema' : 'container schema'}. ` +
      `Confidence avg: ${(extractResult.events.reduce((s, e) => s + e.confidence.score, 0) / extractResult.events.length).toFixed(2)}`;
  } else if (blocks.length === 0) {
    diagnosis = 'no-jsonld';
    reason = 'No JSON-LD scripts in HTML.';
  } else if (eventBlocks.length === 0 && containerBlocks.length > 0) {
    diagnosis = 'wrong-type';
    const containerTypes = [...new Set(containerBlocks.map(d => d.extractorPath))];
    reason = `Found ${blocks.length} JSON-LD block(s) but none are Event type. ` +
      `Found types: [${[...allTypes].join(', ')}]. ` +
      `This page uses ${containerTypes.join(', ')} — no events on this URL. ` +
      `Try individual event detail pages which may have Event JSON-LD.`;
  } else if (eventBlocks.length > 0 && extractResult.events.length === 0) {
    diagnosis = 'wrong-type';
    reason = `Found ${eventBlocks.length} block(s) with Event type but extractor produced 0 events. ` +
      `Likely schema validation failed — check event dates or required fields.`;
  } else {
    diagnosis = 'wrong-type';
    reason = `Found ${blocks.length} JSON-LD block(s) with types [${[...allTypes].join(', ')}] ` +
      `but none produced events. No JSON-LD Event structure found on this page.`;
  }

  return {
    url,
    diagnosis,
    reason,
    htmlSize: fetchResult.html.length,
    jsonLdBlocks: blocks,
    foundTypes: [...allTypes],
    extractorResult: {
      rawCount: extractResult.rawCount,
      eventsExtracted: extractResult.events.length,
      parseErrors: extractResult.parseErrors,
    },
    blockDiagnoses,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  npx tsx src/jsonLdDiagnostic.ts <url>');
    console.error('  npx tsx src/jsonLdDiagnostic.ts --batch <urls.txt>');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/jsonLdDiagnostic.ts https://www.konserthuset.se');
    console.error('  npx tsx src/jsonLdDiagnostic.ts --batch sources.txt');
    process.exit(1);
  }

  if (args[0] === '--batch') {
    const fs = await import('fs');
    const urls = fs.readFileSync(args[1], 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    console.log(`═══ BATCH: ${urls.length} URLs ═══\n`);
    const results: DiagnosticResult[] = [];

    for (const url of urls) {
      process.stdout.write(`[${results.length + 1}/${urls.length}] ${url} ... `);
      const r = await diagnoseUrl(url);
      results.push(r);
      const icon = r.diagnosis === 'success' ? '✅' : r.diagnosis === 'no-jsonld' ? '📭' : r.diagnosis === 'wrong-type' ? '🏷️' : '❌';
      console.log(`${icon} ${r.diagnosis}`);
      if (r.diagnosis === 'success') {
        console.log(`        → ${r.extractorResult.eventsExtracted} events, ${r.reason.substring(0, 80)}`);
      } else {
        console.log(`        → ${r.reason.substring(0, 80)}`);
      }
    }

    // Summary
    console.log('\n═══ SUMMARY ═══');
    const byDiag = new Map<string, number>();
    for (const r of results) byDiag.set(r.diagnosis, (byDiag.get(r.diagnosis) || 0) + 1);
    for (const [d, n] of byDiag) console.log(`  ${d}: ${n}`);

    // Full report table
    console.log('\n═══ FULL REPORT ═══');
    console.log('| URL | Diagnosis | Types found | Events | Reason (truncated) |');
    console.log('|-----|-----------|-------------|--------|-------------------|');
    for (const r of results) {
      const icon = r.diagnosis === 'success' ? '✅' : r.diagnosis === 'no-jsonld' ? '📭' : r.diagnosis === 'wrong-type' ? '🏷️' : '❌';
      console.log(`| ${r.url.replace('https://', '')} | ${icon} ${r.diagnosis} | ${r.foundTypes.slice(0, 3).join(', ')} | ${r.extractorResult.eventsExtracted} | ${r.reason.substring(0, 60)}... |`);
    }
    return;
  }

  // Single URL
  const url = args[0];
  console.log(`═══ JSON-LD DIAGNOSTIC ═══`);
  console.log(`URL: ${url}\n`);

  const result = await diagnoseUrl(url);

  console.log(`Diagnosis: ${result.diagnosis}`);
  console.log(`Reason:     ${result.reason}`);
  if (result.htmlSize !== undefined) console.log(`HTML size:  ${result.htmlSize.toLocaleString()} bytes`);
  console.log();

  console.log(`─── JSON-LD Blocks (${result.jsonLdBlocks.length}) ───`);
  for (const block of result.jsonLdBlocks) {
    const types = Array.isArray(block['@type']) ? block['@type'] : block['@type'] ? [block['@type']] : [];
    const bd = result.blockDiagnoses[block.index];
    console.log(`  [${block.index}] @type: [${types.join(', ')}]`);
    console.log(`       size: ${block.sizeBytes} bytes`);
    console.log(`       → ${bd?.isEvent ? '✅ is Event' : `🏷️ ${bd?.extractorPath ?? 'unknown'}`} (${bd?.blockResult})`);
    console.log(`       preview: ${block.rawPreview}...`);
  }

  console.log();
  console.log(`─── Extractor Result ───`);
  console.log(`  rawCount:        ${result.extractorResult.rawCount}`);
  console.log(`  eventsExtracted: ${result.extractorResult.eventsExtracted}`);
  if (result.extractorResult.parseErrors.length > 0) {
    console.log(`  parseErrors:     ${result.extractorResult.parseErrors.join('; ')}`);
  }

  console.log();
  console.log(`─── All @types Found ───`);
  console.log(`  [${result.foundTypes.join(', ')}]`);
}

main().catch(console.error);
