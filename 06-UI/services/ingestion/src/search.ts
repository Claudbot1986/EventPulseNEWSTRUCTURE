import 'dotenv/config';
import { MeiliSearch, type Document } from 'meilisearch';

const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST ?? '';
const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY ?? '';

// Lazy-initialize client only when needed, validating host URL format
let _client: MeiliSearch | null = null;

function getClient(): MeiliSearch {
  if (!_client) {
    if (!MEILISEARCH_HOST) {
      throw new Error('MEILISEARCH_HOST environment variable is required');
    }
    try {
      new URL(MEILISEARCH_HOST); // Validate URL format
    } catch {
      throw new Error(`Invalid MEILISEARCH_HOST URL: ${MEILISEARCH_HOST}`);
    }
    _client = new MeiliSearch({
      host: MEILISEARCH_HOST,
      apiKey: MEILISEARCH_API_KEY || undefined,
    });
  }
  return _client;
}

export { getClient };

const INDEX_NAME = process.env.MEILISEARCH_INDEX ?? 'events';

/** Fields indexed in Meilisearch for event search */
export interface EventDocument extends Document {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  venue_name: string | null;
  city: string;
  categories: string[];
}

/** Check if Meilisearch is configured and available */
export function isMeilisearchConfigured(): boolean {
  if (!MEILISEARCH_HOST) {
    return false;
  }
  try {
    new URL(MEILISEARCH_HOST);
    return true;
  } catch {
    return false;
  }
}

/** Initialize the events index with searchable/filterable attributes */
export async function initSearchIndex(): Promise<boolean> {
  if (!isMeilisearchConfigured()) {
    console.warn('[search] MEILISEARCH_HOST not configured, skipping index initialization');
    return false;
  }

  const index = getClient().index(INDEX_NAME);

  await index.updateSettings({
    searchableAttributes: ['title', 'description', 'venue_name', 'categories'],
    filterableAttributes: ['categories', 'city', 'start_time'],
    sortableAttributes: ['start_time'],
  });

  console.log('[search] Index settings configured');
  return true;
}

/** Upsert a single event document */
export async function upsertEvent(doc: EventDocument): Promise<void> {
  if (!isMeilisearchConfigured()) {
    return;
  }
  const index = getClient().index(INDEX_NAME);
  await index.addDocuments([doc]);
}

/** Delete a single event document */
export async function deleteEvent(eventId: string): Promise<void> {
  if (!isMeilisearchConfigured()) {
    return;
  }
  const index = getClient().index(INDEX_NAME);
  await index.deleteDocument(eventId);
}

export { INDEX_NAME };
