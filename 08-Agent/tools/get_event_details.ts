/**
 * get_event_details — single event with offers + provenance.
 *
 * Uses service_role client (server-only). Real DB only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventDetail } from '../types';

// Row shape for the untyped supabase select below (established pattern:
// EventRow/VenueRow in search_events.ts). Types what the query returns.
interface EventDetailRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  description_sv: string | null;
  description_en: string | null;
  start_time: string;
  end_time: string | null;
  venue_id: string | null;
  is_free: boolean | null;
  price_min_sek: number | null;
  price_max_sek: number | null;
  ticket_url: string | null;
  image_url: string | null;
  category_slug: string | null;
}

export async function getEventDetails(
  supabase: SupabaseClient,
  eventId: string
): Promise<{ event: EventDetail | null; warnings: string[] }> {
  const warnings: string[] = [];

  // Pre-migration: read directly from `events`. After 20260818-0001 migration
  // applies, switch to `events_public`.
  const TABLE: 'events' | 'events_public' = 'events_public';

  const { data: ev, error: evErr } = await supabase
    .from(TABLE)
    .select(
      'id, title_en, title_sv, description_en, description_sv, ' +
      'start_time, end_time, venue_id, is_free, price_min_sek, price_max_sek, ' +
      'ticket_url, image_url, category_slug'
    )
    .eq('id', eventId)
    .maybeSingle();

  if (evErr) {
    return { event: null, warnings: [`event lookup failed: ${evErr.message}`] };
  }
  if (!ev) {
    return { event: null, warnings: [`event ${eventId} not found`] };
  }
  const row = ev as unknown as EventDetailRow;

  // event_offers and event_provenance are net-new tables; only populated after
  // the migration runs. Until then, both arrays are empty.
  const [{ data: offers }, { data: provenance }] = await Promise.all([
    supabase
      .from('event_offers')
      .select('offer_url, price_min, price_max, currency, vendor')
      .eq('event_id', eventId),
    supabase
      .from('event_provenance')
      .select('source, source_event_id, confidence')
      .eq('event_id', eventId),
  ]);

  return {
    event: {
      id: row.id,
      title: row.title_sv || row.title_en || 'Untitled',
      start_time: row.start_time,
      end_time: row.end_time ?? null,
      venue_name: '',
      city: 'Stockholm',
      category_slug: row.category_slug ?? '',
      price_min_sek: row.price_min_sek ?? null,
      price_max_sek: row.price_max_sek ?? null,
      is_free: !!row.is_free,
      ticket_url: row.ticket_url ?? null,
      image_url: row.image_url ?? null,
      description: row.description_sv || row.description_en || null,
      offers: (offers ?? []).map((o) => ({
        offer_url: o.offer_url,
        price_min: o.price_min ?? null,
        price_max: o.price_max ?? null,
        currency:  o.currency ?? 'SEK',
        vendor:    o.vendor ?? null,
      })),
      provenance: (provenance ?? []).map((p) => ({
        source: p.source,
        source_event_id: p.source_event_id,
        confidence: p.confidence ?? 100,
      })),
    },
    warnings,
  };
}
