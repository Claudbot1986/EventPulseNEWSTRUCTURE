// Malmö Live - Event Source
// API: https://malmolive.se/api/events

const MALMO_LIVE_API = 'https://malmolive.se/api/events';

function mapMalmöLiveEvent(item) {
  const title = item.title || 'Untitled Event';
  
  // Parse date and time
  let date = '';
  let time = '';
  if (item.field_date_time) {
    const dt = new Date(item.field_date_time);
    date = dt.toISOString().split('T')[0];
    time = dt.toTimeString().substring(0, 5);
  }
  
  const venue = item.field_venue || 'Malmö Live';
  const area = 'Malmö';
  
  let category = 'culture';
  const keywords = item.field_keywords_target_id || '';
  if (keywords.includes('Jazz') || keywords.includes('Pop') || keywords.includes('Rock')) {
    category = 'music';
  } else if (keywords.includes('Opera') || keywords.includes('Symfoni')) {
    category = 'music';
  } else if (keywords.includes('Barn') || keywords.includes('familj')) {
    category = 'family';
  }
  
  let url = '';
  if (item.view_node) {
    url = 'https://malmolive.se' + item.view_node;
  }
  
  return {
    id: `malmo-live-${item.tessitura_event_id || item.tessitura_instance_id || Math.random()}`,
    title,
    date,
    time,
    venue,
    area,
    address: '',
    description: item.field_text_plain_long || '',
    url,
    category,
    source: 'malmo-live',
  };
}

export async function fetchMalmöLiveEvents(options = {}) {
  const { limit = 100 } = options;
  
  try {
    const response = await fetch(MALMO_LIVE_API, {
      headers: {
        'User-Agent': 'EventPulse/1.0',
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.warn('Malmö Live fetch failed:', response.status);
      return [];
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      console.warn('Malmö Live: Unexpected data format');
      return [];
    }
    
    // Map events
    let events = data.map(mapMalmöLiveEvent);
    
    // Filter: only future events within 1 year
    const now = new Date();
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() + 1);
    
    events = events.filter(e => {
      if (!e.date) return false;
      const eventDate = new Date(e.date);
      return eventDate >= now && eventDate <= oneYear;
    });
    
    return events.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Malmö Live events:', error);
    return [];
  }
}
