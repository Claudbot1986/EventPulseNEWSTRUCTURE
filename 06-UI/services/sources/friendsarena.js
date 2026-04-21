// Friends Arena Event Source
// Fetches events from WordPress REST API

const FRIENDS_ARENA_API = 'https://www.friendsarena.se/wp-json/wp/v2/events';

/**
 * Map WordPress event to EventPulse format
 */
function mapFriendsArenaEvent(wpEvent) {
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
  
  const id = `friends-${wpEvent.id}`;
  const url = wpEvent.link || `https://www.friendsarena.se${wpEvent.slug}`;
  
  return {
    id,
    title: title.substring(0, 200),
    date,
    time,
    venue: 'Friends Arena',
    area: 'Stockholm',
    address: 'Arena Road 1, 121 78 Johanneshov',
    description: description.substring(0, 500),
    url,
    category,
    source: 'friends-arena',
  };
}

/**
 * Fetch events from Friends Arena
 */
export async function fetchFriendsArenaEvents(options = {}) {
  const { limit = 100 } = options;
  
  try {
    const url = `${FRIENDS_ARENA_API}?per_page=${limit}`;
    const response = await fetch(url, { redirect: 'follow' });
    
    if (!response.ok) {
      throw new Error(`Friends Arena API error: ${response.status}`);
    }
    
    const events = await response.json();
    
    if (!Array.isArray(events)) {
      return [];
    }
    
    // Map to EventPulse format
    const mapped = events.map(mapFriendsArenaEvent);
    
    return mapped;
  } catch (error) {
    console.error('Failed to fetch Friends Arena events:', error);
    return [];
  }
}

export default { fetchFriendsArenaEvents };
