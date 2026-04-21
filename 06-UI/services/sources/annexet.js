// Annexet Scraper
// Fetches events from Annexet via JSON-LD ItemList

const ANNEXET_URL = 'https://annexet.se';

export async function fetchAnnexetEvents(options = {}) {
  const { limit = 50 } = options;

  try {
    const response = await fetch(ANNEXET_URL + '/evenemang', {
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });

    if (!response.ok) {
      console.warn('Annexet fetch failed:', response.status);
      return [];
    }

    const html = await response.text();

    const jsonMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    
    if (!jsonMatch) {
      return [];
    }

    for (const script of jsonMatch) {
      try {
        const content = script.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/, '').replace(/<\/script>/, '');
        const data = JSON.parse(content);

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
                id: `annexet-${slug}`,
                title: item.item.name || '',
                date: date,
                time: time,
                venue: 'Annexet',
                area: 'Stockholm',
                address: '',
                description: '',
                url: item.item.url || '',
                category: category,
                source: 'annexet',
              };
            })
            .filter(e => e.date && e.title);

          return events.slice(0, limit);
        }
      } catch (e) {}
    }

    return [];
  } catch (error) {
    console.error('Error fetching Annexet events:', error);
    return [];
  }
}

export default { fetchAnnexetEvents };
