// Malmö Opera Scraper
// Fetches events from Malmö Opera by scraping detail pages

const MALMO_OPERA_URL = 'https://www.malmoopera.se';

function mapMalmöOperaEvent(detailUrl, title, dates) {
  const venue = 'Malmö Opera';
  const area = 'Malmö';
  const id = `malmo-opera-${detailUrl.split('/').pop()}`;

  // Map dates to individual events
  const events = dates.map((date, idx) => ({
    id: `${id}-${idx}`,
    title,
    date: date,
    time: '',
    venue,
    area,
    address: '',
    description: '',
    url: MALMO_OPERA_URL + detailUrl,
    category: 'opera',
    source: 'malmo-opera',
  }));

  return events;
}

export async function fetchMalmöOperaEvents(options = {}) {
  const { limit = 50 } = options;

  try {
    // Get the listing page
    const listResponse = await fetch(MALMO_OPERA_URL + '/forestallningar', {
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });

    if (!listResponse.ok) {
      console.warn('Malmö Opera fetch failed:', listResponse.status);
      return [];
    }

    const html = await listResponse.text();

    // Extract event URLs from the listing page
    const urls = html.match(/href="([^"]+)"/g) || [];
    const eventUrls = [...new Set(
      urls
        .map(u => u.replace('href="', '').replace('"', ''))
        .filter(u => u.includes('/forestallningar/') && !u.includes('arkiv') && !u.includes('#'))
    )];

    const allEvents = [];

    // Scrape each event detail page
    for (const detailUrl of eventUrls.slice(0, 20)) {
      try {
        const detailResponse = await fetch(MALMO_OPERA_URL + detailUrl, {
          headers: { 'User-Agent': 'EventPulse/1.0' },
        });

        if (!detailResponse.ok) continue;

        const detailHtml = await detailResponse.text();

        // Extract title from OG meta tag
        const ogTitle = detailHtml.match(/property="og:title" content="([^"]+)"/);
        const title = ogTitle ? ogTitle[1].replace(' | Malmö Opera', '').trim() : '';

        if (!title) continue;

        // Extract all ISO dates from the detail page
        const dates = detailHtml.match(/\d{4}-\d{2}-\d{2}/g) || [];
        const uniqueDates = [...new Set(dates)];

        // Filter to future dates only
        const now = new Date();
        const futureDates = uniqueDates.filter(d => new Date(d) >= now);

        if (futureDates.length > 0) {
          const events = mapMalmöOperaEvent(detailUrl, title, futureDates);
          allEvents.push(...events);
        }
      } catch (e) {
        // Skip individual event errors
      }
    }

    return allEvents.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Malmö Opera events:', error);
    return [];
  }
}

export default { fetchMalmöOperaEvents };
