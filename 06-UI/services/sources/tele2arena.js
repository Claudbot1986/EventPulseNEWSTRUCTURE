// Tele2 Arena (3Arena) Event Source
// Fetches events from WordPress REST API

const TELE2_ARENA_API = 'https://www.tele2arena.se/wp-json/wp/v2/events';

/**
 * Map WordPress event to EventPulse format
 */
function mapTele2ArenaEvent(wpEvent) {
  const title = wpEvent.title?.rendered || wpEvent.title || 'Untitled Event';
  
  // Extract date from WordPress event
  const eventDate = new Date(wpEvent.date);
  const date = eventDate.toISOString().split('T')[0];
  const time = eventDate.toTimeString().substring(0, 5);
  
  // Extract description from excerpt
  const description = wpEvent.excerpt?.rendered 
    ? wpEvent.excerpt.rendered.replace(/<[^>]*>/g, '').trim()
    : wpEvent.content?.rendered 
      ? wpEvent.content.rendered.replace(/<[^>]*>/g, '').trim()
      : '';
  
  // Extract category from events_category
  const categoryId = wpEvent.events_category?.[0];
  let category = 'sports'; // default
  if (categoryId === 30) category = 'music';
  if (categoryId === 29) category = 'sports';
  if (categoryId === 31) category = 'theater';
  
  const id = `tele2-${wpEvent.id}`;
  const url = wpEvent.link || `https://www.tele2arena.se${wpEvent.slug}`;
  
  return {
    id,
    title: title.substring(0, 200),
    date,
    time,
    venue: 'Tele2 Arena',
    area: 'Stockholm',
    address: 'Globentorget 2, 121 77 Johanneshov',
    description: description.substring(0, 500),
    url,
    category,
    source: 'tele2-arena',
  };
}

/**
 * Fetch events from Tele2 Arena
 */
export async function fetchTele2ArenaEvents(options = {}) {
  const { limit = 100 } = options;
  
  try {
    const url = `${TELE2_ARENA_API}?per_page=${limit}`;
    const response = await fetch(url, { redirect: 'follow' });
    
    if (!response.ok) {
      throw new Error(`Tele2 Arena API error: ${response.status}`);
    }
    
    const events = await response.json();
    
    if (!Array.isArray(events)) {
      return [];
    }
    
    // Map to EventPulse format
    const mapped = events.map(mapTele2ArenaEvent);
    
    return mapped;
  } catch (error) {
    console.error('Failed to fetch Tele2 Arena events:', error);
    return [];
  }
}

export default { fetchTele2ArenaEvents };
