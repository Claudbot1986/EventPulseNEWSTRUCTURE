/**
 * get_event_details — single event with offers + provenance.
 *
 * Uses service_role client (server-only). Real DB only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventDetail } from '../types';

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
      id: ev.id,
      title: ev.title_sv || ev.title_en || 'Untitled',
      start_time: ev.start_time,
      end_time: ev.end_time ?? null,
      venue_name: '',
      city: 'Stockholm',
      category_slug: ev.category_slug ?? '',
      price_min_sek: ev.price_min_sek ?? null,
      price_max_sek: ev.price_max_sek ?? null,
      is_free: !!ev.is_free,
      ticket_url: ev.ticket_url ?? null,
      image_url: ev.image_url ?? null,
      description: ev.description_sv || ev.description_en || null,
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
