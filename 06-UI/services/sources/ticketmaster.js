// Internal event data model - designed to support multiple event sources
// Fields: id, title, date, time, venue, area, category, source

/**
 * Maps Ticketmaster event to internal Event model
 * @param {Object} tmEvent - Raw Ticketmaster event object
 * @returns {Event} - Mapped event object
 */
function mapTicketmasterEvent(tmEvent) {
  // Extract date and time from Ticketmaster dates
  const dates = tmEvent.dates || {};
  const start = dates.start || {};
  
  let date = start.localDate || '';
  let time = start.localTime ? start.localTime.substring(0, 5) : '';
  
  // Extract venue info
  const embedded = tmEvent._embedded || {};
  const venues = embedded.venues || [];
  const venue = venues[0] || {};
  const venueName = venue.name || 'Unknown Venue';
  
  // Extract city/area
  const city = venue.city || {};
  const area = city.name || 'Stockholm';
  
  // Extract address
  const address = venue.address || {};
  const addressLine = address.line1 || '';
  
  // Extract description
  const description = tmEvent.info || tmEvent.pleaseNote || '';
  
  // Extract url
  const url = tmEvent.url || '';
  
  // Map Ticketmaster segment to our category
  const segment = tmEvent.classifications?.[0]?.segment?.name?.toLowerCase() || '';
  const genre = tmEvent.classifications?.[0]?.genre?.name?.toLowerCase() || '';
  
  let category = 'culture';
  if (segment.includes('music') || genre.includes('rock') || genre.includes('pop') || genre.includes('jazz')) {
    category = 'music';
  } else if (segment.includes('food') || genre.includes('food') || genre.includes('wine')) {
    category = 'food';
  } else if (segment.includes('sport') || genre.includes('hockey') || genre.includes('football')) {
    category = 'sports';
  } else if (genre.includes('metal') || genre.includes('electronic') || segment.includes('nightlife')) {
    category = 'nightlife';
  } else if (segment.includes('arts') || genre.includes('theatre') || genre.includes('art') || genre.includes('museum')) {
    category = 'culture';
  } else if (segment.includes('technology') || genre.includes('conference') || genre.includes('tech')) {
    category = 'tech';
  }
  
  return {
    id: tmEvent.id || '',
    title: tmEvent.name || 'Untitled Event',
    date: date,
    time: time,
    venue: venueName,
    area: area,
    address: addressLine,
    description: description,
    url: url,
    category: category,
    source: 'ticketmaster',
  };
}

/**
 * Fetch events from Ticketmaster Discovery API
 * @param {string} apiKey - Ticketmaster API key
 * @param {Object} options - Fetch options
 * @returns {Promise<Event[]>} - Array of events
 */
async function fetchTicketmasterEvents(apiKey, options = {}) {
  const {
    city = 'Stockholm',
    countryCode = 'SE',
    limit = 20,
    page = 0,
    sort = 'date,asc',
    endDate = null,
  } = options;
  
  const baseUrl = 'https://app.ticketmaster.com/discovery/v2/events.json';
  const params = new URLSearchParams({
    apikey: apiKey,
    city: city,
    countryCode: countryCode,
    size: limit.toString(),
    page: page.toString(),
    sort: sort,
  });
  
  if (endDate) {
    params.append('endDate', endDate);
  }
  
  const url = `${baseUrl}?${params.toString()}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Ticketmaster API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data._embedded || !data._embedded.events) {
      return [];
    }
    
    const events = data._embedded.events.map(mapTicketmasterEvent);
    return events;
  } catch (error) {
    console.error('Failed to fetch Ticketmaster events:', error);
    throw error;
  }
}

// Export for use in other modules
export { fetchTicketmasterEvents, mapTicketmasterEvent };
