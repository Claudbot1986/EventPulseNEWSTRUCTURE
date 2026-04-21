// Södra Teatern Scraper
// Fetches events from Södra Teatern via JSON-LD ItemList

const SODRA_TEATERN_URL = 'https://sodrateatern.com';

export async function fetchSödraTeaternEvents(options = {}) {
  const { limit = 50 } = options;

  try {
    const response = await fetch(SODRA_TEATERN_URL + '/evenemang', {
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });

    if (!response.ok) {
      console.warn('Södra Teatern fetch failed:', response.status);
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
              
              // Extract venue from URL
              const urlPath = item.item.url || '';
              const slug = urlPath.split('/').filter(Boolean).pop() || 'unknown';
              const category = urlPath.includes('/musik-show') ? 'musik-show' :
                             urlPath.includes('/humor-samtal') ? 'humor-samtal' :
                             urlPath.includes('/teater') ? 'teater' : 'event';

              return {
                id: `sodra-teatern-${slug}`,
                title: item.item.name || '',
                date: date,
                time: time,
                venue: 'Södra Teatern',
                area: 'Stockholm',
                address: '',
                description: '',
                url: item.item.url || '',
                category: category,
                source: 'sodra-teatern',
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
    console.error('Error fetching Södra Teatern events:', error);
    return [];
  }
}

export default { fetchSödraTeaternEvents };
