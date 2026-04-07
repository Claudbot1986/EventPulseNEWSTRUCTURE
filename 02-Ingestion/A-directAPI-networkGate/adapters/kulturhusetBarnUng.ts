// Kulturhuset Barn & Ung Source
// Fetches children & youth events from Kulturhuset's Elasticsearch API

const ELASTIC_SEARCH_URL = 'https://elastic.kulturhusetstadsteatern.se/khst-events';

/**
 * Map Kulturhuset Barn & Ung event to internal format
 * @param {Object} event - Raw event from Elasticsearch
 * @returns {Object} - Internal event format
 */
function mapKulturhusetBarnUngEvent(event) {
  const source = event._source;
  
  // Extract date and time
  let date = '';
  let time = '';
  
  if (source.tixStartDate) {
    const startDate = new Date(source.tixStartDate);
    date = startDate.toISOString().split('T')[0];
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
  
  // Map category - always 'barn' for this source
  const category = 'barn';
  
  // Generate unique ID
  const id = `khbu-${source.tixEventId || source.drupalId || Math.random().toString(36).substr(2, 9)}`;
  
  return {
    id,
    title,
    date,
    time,
    venue,
    area,
    address: '',
    description: description.substring(0, 500),
    url,
    category,
    source: 'kulturhuset-barn-ung',
  };
}

/**
 * Fetch events from Kulturhuset Barn & Ung (children & youth)
 * @param {Object} options - Options (limit, etc.)
 * @returns {Promise<Object[]>} - Array of events
 */
export async function fetchKulturhusetBarnUngEvents(options = {}) {
  const { limit = 20, page = 0 } = options;
  
  // Fetch all events and filter in JavaScript
  const query = {
    size: 100, // Get more to filter
    from: 0,
    query: {
      range: {
        tixStartDate: {
          gte: 'now',
        },
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
      throw new Error(`Kulturhuset Barn & Ung API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.hits || !data.hits.hits) {
      return [];
    }
    
    // Filter for Barn & ung category in JavaScript
    const barnUngLabels = ['Barn & ung', 'Barn', 'För skolan'];
    
    const filteredEvents = data.hits.hits
      .filter(hit => {
        const source = hit._source;
        const categories = source.drupalCategory || [];
        return categories.some(cat => 
          barnUngLabels.some(label => 
            cat.label && cat.label.toLowerCase() === label.toLowerCase()
          )
        );
      })
      .slice(page * limit, (page + 1) * limit)
      .map(mapKulturhusetBarnUngEvent);
    
    return filteredEvents;
  } catch (error) {
    console.error('Kulturhuset Barn & Ung scraper error:', error);
    throw error;
  }
}

/**
 * Test function - fetches and logs first 5 events
 */
export async function testSource() {
  console.log('Testing Kulturhuset Barn & Ung source...');
  const events = await fetchKulturhusetBarnUngEvents({ limit: 5 });
  
  console.log(`Found ${events.length} events from Kulturhuset Barn & Ung:`);
  events.forEach((event, i) => {
    console.log(`\n--- Event ${i + 1} ---`);
    console.log(`Title: ${event.title}`);
    console.log(`Date: ${event.date} ${event.time}`);
    console.log(`Venue: ${event.venue}`);
    console.log(`Category: ${event.category}`);
    console.log(`URL: ${event.url}`);
  });
  
  return events;
}
