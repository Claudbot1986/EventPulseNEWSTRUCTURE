/**
 * Canonical event read path — Node wrapper (:7777).
 * Same query as eventsCanonical.js (all published, no date filter).
 */

const DEFAULT_SUPABASE_URL = 'https://bsllkpvkowwndhhxtlln.supabase.co';
const DEFAULT_SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzbGxrcHZrb3d3bmRoaHh0bGxuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzMwMDQzNCwiZXhwIjoyMDg4ODc2NDM0fQ.2BJFgNoS0iP53WuPS_lyjNlHjy11_VLjKmcrhf5Dyis';

const EVENT_SELECT =
  'id,source,source_id,title_sv,title_en,description_sv,description_en,start_time,end_time,venue_id,lat,lng,is_free,price_min_sek,price_max_sek,ticket_url,image_url,status,category_slug,venues(name,address,city)';

function getConfig() {
  return {
    url: (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || DEFAULT_SERVICE_KEY,
  };
}

function supabaseHeaders(extra = {}) {
  const { key } = getConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

function formatDate(iso) {
  if (!iso) return '';
  return iso.split('T')[0];
}

function formatTime(iso) {
  if (!iso || !iso.includes('T')) return '';
  return iso.split('T')[1].slice(0, 5);
}

function transformEvent(row) {
  const venue = row.venues || {};
  const title = row.title_sv || row.title_en || 'Untitled';
  const venueName = venue.name || '';

  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    title,
    title_sv: row.title_sv,
    title_en: row.title_en,
    description: row.description_sv || row.description_en || '',
    date: formatDate(row.start_time),
    time: formatTime(row.start_time),
    start_time: row.start_time,
    end_time: row.end_time,
    venue_id: row.venue_id,
    venue_name: venueName,
    venue_address: venue.address || '',
    city: venue.city || '',
    lat: row.lat,
    lng: row.lng,
    is_free: row.is_free,
    price_min: row.price_min_sek,
    price_max: row.price_max_sek,
    ticket_url: row.ticket_url,
    image_url: row.image_url,
    url: row.ticket_url,
    status: row.status,
    category_slug: row.category_slug,
    category: row.category_slug,
    venue: venueName,
    area: venue.city || venue.address || '',
    address: venue.address || '',
    isFree: row.is_free,
    priceMin: row.price_min_sek,
    priceMax: row.price_max_sek,
    imageUrl: row.image_url,
  };
}

function buildFilterQuery({ source = null }) {
  const params = new URLSearchParams();
  params.set('select', EVENT_SELECT);
  params.set('status', 'eq.published');
  params.set('order', 'start_time.asc');

  if (source) {
    params.set('source', `eq.${source}`);
  }

  return params;
}

async function countPublishedEvents(filters = {}) {
  const { url } = getConfig();
  const params = buildFilterQuery(filters);
  params.set('select', 'id');

  const response = await fetch(`${url}/rest/v1/events?${params.toString()}`, {
    method: 'GET',
    headers: supabaseHeaders({ Prefer: 'count=exact', Range: '0-0' }),
  });

  if (!response.ok) {
    throw new Error(`Supabase count failed: HTTP ${response.status}`);
  }

  const range = response.headers.get('content-range') || '';
  const match = range.match(/\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function fetchSourceCounts(filters = {}) {
  const { url } = getConfig();
  const params = buildFilterQuery(filters);
  params.set('select', 'source');
  params.set('limit', '50000');

  const response = await fetch(`${url}/rest/v1/events?${params.toString()}`, {
    headers: supabaseHeaders(),
  });

  if (!response.ok) {
    return {};
  }

  const rows = await response.json();
  const counts = {};
  for (const row of rows) {
    if (!row.source) continue;
    counts[row.source] = (counts[row.source] || 0) + 1;
  }
  return counts;
}

async function fetchCanonicalEvents(options = {}) {
  const { limit = 200, offset = 0, source = null, city = 'Stockholm' } = options;
  const filters = { source };
  const { url } = getConfig();
  const params = buildFilterQuery(filters);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const [totalPublished, eventsResponse, sourceCounts] = await Promise.all([
    countPublishedEvents(filters),
    fetch(`${url}/rest/v1/events?${params.toString()}`, {
      headers: supabaseHeaders(),
    }),
    fetchSourceCounts(filters),
  ]);

  if (!eventsResponse.ok) {
    const text = await eventsResponse.text();
    throw new Error(`Supabase fetch failed: HTTP ${eventsResponse.status} ${text}`);
  }

  const rows = await eventsResponse.json();
  const events = rows.map(transformEvent);

  return {
    data_source: 'supabase',
    fallback_used: false,
    timestamp: new Date().toISOString(),
    total_published_events: totalPublished,
    source_counts: sourceCounts,
    sources: Object.keys(sourceCounts).sort(),
    events,
    count: events.length,
    query_params: { city, limit, offset, source },
    metadata: {
      data_source: 'supabase',
      total_count: totalPublished,
      page_count: events.length,
    },
  };
}

module.exports = {
  fetchCanonicalEvents,
  transformEvent,
  countPublishedEvents,
};
