// Kulturhuset Stockholm Scraper
// Fetches events from Kulturhuset's Elasticsearch API

const ELASTIC_SEARCH_URL = 'https://elastic.kulturhusetstadsteatern.se/khst-events';

/**
 * Map Kulturhuset event to internal format
 * @param {Object} event - Raw event from Elasticsearch
 * @returns {Object} - Internal event format
 */
function mapKulturhusetEvent(event) {
  const source = event._source;
  
  // Extract date and time - store as full ISO timestamp with timezone
  // Kulturhuset API returns dates like "2026-03-26T17:30:00+01:00" (local Stockholm time)
  // We need to preserve this timezone info for correct sorting/filtering
  let date = '';
  let time = '';
  let start_time_iso = '';
  
  if (source.tixStartDate) {
    const startDate = new Date(source.tixStartDate);
    // Store as ISO string with timezone info (converts to UTC)
    start_time_iso = startDate.toISOString();
    date = start_time_iso.split('T')[0];
    time = startDate.toTimeString().substring(0, 5);
  }
  
  // Extract venue
  const venues = source.tixVenue || [];
  const venue = venues[0]?.label || 'Kulturhuset Stadsteatern';
  
  // Extract location/area
  const locations = source.drupalLocation || [];
  const area = locations[0]?.label || 'Stockholm';
  
  // Extract description
  const descriptions = source.drupalLeadText || [];
  const description = descriptions[0]?.value || '';
  
  // Extract URL
  const url = source.drupalLink || '';
  
  // Extract title
  const title = source.drupalTitle || source.tixName || 'Untitled Event';
  
  // Map category
  const categories = source.drupalCategory || [];
  const categoryLabel = categories[0]?.label?.toLowerCase() || '';
  const category = mapCategory(categoryLabel);
  
  // Generate unique ID
  const id = `kh-${source.tixEventId || source.drupalId || Math.random().toString(36).substr(2, 9)}`;
  
  return {
    id,
    title,
    date,
    time,
    start_time: start_time_iso,  // Full ISO timestamp for correct storage
    venue,
    area,
    address: '',
    description: description.substring(0, 500),
    url,
    category,
    source: 'kulturhuset',
  };
}

/**
 * Map Kulturhuset category to internal category
 * @param {string} label - Category label from Kulturhuset
 * @returns {string} - Internal category
 */
function mapCategory(label) {
  const categoryMap = {
    'teater': 'culture',
    'musik': 'music',
    'konsert': 'music',
    'dans': 'culture',
    'film': 'culture',
    'litteratur': 'culture',
    'konst': 'culture',
    'utställning': 'culture',
    'barn & ung': 'barn',
    'barn': 'barn',
    'familj': 'barn',
    'sport': 'sports',
    'mat & dryck': 'food',
    'food': 'food',
    'nattliv': 'nightlife',
    'skapa': 'culture',
    'för skolan': 'barn',
  };
  
  return categoryMap[label] || 'culture';
}

/**
 * Fetch events from Kulturhuset Elasticsearch API
 * @param {Object} options - Options (limit, etc.)
 * @returns {Promise<Object[]>} - Array of events
 */
export async function fetchKulturhusetEvents(options = {}) {
  const { limit = 20, page = 0 } = options;
  
  const query = {
    size: limit,
    from: page * limit,
    query: {
      bool: {
        must: [
          {
            range: {
              tixStartDate: {
                gte: 'now',  // Only future events
              },
            },
          },
        ],
      },
    },
    sort: [
      { tixStartDate: { order: 'asc' } },
    ],
  };
  
  try {
    const response = await fetch(ELASTIC_SEARCH_URL + '/_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'EventPulse/1.0',
      },
      body: JSON.stringify(query),
    });
    
    if (!response.ok) {
      throw new Error(`Kulturhuset API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.hits || !data.hits.hits) {
      return [];
    }
    
    return data.hits.hits.map(mapKulturhusetEvent);
  } catch (error) {
    console.error('Kulturhuset scraper error:', error);
    throw error;
  }
}

/**
 * Test function - fetches and logs first 5 events
 */
export async function testScraper() {
  console.log('Testing Kulturhuset scraper (Elasticsearch API)...');
  const events = await fetchKulturhusetEvents({ limit: 5 });
  
  console.log(`Found ${events.length} events from Kulturhuset:`);
  events.forEach((event, i) => {
    console.log(`\n--- Event ${i + 1} ---`);
    console.log(`Title: ${event.title}`);
    console.log(`Date: ${event.date} ${event.time}`);
    console.log(`Venue: ${event.venue}`);
    console.log(`URL: ${event.url}`);
  });
  
  return events;
}
