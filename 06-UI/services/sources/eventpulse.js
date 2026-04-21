/**
 * Local Data Source - EventPulse Forge
 * 
 * Reads events from bundled stockholmEventFeed.json
 * This replaces direct API calls to Ticketmaster and other providers
 * to avoid rate limiting and use our curated data.
 * 
 * Usage:
 *   import { fetchEventPulseEvents } from './sources/eventpulse.js';
 *   const events = await fetchEventPulseEvents();
 */

// Import bundled JSON - Expo/React Native compatible using require
let stockholmEvents = null;

function loadStockholmEvents() {
  if (stockholmEvents) return stockholmEvents;
  
  try {
    // Use standard require for Expo/Metro compatibility
    // The JSON file must be in assets/ folder or bundled with the app
    stockholmEvents = require('../../assets/data/stockholmEventFeed.json');
    return stockholmEvents;
  } catch (e) {
    console.warn('[EventPulse] Could not load stockholmEventFeed.json:', e.message);
    return { venues: [] };
  }
}

/**
 * Map venue to appropriate category based on venue name and type
 */
function mapVenueToCategory(venue) {
  const name = (venue.name || '').toLowerCase();
  const provenance = venue.provenance || [];
  
  // Check venue name patterns
  if (name.includes('teatr') || name.includes('södra') || name.includes('梗')) return 'theatre';
  if (name.includes('konser') || name.includes('aren') || name.includes('arena') || name.includes('annexet')) return 'music';
  if (name.includes('musik') || name.includes('hallen') || name.includes('oper')) return 'music';
  if (name.includes('museum') || name.includes('fotografisk') || name.includes('galleri')) return 'culture';
  if (name.includes('sport') || name.includes('fotboll') || name.includes('idrott')) return 'sports';
  if (name.includes('barn') || name.includes('ung')) return 'barn';
  if (name.includes('restaurang') || name.includes('mat') || name.includes('krog')) return 'food';
  if (name.includes('klubb') || name.includes('natt') || name.includes('bar')) return 'nightlife';
  
  // Default based on common Stockholm venues
  const musicVenues = ['cirkus', 'göta lejon', 'debaser', 'tradgar', 'fryshuset', 'slakthuset', 'malmö live', 'avicii'];
  const theatreVenues = ['kulturhuset', 'vasateatern', 'nya teatern', 'dramaten', 'oscar'];
  const cultureVenues = ['fotografiska', 'moderna', 'nationalmuseum', 'historiska'];
  
  if (musicVenues.some(v => name.includes(v))) return 'music';
  if (theatreVenues.some(v => name.includes(v))) return 'theatre';
  if (cultureVenues.some(v => name.includes(v))) return 'culture';
  
  return 'culture'; // default category
}

/**
 * Fetch events from bundled stockholmEventFeed.json
 * Transforms venues into event-like objects since feed contains venues with upcomingEvents
 * @returns {Promise<Event[]>} Array of events
 */
export async function fetchEventPulseEvents() {
  try {
    // Load JSON data (synchronous for Expo compatibility)
    const data = loadStockholmEvents();
    
    // Handle the feed format - it has venues with upcomingEvents counts
    if (data && data.venues) {
      const venues = data.venues;
      
      // Get today's date and add days progressively to spread events across dates
      const today = new Date();
      const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      
      // Transform venues to event-like objects for display
      // Assign dates progressively so events show up on different days
      let dateOffset = 0;
      const events = venues
        .filter(v => v.upcomingEvents > 0)
        .map((venue, index) => {
          // Distribute venues across next 30 days based on rank (higher rank = earlier)
          dateOffset = Math.floor(index / (venues.length / 30));
          const eventDate = new Date(baseDate);
          eventDate.setDate(eventDate.getDate() + dateOffset);
          const dateStr = eventDate.toISOString().split('T')[0];
          
          // Generate a realistic time based on venue hash
          const venueHash = venue.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
          const hours = 17 + (venueHash % 4); // Events between 17:00-21:00
          const timeStr = `${hours.toString().padStart(2, '0')}:${(venueHash % 60).toString().padStart(2, '0')}`;
          
          return {
            id: venue.id,
            title: venue.name,
            date: dateStr,
            time: timeStr,
            venue: venue.name,
            city: venue.city || 'Stockholm',
            category: mapVenueToCategory(venue),
            source: 'eventpulse',
            isSynthetic: true, // Mark synthetic for future filtering/transparency
            upcomingEvents: venue.upcomingEvents,
            coordinates: venue.coordinates,
            rankScore: venue.rankScore,
            provenance: venue.provenance,
            description: `${venue.upcomingEvents} upcoming events at ${venue.name}`,
            url: venue.url || null,
          };
        });
      
      console.log(`[EventPulse] Loaded ${events.length} venues with events from bundled feed`);
      return events;
    }
    
    // If format is just events array
    if (data && Array.isArray(data)) {
      console.log(`[EventPulse] Loaded ${data.length} events from bundled feed`);
      return data;
    }
    
    console.warn('[EventPulse] Unexpected JSON format - no venues found');
    return [];
  } catch (error) {
    console.error('[EventPulse] Error loading bundled events:', error);
    return [];
  }
}

/**
 * Get feed statistics
 */
export async function getFeedStats() {
  const data = loadStockholmEvents();
  const venues = data?.venues || [];
  const venuesWithEvents = venues.filter(v => v.upcomingEvents > 0);
  return {
    totalVenues: venues.length,
    venuesWithEvents: venuesWithEvents.length,
    totalUpcomingEvents: venuesWithEvents.reduce((sum, v) => sum + v.upcomingEvents, 0),
    source: 'bundled_json',
    generatedAt: data?.generatedAt
  };
}
