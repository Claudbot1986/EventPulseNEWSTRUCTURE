/**
 * HTTP Fetch Tools
 *
 * Centralized fetch utilities for the ingestion pipeline.
 * All HTML/JSON fetching should go through these tools.
 */

export { fetchHtml, fetchJson, queueEvent, queueEvents } from './fetchTools';
export type { FetchResult } from './fetchTools';
