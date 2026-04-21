// Avicii Arena Scraper
// Fetches events from Avicii Arena via JSON-LD ItemList

const AVICII_ARENA_URL = 'https://aviciiarena.se';

export async function fetchAviciiArenaEvents(options = {}) {
  const { limit = 50 } = options;

  try {
    const response = await fetch(AVICII_ARENA_URL + '/evenemang', {
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });

    if (!response.ok) {
      console.warn('Avicii Arena fetch failed:', response.status);
      return [];
    }

    const html = await response.text();

    // Parse JSON-LD ItemList
    const jsonMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    
    if (!jsonMatch) {
      return [];
    }

    for (const script of jsonMatch) {
      try {
        const content = script.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/, '').replace(/<\/script>/, '');
        const data = JSON.parse(content);

        // Check for ItemList structure
        if (data['@type'] === 'ItemList' && data.itemListElement) {
          const events = data.itemListElement
            .filter(item => item.item && item.item['@type'] === 'Event')
            .map(item => {
              const startDate = item.item.startDate || '';
              const date = startDate.split('T')[0];
              const time = startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) : '';
              
              const urlPath = item.item.url || '';
              const slug = urlPath.split('/').filter(Boolean).pop() || 'unknown';
              const category = urlPath.includes('/musik-show') ? 'musik-show' :
                             urlPath.includes('/sport') ? 'sport' :
                             urlPath.includes('/annat') ? 'annat' : 'event';

              return {
                id: `avicii-arena-${slug}`,
                title: item.item.name || '',
                date: date,
                time: time,
                venue: 'Avicii Arena',
                area: 'Stockholm',
                address: '',
                description: '',
                url: item.item.url || '',
                category: category,
                source: 'avicii-arena',
              };
            })
            .filter(e => e.date && e.title);

          return events.slice(0, limit);
        }
      } catch (e) {
        // Continue to next script
      }
    }

    return [];
  } catch (error) {
    console.error('Error fetching Avicii Arena events:', error);
    return [];
  }
}

export default { fetchAviciiArenaEvents };
