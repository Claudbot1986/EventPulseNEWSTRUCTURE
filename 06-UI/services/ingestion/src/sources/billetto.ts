import axios from 'axios';
import { rawEventsQueue } from '../queue';
import type { RawEventInput } from '@eventpulse/shared';

const API_KEY = process.env.BILLETTO_API_KEY;
const BASE_URL = 'https://api.billetto.se/v3';

export async function scrapeBilletto(): Promise<string> {
  // Fail gracefully if API key is not configured
  if (!API_KEY) {
    console.warn('[billetto] ⏭️ Skipping: BILLETTO_API_KEY not configured');
    return 'skipped';
  }

  console.log('[billetto] Starting scrape...');

  let data: any;
  try {
    const response = await axios.get(`${BASE_URL}/events`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      params: {
        location: 'Stockholm',
        per_page: 100,
        status: 'published',
      },
    });
    data = response.data;
    console.log('[billetto] API response received');
  } catch (err: any) {
    console.error('[billetto] API call failed:', err.message);
    return;
  }

  const events = data.data ?? [];
  console.log(`[billetto] ${events.length} events found`);

  let queued = 0;
  for (const ev of events) {
    console.log(`[billetto] Queuing job: billetto:${ev.id}`);
    const raw: RawEventInput = {
      title: ev.title ?? ev.name,
      description: ev.description ?? null,
      start_time: ev.starts_at ?? ev.start_date,
      end_time: ev.ends_at ?? ev.end_date ?? null,
      venue_name: ev.venue?.name ?? null,
      venue_address: ev.venue?.address ?? null,
      lat: ev.venue?.latitude ?? null,
      lng: ev.venue?.longitude ?? null,
      categories: ev.tags ? ev.tags.slice(0, 3) : [],
      is_free: ev.is_free ?? false,
      price_min_sek: ev.price_from ?? null,
      price_max_sek: ev.price_to ?? null,
      ticket_url: ev.url ?? ev.link,
      image_url: ev.image ?? ev.cover_image ?? null,
      source: 'billetto',
      source_id: String(ev.id),
      detected_language: ev.locale?.startsWith('sv') ? 'sv' : 'en',
      raw_payload: ev as Record<string, unknown>,
    };

    console.log(`[billetto] Calling queue.add for billetto:${ev.id}`);
    await rawEventsQueue.add(`billetto:${ev.id}`, raw);
    console.log(`[billetto] ✅ Queued billetto:${ev.id}`);
    queued++;
  }

  console.log(`[billetto] Queued ${queued} jobs, scrape complete`);
  return 'completed';
}
