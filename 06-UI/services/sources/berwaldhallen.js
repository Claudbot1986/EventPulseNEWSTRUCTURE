// Berwaldhallen Scraper
// Fetches events from Berwaldhallen (Swedish concert hall)

const BERWALDHALLEN_URL = 'https://www.berwaldhallen.se';

function mapBerwaldhallenEvent(event) {
  const title = event.name || 'Untitled Event';

  let date = '';
  let time = '';

  if (event.startDate) {
    const eventDate = new Date(event.startDate);
    date = eventDate.toISOString().split('T')[0];
    time = eventDate.toTimeString().substring(0, 5);
  }

  const venue = 'Berwaldhallen';
  const area = 'Stockholm';
  const description = event.description || '';
  const url = event.url || BERWALDHALLEN_URL + '/kalender';
  const id = `berwaldhallen-${event['@id'] || Math.random().toString(36).substr(2, 9)}`;
  const category = 'music';

  return {
    id, title, date, time, venue, area,
    address: '',
    description: description.substring(0, 500),
    url, category, source: 'berwaldhallen',
  };
}

export async function fetchBerwaldhallenEvents(options = {}) {
  const { limit = 50 } = options;

  try {
    const response = await fetch(BERWALDHALLEN_URL + '/kalender', {
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });

    if (!response.ok) {
      console.warn('Berwaldhallen fetch failed:', response.status);
      return [];
    }

    const html = await response.text();
    const events = parseBerwaldhallenEvents(html);
    return events.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Berwaldhallen events:', error);
    return [];
  }
}

function parseBerwaldhallenEvents(html) {
  const events = [];

  // Extract JSON-LD with EventSeries containing subEvents
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);

  if (jsonLdMatch) {
    for (const script of jsonLdMatch) {
      try {
        const jsonContent = script.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/, '').replace(/<\/script>/, '');
        const jsonData = JSON.parse(jsonContent);

        // Handle EventSeries with subEvents
        if (jsonData['@type'] === 'EventSeries' && jsonData.subEvent) {
          for (const subEvent of jsonData.subEvent) {
            if (subEvent['@type'] === 'Event') {
              events.push(mapBerwaldhallenEvent(subEvent));
            }
          }
        }

        // Handle @graph structure
        if (jsonData['@graph']) {
          for (const item of jsonData['@graph']) {
            if (item['@type'] === 'Event') {
              events.push(mapBerwaldhallenEvent(item));
            }
          }
        }

        // Handle direct Event
        if (jsonData['@type'] === 'Event') {
          events.push(mapBerwaldhallenEvent(jsonData));
        }
      } catch (e) {
        // Skip malformed JSON
      }
    }
  }

  return events;
}

export default { fetchBerwaldhallenEvents };
