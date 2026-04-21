// Debaser Scraper
// Fetches events from Debaser (major Stockholm music venue)
// Uses Webflow listing page + detail page scraping

const DEBASER_URL = 'https://debaser.se';

/**
 * Map Debaser event to internal format
 * @param {Object} event - Raw event data from detail page
 * @returns {Object} - Internal event format
 */
function mapDebaserEvent(event) {
  const title = event.title || 'Untitled Event';
  
  // Parse date - handle Swedish format
  let date = '';
  let time = '';
  
  if (event.dateStr) {
    // Try to parse Swedish date format like "20 Mar" or "20 mars"
    const swedishMonths = {
      'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3,
      'maj': 4, 'jun': 5, 'jul': 6, 'aug': 7,
      'sep': 8, 'okt': 9, 'nov': 10, 'dec': 11,
      'januari': 0, 'februari': 1, 'mars': 2, 'april': 3,
      'maj': 4, 'juni': 5, 'juli': 6, 'augusti': 7,
      'september': 8, 'oktober': 9, 'november': 10, 'december': 11
    };
    
    const dateMatch = event.dateStr.match(/(\d{1,2})\s+(\w+)/i);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const monthName = dateMatch[2].toLowerCase().substring(0, 3);
      const month = swedishMonths[monthName] ?? 0;
      
      // Handle year - if parsed date would be in the past, use next year
      const now = new Date();
      const currentYear = now.getFullYear();
      let year = currentYear;
      
      // Create date and check if it's in the past
      const parsedDate = new Date(currentYear, month, day);
      if (parsedDate < now) {
        year = currentYear + 1;
      }
      
      date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  
  // Extract venue - Debaser has multiple locations
  const venue = event.venue || 'Debaser';
  
  // Extract area
  const area = 'Stockholm';
  
  // Extract description
  const description = event.description || '';
  
  // Extract URL
  const url = event.url || DEBASER_URL;
  
  // Generate unique ID
  const id = `debaser-${event.slug || Math.random().toString(36).substr(2, 9)}`;
  
  // Map category
  const category = mapCategory(title);
  
  return {
    id,
    title,
    date,
    time,
    venue,
    area,
    address: '',
    description: description.substring(0, 500),
    url,
    category,
    source: 'debaser',
  };
}

/**
 * Map event to category based on title
 */
function mapCategory(title) {
  if (!title) return 'music';
  
  const t = title.toLowerCase();
  
  if (t.includes('jazz') || t.includes('blues')) return 'music';
  if (t.includes('rock') || t.includes('metal') || t.includes('punk')) return 'music';
  if (t.includes('elektron') || t.includes('techno') || t.includes('house') || t.includes('edm')) return 'music';
  if (t.includes('pop') || t.includes('indie')) return 'music';
  if (t.includes('standup') || t.includes('komedi') || t.includes('comed')) return 'theater';
  if (t.includes('club') || t.includes('klubb') || t.includes('natt')) return 'nightlife';
  
  return 'music';
}

/**
 * Fetch events from Debaser
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} Array of events in internal format
 */
export async function fetchDebaserEvents(options = {}) {
  const { limit = 50 } = options;
  
  try {
    // Fetch the main events page to get event links
    const response = await fetch(DEBASER_URL + '/konserter', {
      headers: {
        'User-Agent': 'EventPulse/1.0',
      },
    });
    
    if (!response.ok) {
      console.warn('Debaser fetch failed:', response.status);
      return [];
    }
    
    const html = await response.text();
    
    // Extract unique event slugs from the listing page
    const eventLinks = html.match(/href="(\/events\/[^"]+)"/gi) || [];
    const slugs = [...new Set(
      eventLinks
        .map(l => l.match(/href="(\/events\/[^"]+)"/)?.[1])
        .filter(Boolean)
    )];
    
    // Fetch details for each event
    const events = [];
    const fetchLimit = Math.min(slugs.length, limit * 2); // Fetch more to get enough events
    
    for (const slug of slugs.slice(0, fetchLimit)) {
      try {
        const eventRes = await fetch(DEBASER_URL + slug, {
          headers: { 'User-Agent': 'EventPulse/1.0' }
        });
        
        if (!eventRes.ok) continue;
        
        const eventHtml = await eventRes.text();
        
        // Extract title
        const titleMatch = eventHtml.match(/<h1[^>]*class="[^"]*h1[^"]*"[^>]*>([^<]+)<\/h1>/i);
        const title = titleMatch?.[1]?.trim() || '';
        
        // Extract date (Swedish format: DD Mon)
        const dateStrMatch = eventHtml.match(/<p[^>]*class="[^"]*b1[^"]*"[^>]*>(\d{1,2}\s+[A-Za-z]+)<\/p>/i);
        const dateStr = dateStrMatch?.[1]?.trim() || '';
        
        // Extract venue
        const venueMatch = eventHtml.match(/<p[^>]*class="[^"]*b1[^"]*"[^>]*>([^<]*Debaser[^<]*)<\/p>/i);
        const venue = venueMatch?.[1]?.trim() || 'Debaser';
        
        // Extract description
        const descMatches = eventHtml.match(/<p[^>]*class="[^"]*b1[^"]*"[^>]*>([^<]{50,})/gi) || [];
        const description = descMatches.map(d => d.replace(/<[^>]+>/g, '').trim()).join(' ').substring(0, 300);
        
        if (title) {
          events.push(mapDebaserEvent({
            title,
            dateStr,
            venue,
            description,
            url: DEBASER_URL + slug,
            slug: slug.replace('/events/', '')
          }));
        }
        
        if (events.length >= limit) break;
        
      } catch (e) {
        // Continue on individual event errors
      }
    }
    
    return events.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Debaser events:', error);
    return [];
  }
}


