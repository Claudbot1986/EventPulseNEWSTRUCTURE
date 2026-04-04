import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../../.env'), override: true });
import axios from 'axios';
import { rawEventsQueue } from '../../03-Queue/queue';
import type { RawEventInput } from '@eventpulse/shared';

const API_KEY = process.env.EVENTBRITE_API_KEY;
const BASE_URL = 'https://www.eventbriteapi.com/v3';

interface EventbriteEvent {
  id: string;
  name: { text: string; html: string };
  description: { text: string } | null;
  start: { utc: string; local: string };
  end: { utc: string; local: string } | null;
  is_free: boolean;
  ticket_availability?: {
    minimum_ticket_price?: { major_value: string };
    maximum_ticket_price?: { major_value: string };
  };
  url: string;
  logo?: { url: string } | null;
  venue?: {
    name: string;
    address: { localized_address_display: string; latitude: string; longitude: string };
  } | null;
  category_id?: string;
}

const CATEGORY_MAP: Record<string, string> = {
  '103': 'music',
  '105': 'sports',
  '110': 'food-drink',
  '113': 'community',
  '115': 'art-exhibitions',
  '116': 'film',
  '117': 'theatre-comedy',
  '119': 'technology',
};

export async function scrapeEventbrite(): Promise<string> {
  // Fail gracefully if API key is not configured
  if (!API_KEY) {
    console.warn('[eventbrite] ⏭️ Skipping: EVENTBRITE_API_KEY not configured');
    return 'skipped';
  }

  console.log('[eventbrite] Starting scrape...');
  let page = 1;
  let hasMore = true;
  const EVENTS_PER_VENUE_LIMIT = 3;
  const venueEventCount = new Map<string, number>();

  while (hasMore) {
    let data: any;
    try {
      const response = await axios.get(`${BASE_URL}/events/search/`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
        params: {
          'location.address': 'Stockholm, Sweden',
          'location.within': '50km',
          'start_date.range_start': new Date().toISOString(),
          'start_date.range_end': new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          expand: 'venue,ticket_availability,logo',
          page_size: 50,
          page,
        },
      });
      data = response.data;
      console.log(`[eventbrite] Page ${page}: API response received`);
    } catch (err: any) {
      console.error(`[eventbrite] Page ${page}: API call failed:`, err.message);
      hasMore = false;
      continue;
    }

    const events: EventbriteEvent[] = data.events ?? [];
    console.log(`[eventbrite] Page ${page}: ${events.length} events found`);

    for (const ev of events) {
      // Enforce venue-level limit (3 events per venue max)
      const venueName = ev.venue?.name ?? 'unknown';
      const currentCount = venueEventCount.get(venueName) ?? 0;
      if (currentCount >= EVENTS_PER_VENUE_LIMIT) {
        console.log(`[eventbrite] ⏭️ Skipping "${ev.name.text}" - venue "${venueName}" limit reached`);
        continue;
      }
      venueEventCount.set(venueName, currentCount + 1);

      const raw: RawEventInput = {
        title: ev.name.text,
        description: ev.description?.text ?? null,
        start_time: ev.start.utc,
        end_time: ev.end?.utc ?? null,
        venue_name: ev.venue?.name ?? null,
        venue_address: ev.venue?.address.localized_address_display ?? null,
        lat: ev.venue?.address.latitude ? parseFloat(ev.venue.address.latitude) : null,
        lng: ev.venue?.address.longitude ? parseFloat(ev.venue.address.longitude) : null,
        categories: ev.category_id && CATEGORY_MAP[ev.category_id]
          ? [CATEGORY_MAP[ev.category_id]]
          : [],
        is_free: ev.is_free,
        price_min_sek: ev.ticket_availability?.minimum_ticket_price
          ? Math.round(parseFloat(ev.ticket_availability.minimum_ticket_price.major_value))
          : null,
        price_max_sek: ev.ticket_availability?.maximum_ticket_price
          ? Math.round(parseFloat(ev.ticket_availability.maximum_ticket_price.major_value))
          : null,
        ticket_url: ev.url,
        image_url: ev.logo?.url ?? null,
        source: 'eventbrite',
        source_id: ev.id,
        detected_language: null,
        raw_payload: ev as unknown as Record<string, unknown>,
      };

      console.log(`[eventbrite] Queuing job: eventbrite:${ev.id} (${events.indexOf(ev) + 1}/${events.length})`);
      console.log(`[eventbrite] Calling queue.add for eventbrite:${ev.id}`);
      await rawEventsQueue.add(`eventbrite:${ev.id}`, raw);
      console.log(`[eventbrite] ✅ Queued eventbrite:${ev.id}`);
    }
    console.log(`[eventbrite] Queued ${events.length} jobs total`);

    hasMore = data.pagination?.has_more_items === true;
    page++;

    // Rate limit: Eventbrite allows ~1000 req/hour — be conservative
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[eventbrite] Scrape complete`);
  return 'completed';
}
