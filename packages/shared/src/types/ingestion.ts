import type { UUID, ISODateString } from './events';

/** Configuration record for each data source */
export interface EventSource {
  id: UUID;
  name: string;
  type: 'scraper' | 'api' | 'rss' | 'organizer_portal';
  base_url: string | null;
  active: boolean;
  last_run_at: ISODateString | null;
  config: Record<string, unknown>;
  created_at: ISODateString;
}

/**
 * Raw input from a scraper or organizer form.
 * Validated at the API boundary before normalization.
 */
export interface RawEventInput {
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  lat: number | null;
  lng: number | null;
  categories: string[];
  is_free: boolean;
  price_min_sek: number | null;
  price_max_sek: number | null;
  ticket_url: string | null;
  image_url: string | null;
  source: string;
  source_id: string | null;
  detected_language: 'sv' | 'en' | 'other' | null;
  raw_payload: Record<string, unknown>;
}

/** Output of the normalizer worker — ready for DB insert */
export interface NormalizedEvent extends Omit<RawEventInput, 'raw_payload'> {
  title_sv: string | null;
  title_en: string;
  description_sv: string | null;
  description_en: string | null;
  start_time: ISODateString;
  end_time: ISODateString | null;
  venue_id: UUID | null;
  lat: number;
  lng: number;
  category_ids: UUID[];
  /** Cloudflare R2 URL after image download */
  image_r2_url: string | null;
  dedup_hash: string;
  is_update: boolean;
  existing_event_id: UUID | null;
}

/** Venue candidate extracted from a data source for discovery */
export interface VenueCandidate {
  source: string;
  source_id: string | null;
  name: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  promoters: string[];
  attractions: string[];
  linked_event_ids: string[];
}

/** Audit log for each scraper run */
export interface IngestionLog {
  id: UUID;
  source_id: UUID;
  source_name: string;
  run_started_at: ISODateString;
  run_ended_at: ISODateString | null;
  events_found: number;
  events_new: number;
  events_updated: number;
  events_skipped: number;
  errors: Array<{ message: string; event_source_id?: string }>;
  status: 'running' | 'success' | 'partial' | 'failed';
}
