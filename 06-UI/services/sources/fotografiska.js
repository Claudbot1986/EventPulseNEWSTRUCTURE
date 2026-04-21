// Fotografiska Stockholm Event Source
// Fetches events from Fotografiska using HTML scraping - Self-contained

const FOTOGRAFISKA_URL = 'https://stockholm.fotografiska.com/sv/events';

/**
 * Map Fotografiska event to EventPulse format
 */
function mapFotografiskaEvent(event) {
  return {
    id: `foto-${event.id || Math.random().toString(36).substr(2, 9)}`,
    title: event.title || event.name || 'Untitled',
    date: event.date || event.startDate || '',
    time: event.time || event.startTime || '',
    venue: 'Fotografiska Stockholm',
    area: 'Stockholm',
    address: 'Stadsgården, Södra Blasieholmen, 116 45 Stockholm',
    description: event.description || '',
    url: event.url || FOTOGRAFISKA_URL,
    category: 'culture',
    source: 'fotografiska',
  };
}

/**
 * Fetch events from Fotografiska Stockholm
 * Self-contained HTML scraping without external dependencies
 */
export async function fetchFotografiskaEvents(options = {}) {
  const { limit = 50 } = options;
  
  try {
    // Fetch HTML page
    const response = await fetch(FOTOGRAFISKA_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EventPulse/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    if (!response.ok) {
      console.warn('[Fotografiska] HTTP error:', response.status);
      return [];
    }
    
    const html = await response.text();
    
    // Extract JSON-LD data from script tags
    const events = [];
    const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    
    while ((match = jsonLdPattern.exec(html)) !== null) {
      try {
        const jsonData = JSON.parse(match[1]);
        
        // Handle ItemList format
        if (jsonData['@type'] === 'ItemList' && jsonData.itemListElement) {
          for (const item of jsonData.itemListElement) {
            if (item.item?.['@type'] === 'Event') {
              const ev = item.item;
              events.push(mapFotografiskaEvent({
                id: ev.identifier || ev.id,
                title: ev.name,
                date: ev.startDate?.split('T')[0],
                time: ev.startDate?.split('T')[1]?.substring(0, 5),
                description: ev.description,
                url: ev.url,
              }));
            }
          }
        }
        
        // Handle @graph format
        if (jsonData['@graph']) {
          for (const item of jsonData['@graph']) {
            if (item['@type'] === 'Event') {
              events.push(mapFotografiskaEvent({
                id: item.identifier || item.id,
                title: item.name,
                date: item.startDate?.split('T')[0],
                time: item.startDate?.split('T')[1]?.substring(0, 5),
                description: item.description,
                url: item.url,
              }));
            }
          }
        }
        
        // Handle direct events array
        if (Array.isArray(jsonData)) {
          for (const ev of jsonData) {
            if (ev['@type'] === 'Event') {
              events.push(mapFotografiskaEvent(ev));
            }
          }
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }
    
    // Filter to future events only
    const today = new Date().toISOString().split('T')[0];
    const futureEvents = events.filter(e => e.date >= today);
    
    console.log(`[Fotografiska] Found ${futureEvents.length} future events`);
    return futureEvents.slice(0, limit);
    
  } catch (error) {
    console.error('[Fotografiska] Fetch error:', error.message);
    return [];
  }
}

export default { fetchFotografiskaEvents };
