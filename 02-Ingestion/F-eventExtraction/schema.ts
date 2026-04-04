/**
 * Zod schemas for JSON-LD structured data extraction
 * Supports: ItemList, @graph, EventSeries, and direct Event arrays
 * Based on real schema.org/Event vocabulary
 */

import { z } from 'zod';

// ─── JSON-LD Primitives ───────────────────────────────────────────────────────

export const JsonLdString = z.string().optional();
export const JsonLdUrl = z.string().url().optional();

export const PostalAddressSchema = z.object({
  '@type': z.literal('PostalAddress').optional(),
  streetAddress: JsonLdString,
  addressLocality: JsonLdString,
  postalCode: JsonLdString,
  addressCountry: JsonLdString.optional(),
});

export const PlaceSchema = z.object({
  '@type': z.literal('Place').optional(),
  name: JsonLdString,
  address: z.union([PostalAddressSchema, JsonLdString]).optional(),
  url: JsonLdUrl.optional(),
});

export const OrganizationSchema = z.object({
  '@type': z.union([z.literal('Organization'), z.literal('PerformingGroup')]).optional(),
  name: JsonLdString,
  url: JsonLdUrl.optional(),
});

export const PersonSchema = z.object({
  '@type': z.literal('Person').optional(),
  name: JsonLdString,
});

export const PerformerSchema = z.union([
  OrganizationSchema,
  PersonSchema,
  z.object({ name: JsonLdString }), // fallback
]);

export const OfferSchema = z.object({
  '@type': z.literal('Offer').optional(),
  price: JsonLdString,
  priceCurrency: z.string().default('SEK'),
  availability: JsonLdUrl.optional(),
  url: JsonLdUrl.optional(),
});

// ─── Core Event Schema ────────────────────────────────────────────────────────

export const JsonLdEventSchema = z.object({
  '@type': z.union([z.literal('Event'), z.string()]).optional(),
  '@id': JsonLdString,
  name: JsonLdString,
  description: JsonLdString.optional(),
  url: JsonLdUrl.or(z.string()).optional(), // allow relative URLs
  startDate: JsonLdString,
  endDate: JsonLdString.optional(),
  location: z.union([PlaceSchema, JsonLdString, z.object({ name: JsonLdString })]).optional(),
  organizer: OrganizationSchema.optional(),
  performer: z.union([PerformerSchema, z.array(PerformerSchema)]).optional(),
  eventStatus: JsonLdUrl.optional(),
  eventAttendanceMode: JsonLdUrl.optional(),
  offers: z.union([OfferSchema, z.array(OfferSchema)]).optional(),
  image: z.union([JsonLdString, JsonLdUrl]).optional(),
  inLanguage: JsonLdString.optional(),
});

export type JsonLdEvent = z.infer<typeof JsonLdEventSchema>;

// ─── Container Schemas ────────────────────────────────────────────────────────

export const JsonLdListItemSchema = z.object({
  '@type': z.literal('ListItem').optional(),
  position: z.number().optional(),
  item: JsonLdEventSchema.optional(),
  url: JsonLdUrl.optional(),
});

export const JsonLdItemListSchema = z.object({
  '@context': z.string().optional(),
  '@type': z.literal('ItemList'),
  itemListElement: z.union([z.array(JsonLdListItemSchema), z.array(JsonLdEventSchema)]),
});

export const JsonLdGraphSchema = z.object({
  '@context': z.string().optional(),
  '@graph': z.array(JsonLdEventSchema),
});

export const JsonLdEventSeriesSchema = z.object({
  '@context': z.string().optional(),
  '@type': z.literal('EventSeries'),
  name: JsonLdString,
  description: JsonLdString.optional(),
  url: JsonLdUrl.optional(),
  subEvent: z.union([z.array(JsonLdEventSchema), JsonLdEventSchema]).optional(),
});

export const JsonLdWebsiteSchema = z.object({
  '@type': z.literal('WebSite'),
  '@id': JsonLdString,
  url: JsonLdUrl,
  name: JsonLdString,
});

export const JsonLdWebPageSchema = z.object({
  '@type': z.literal('WebPage'),
  '@id': JsonLdString,
  url: JsonLdUrl,
  name: JsonLdString,
  description: JsonLdString.optional(),
});

export const JsonLdOrganizationSchema = z.object({
  '@type': z.literal('Organization'),
  '@id': JsonLdString,
  name: JsonLdString,
  url: JsonLdUrl.optional(),
});

// ─── Extraction Confidence ───────────────────────────────────────────────────

export const ExtractionConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  hasTitle: z.boolean(),
  hasDate: z.boolean(),
  hasVenue: z.boolean(),
  hasUrl: z.boolean(),
  hasDescription: z.boolean(),
  hasTicketInfo: z.boolean(),
  eventStatus: z.string().optional(),
  signals: z.array(z.string()),
});

export type ExtractionConfidence = z.infer<typeof ExtractionConfidenceSchema>;

// ─── Parsed Event Output ─────────────────────────────────────────────────────

export const ParsedEventSchema = z.object({
  title: z.string(),
  date: z.string(), // YYYY-MM-DD
  time: z.string().optional(), // HH:MM
  endDate: z.string().optional(),
  endTime: z.string().optional(),
  venue: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  ticketUrl: z.string().optional(),
  organizer: z.string().optional(),
  performers: z.array(z.string()).optional(),
  category: z.string().optional(),
  isFree: z.boolean().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  imageUrl: z.string().optional(),
  status: z.string().optional(),
  source: z.string(),
  sourceUrl: z.string().optional(),
  confidence: ExtractionConfidenceSchema,
});

export type ParsedEvent = z.infer<typeof ParsedEventSchema>;

// ─── Union Parser ─────────────────────────────────────────────────────────────

export const AnyJsonLdSchema = z.union([
  JsonLdEventSchema,
  JsonLdItemListSchema,
  JsonLdGraphSchema,
  JsonLdEventSeriesSchema,
  z.array(JsonLdEventSchema),
  z.object({ '@type': z.string() }), // catch-all for unknown structures
]);

export type AnyJsonLd = z.infer<typeof AnyJsonLdSchema>;
