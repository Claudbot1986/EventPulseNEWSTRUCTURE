// Slakthuset Scraper
// Fetches events from Slakthuset (major Stockholm venue)

const SLAKTHUSET_URL = 'https://slakthusen.se';

function mapSlakthusetEvent(event) {
  const title = event.title || event.name || 'Untitled Event';
  
  let date = '';
  let time = '';
  
  if (event.date || event.startDate) {
    const eventDate = new Date(event.date || event.startDate);
    date = eventDate.toISOString().split('T')[0];
    time = eventDate.toTimeString().substring(0, 5);
  }
  
  const venue = event.venue || 'Slakthuset';
  const area = 'Stockholm';
  const description = event.description || event.content || '';
  const url = event.url || event.link || SLAKTHUSET_URL;
  const id = `slakthuset-${event.id || Math.random().toString(36).substr(2, 9)}`;
  const category = mapCategory(event.category);
  
  return {
    id, title, date, time, venue, area,
    address: '',
    description: description.substring(0, 500),
    url, category, source: 'slakthuset',
  };
}

function mapCategory(categoryLabel) {
  if (!categoryLabel) return 'music';
  const label = categoryLabel.toLowerCase();
  if (label.includes('konsert') || label.includes('concert')) return 'music';
  if (label.includes('sport') || label.includes('idrott')) return 'sports';
  if (label.includes('teater') || label.includes('theatre')) return 'theater';
  return 'music';
}

export async function fetchSlakthusetEvents(options = {}) {
  const { limit = 50 } = options;
  
  try {
    const response = await fetch(SLAKTHUSET_URL, {
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });
    
    if (!response.ok) {
      console.warn('Slakthuset fetch failed:', response.status);
      return [];
    }
    
    const html = await response.text();
    const events = parseSlakthusetEvents(html);
    return events.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Slakthuset events:', error);
    return [];
  }
}

function parseSlakthusetEvents(html) {
  const events = [];
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  
  if (jsonLdMatch) {
    for (const script of jsonLdMatch) {
      try {
        const jsonContent = script.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/, '').replace(/<\/script>/, '');
        const jsonData = JSON.parse(jsonContent);
        
        if (Array.isArray(jsonData)) {
          for (const item of jsonData) {
            if (item['@type'] === 'Event') {
              events.push(mapSlakthusetEvent({
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
          events.push(mapSlakthusetEvent({
            title: jsonData.name,
            date: jsonData.startDate,
            description: jsonData.description,
            url: jsonData.url,
            category: jsonData.eventType,
            venue: jsonData.location?.name,
          }));
        }
      } catch (e) {}
    }
  }
  return events;
}


