// Stockholm Live Scraper
// Fetches events from Stockholm Live (major Stockholm events)

const STOCKHOLM_LIVE_URL = 'https://stockholmlive.com';

function mapStockholmLiveEvent(event) {
  const title = event.title || event.name || 'Untitled Event';

  let date = '';
  let time = '';

  if (event.date || event.startDate) {
    const eventDate = new Date(event.date || event.startDate);
    date = eventDate.toISOString().split('T')[0];
    time = eventDate.toTimeString().substring(0, 5);
  }

  const venue = event.venue || 'Stockholm Live';
  const area = 'Stockholm';
  const description = event.description || event.content || '';
  const url = event.url || event.link || STOCKHOLM_LIVE_URL;
  const id = `sl-${event.id || Math.random().toString(36).substr(2, 9)}`;
  const category = mapCategory(event.category);

  return {
    id, title, date, time, venue, area,
    address: '',
    description: description.substring(0, 500),
    url, category, source: 'stockholmlive',
  };
}

function mapCategory(categoryLabel) {
  if (!categoryLabel) return 'music';
  const label = categoryLabel.toLowerCase();
  if (label.includes('konsert') || label.includes('concert')) return 'music';
  if (label.includes('sport') || label.includes('idrott')) return 'sports';
  if (label.includes('teater') || label.includes('theatre')) return 'theater';
  if (label.includes('familj') || label.includes('barn')) return 'family';
  return 'music';
}

export async function fetchStockholmLiveEvents(options = {}) {
  const { limit = 50 } = options;

  try {
    const response = await fetch(STOCKHOLM_LIVE_URL + '/evenemang/', {
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });

    if (!response.ok) {
      console.warn('Stockholm Live fetch failed:', response.status);
      return [];
    }

    const html = await response.text();
    const events = parseStockholmLiveEvents(html);
    return events.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Stockholm Live events:', error);
    return [];
  }
}

function parseStockholmLiveEvents(html) {
  const events = [];
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);

  if (jsonLdMatch) {
    for (const script of jsonLdMatch) {
      try {
        const jsonContent = script.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/, '').replace(/<\/script>/, '');
        const jsonData = JSON.parse(jsonContent);

        // Handle @graph structure
        if (jsonData['@graph']) {
          for (const item of jsonData['@graph']) {
            if (item['@type'] === 'Event') {
              events.push(mapStockholmLiveEvent({
                title: item.name,
                date: item.startDate,
                description: item.description,
                url: item.url,
                category: item.eventType,
                venue: item.location?.name,
              }));
            }
          }
        }

        // Handle ItemList structure (itemListElement -> Event)
        if (jsonData['@type'] === 'ItemList' && jsonData.itemListElement) {
          for (const listItem of jsonData.itemListElement) {
            if (listItem.item && listItem.item['@type'] === 'Event') {
              const item = listItem.item;
              events.push(mapStockholmLiveEvent({
                title: item.name,
                date: item.startDate,
                description: item.description,
                url: item.url,
                category: item.eventType,
                venue: item.location?.name,
              }));
            }
          }
        }

        // Handle direct array
        if (Array.isArray(jsonData)) {
          for (const item of jsonData) {
            if (item['@type'] === 'Event') {
              events.push(mapStockholmLiveEvent({
                title: item.name,
                date: item.startDate,
                description: item.description,
                url: item.url,
                category: item.eventType,
                venue: item.location?.name,
              }));
            }
          }
        } else if (jsonData['@type'] === 'Event') {
          events.push(mapStockholmLiveEvent({
            title: jsonData.name,
            date: jsonData.startDate,
            description: jsonData.description,
            url: jsonData.url,
            category: jsonData.eventType,
            venue: jsonData.location?.name,
          }));
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }
  }
  return events;
}

export default { fetchStockholmLiveEvents };
