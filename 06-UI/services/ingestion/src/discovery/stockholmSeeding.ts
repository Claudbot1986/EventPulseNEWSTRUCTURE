/**
 * Stockholm Venue Seeding
 * 
 * Seeds the discovery system with known Stockholm venues
 * so they can be ranked and expanded from.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Known Stockholm venues with metadata
const STOCKHOLM_VENUES = [
  {
    name: 'Café Opera',
    address: 'Kungsgatan 24, 111 35 Stockholm',
    lat: 59.3345,
    lng: 18.0680,
    area: 'Norrmalm',
    quality_score: 85,
  },
  {
    name: 'Debaser',
    address: 'Medborgarplatsen 8, 118 26 Stockholm',
    lat: 59.3125,
    lng: 18.0735,
    area: 'Södermalm',
    quality_score: 80,
  },
  {
    name: 'Stora Teatern',
    address: 'Östergatan 18, 111 43 Stockholm',
    lat: 59.3335,
    lng: 18.0705,
    area: 'Norrmalm',
    quality_score: 90,
  },
  {
    name: 'Fotografiska',
    address: 'Stadsgårdshamnen 22, 116 45 Stockholm',
    lat: 59.3197,
    lng: 18.0755,
    area: 'Södermalm',
    quality_score: 95,
  },
  {
    name: 'Kulturhuset Stadsteatern',
    address: 'Sergels torg, 103 84 Stockholm',
    lat: 59.3345,
    lng: 18.0685,
    area: 'Norrmalm',
    quality_score: 88,
  },
  {
    name: 'Fasching',
    address: 'Kungsgatan 63, 111 43 Stockholm',
    lat: 59.3355,
    lng: 18.0650,
    area: 'Norrmalm',
    quality_score: 75,
  },
  {
    name: 'Berns',
    address: 'Berzelii Park, 103 27 Stockholm',
    lat: 59.3365,
    lng: 18.0745,
    area: 'Norrmalm',
    quality_score: 82,
  },
  {
    name: 'Folkoperan',
    address: 'Hornsgatan 72, 118 21 Stockholm',
    lat: 59.3145,
    lng: 18.0705,
    area: 'Södermalm',
    quality_score: 85,
  },
  {
    name: 'Oscarsteatern',
    address: 'Kungsgatan 63, 111 43 Stockholm',
    lat: 59.3355,
    lng: 18.0650,
    area: 'Norrmalm',
    quality_score: 87,
  },
  {
    name: 'Moderna Museet',
    address: 'Skeppsholmen, 111 49 Stockholm',
    lat: 59.3265,
    lng: 18.0835,
    area: 'Östermalm',
    quality_score: 92,
  },
  {
    name: 'Nationalmuseum',
    address: 'Svensksundsvägen 9, 111 47 Stockholm',
    lat: 59.3285,
    lng: 18.0855,
    area: 'Östermalm',
    quality_score: 90,
  },
  {
    name: 'Gröna Lund',
    address: 'Djurgården, 115 21 Stockholm',
    lat: 59.3235,
    lng: 18.0965,
    area: 'Djurgården',
    quality_score: 78,
  },
  {
    name: 'Café Opera',
    address: 'Kungsgatan 24, 111 35 Stockholm',
    lat: 59.3345,
    lng: 18.0680,
    area: 'Norrmalm',
    quality_score: 85,
  },
  {
    name: 'Globen',
    address: 'Globentorg, 121 77 Stockholm',
    lat: 59.2955,
    lng: 18.0835,
    area: 'Södertälje',
    quality_score: 88,
  },
  {
    name: 'Tele2 Arena',
    address: 'Arenavägen 14, 121 77 Stockholm',
    lat: 59.2945,
    lng: 18.0845,
    area: 'Södertälje',
    quality_score: 86,
  },
  {
    name: 'Stora Teatern',
    address: 'Östergatan 18, 111 43 Stockholm',
    lat: 59.3335,
    lng: 18.0705,
    area: 'Norrmalm',
    quality_score: 90,
  },
];

// Deduplicate
const UNIQUE_VENUES = Array.from(
  new Map(STOCKHOLM_VENUES.map(v => [v.name, v])).values()
);

/**
 * Seed Stockholm venues into discovery system
 */
export async function seedStockholmVenues(): Promise<number> {
  console.log(`[seeding] Seeding ${UNIQUE_VENUES.length} Stockholm venues...`);

  const candidates = UNIQUE_VENUES.map(v => ({
    source: 'stockholm_seed',
    source_id: null,
    name: v.name,
    city: 'Stockholm',
    address: v.address,
    lat: v.lat,
    lng: v.lng,
    promoters: [],
    attractions: [],
    linked_event_ids: [],
    hop_level: 0, // Direct seed = hop 0
    discovery_path: 'Stockholm',
    validation_reason: 'known_stockholm_venue',
    quality_score: v.quality_score,
    confidence_score: v.quality_score,
    connection_count: 0,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('discovery_venue_candidates')
    .upsert(candidates, { onConflict: 'source,name' });

  if (error) {
    console.error(`[seeding] Failed to seed Stockholm venues: ${error.message}`);
    return 0;
  }

  console.log(`[seeding] ✅ Seeded ${candidates.length} Stockholm venues`);
  return candidates.length;
}

/**
 * Get current seed status
 */
export async function getSeedStatus(): Promise<{
  total: number;
  stockholm: number;
  seeded: number;
}> {
  const { data, count } = await supabase
    .from('discovery_venue_candidates')
    .select('*', { count: 'exact', head: true });

  const { data: stockholmData } = await supabase
    .from('discovery_venue_candidates')
    .select('*')
    .ilike('city', '%stockholm%');

  const { data: seededData } = await supabase
    .from('discovery_venue_candidates')
    .select('*')
    .eq('source', 'stockholm_seed');

  return {
    total: count || 0,
    stockholm: stockholmData?.length || 0,
    seeded: seededData?.length || 0,
  };
}
