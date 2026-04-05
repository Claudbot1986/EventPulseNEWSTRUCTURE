/**
 * F-eventExtraction — Core event field extraction
 *
 * This module handles extraction of structured event data from HTML sources.
 * It runs for every source regardless of path (JSON-LD, Network, HTML, or Render).
 *
 * Extracted fields:
 * - title, date, time, venue, URL, ticket URL, status
 *
 * Output feeds into G-qualityGate (moved to TEMP/ - not currently active).
 */

export { extractFromJsonLd, extractHighConfidenceEvents, extractFromHtml, toRawEventInput } from './extractor';
export type { ExtractResult } from './extractor';
export type { ParsedEvent, ExtractionConfidence } from './schema';
export {
  JsonLdEventSchema,
  JsonLdItemListSchema,
  JsonLdGraphSchema,
  JsonLdEventSeriesSchema,
  ParsedEventSchema,
  ExtractionConfidenceSchema,
} from './schema';
