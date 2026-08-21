/**
 * get_saved_events — returns the user's saved events.
 *
 * T0054 / MVP-gap §77 (Phase 1 retention): saved events section in HomeScreen.
 *
 * Data flow:
 *   1. Query `user_interactions` WHERE client_user_id = ? AND interaction = 'save'
 *      ordered by created_at DESC (most recently saved first).
 *   2. Join with `events_public` to enrich with full event details.
 *   3. Return EventCard[] for the UI.
 *
 * Sort order: `user_interactions.created_at DESC` — the user saved most-recently
 * first. This matches how bookmarks typically work in consumer apps (Meetup,
 * Bandsintown, Eventbrite all surface newest first).
 *
 * Limit: 100 (matches FEED_EVENTS_MAX_LIMIT). A "saved" list growing beyond
 * 100 is a future concern; at that point we add pagination.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventCard } from '../types';

export interface GetSavedEventsInput {
  client_user_id: string;
  /** Max events to return. Default 50, max 100. */
  limit?: number;
}

export interface GetSavedEventsResult {
  events: EventCard[];
}

/** Matches the max cap in feed_events.ts for consistency. */
export const GET_SAVED_EVENTS_MAX_LIMIT = 100;
export const GET_SAVED_EVENTS_DEFAULT_LIMIT = 50;

export async function getSavedEvents(
  supabase: SupabaseClient,
  input: GetSavedEventsInput
): Promise<GetSavedEventsResult> {
  const limit = Math.min(
    Math.max(input.limit ?? GET_SAVED_EVENTS_DEFAULT_LIMIT, 1),
    GET_SAVED_EVENTS_MAX_LIMIT
  );

  const { data, error } = await supabase
    .from('user_interactions')
    .select(
      `
      id,
      created_at,
      events:event_id(
        id,
        title_sv,
        title_en,
        start_time,
        end_time,
        venue_id,
        category_slug,
        is_free,
        price_min_sek,
        price_max_sek,
        ticket_url,
        image_url,
        image_license,
        image_attribution,
        image_source_url,
        source,
        venues:venue_id(name, city)
      )
    `
    )
    .eq('client_user_id', input.client_user_id)
    .eq('interaction', 'save')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return { events: [] };
  }

  const events: EventCard[] = data
    .map((row: any) => {
      const ev = row.events;
      if (!ev) return null;
      return {
        id: ev.id,
        title: ev.title_sv || ev.title_en || 'Untitled',
        start_time: ev.start_time,
        end_time: ev.end_time ?? null,
        venue_name: ev.venues?.name ?? '',
        venue_id: ev.venue_id ?? null,
        city: ev.venues?.city ?? 'Stockholm',
        category_slug: ev.category_slug ?? '',
        price_min_sek: ev.price_min_sek ?? null,
        price_max_sek: ev.price_max_sek ?? null,
        is_free: !!ev.is_free,
        ticket_url: ev.ticket_url ?? null,
        image_url: ev.image_url ?? null,
        image_license: ev.image_license ?? null,
        image_attribution: ev.image_attribution ?? null,
        image_source_url: ev.image_source_url ?? null,
        source: ev.source ?? null,
      } satisfies EventCard;
    })
    .filter((e): e is EventCard => e !== null);

  return { events };
}
