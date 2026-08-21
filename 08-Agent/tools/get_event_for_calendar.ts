/**
 * get_event_for_calendar — fetches a single event with venue info for ICS generation.
 *
 * T0058 / Phase 1 retention: calendar export for saved events.
 *
 * Returns null if the event does not exist or the user has no interaction record.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CalendarEvent {
  id: string;
  title: string;
  start_time: string;       // ISO 8601 datetime
  end_time: string | null;  // ISO 8601 datetime, nullable
  venue_name: string;
  city: string;
  ticket_url: string | null;
  source: string | null;
}

export async function getEventForCalendar(
  supabase: SupabaseClient,
  eventId: string,
  clientUserId: string
): Promise<{ event: CalendarEvent | null; warnings: string[] }> {
  const warnings: string[] = [];

  // Verify the user has an interaction with this event (saved/click/impression).
  // If we don't verify ownership, any event ID could be exported by any user.
  const { data: interaction, error: interactionError } = await supabase
    .from('user_interactions')
    .select('id')
    .eq('client_user_id', clientUserId)
    .eq('event_id', eventId)
    .limit(1)
    .maybeSingle();

  if (interactionError) {
    warnings.push(`interaction check failed: ${interactionError.message}`);
  }
  if (!interaction) {
    return { event: null, warnings };
  }

  const { data: ev, error: evErr } = await supabase
    .from('events_public')
    .select(
      `
      id,
      title_sv,
      title_en,
      start_time,
      end_time,
      ticket_url,
      source,
      venues:venue_id(name, city)
    `
    )
    .eq('id', eventId)
    .maybeSingle();

  if (evErr) {
    warnings.push(`event lookup failed: ${evErr.message}`);
    return { event: null, warnings };
  }
  if (!ev) {
    warnings.push(`event ${eventId} not found`);
    return { event: null, warnings };
  }

  return {
    event: {
      id: ev.id,
      title: ev.title_sv || ev.title_en || 'Untitled',
      start_time: ev.start_time,
      end_time: ev.end_time ?? null,
      venue_name: (ev.venues as any)?.name ?? '',
      city: (ev.venues as any)?.city ?? 'Stockholm',
      ticket_url: ev.ticket_url ?? null,
      source: ev.source ?? null,
    },
    warnings,
  };
}
