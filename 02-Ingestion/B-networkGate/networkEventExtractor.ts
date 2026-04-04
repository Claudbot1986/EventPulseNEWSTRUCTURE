/**
 * Network Event Extractor — Extract events from API responses
 * 
 * Designed for Tixly API format but extensible for other API patterns.
 * 
 * Usage:
 *   import { extractFromApi } from './networkEventExtractor';
 *   const events = extractFromApi(apiResponse, sourceId);
 */

import { fetchJson } from '../tools/fetchTools';
import type { ParsedEvent } from '../F-eventExtraction/schema';

export interface NetworkExtractResult {
  events: ParsedEvent[];
  rawCount: number;
  parseErrors: string[];
  sourceUrl: string;
  apiUrl: string;
}

/**
 * Extract events from Tixly API response
 * Tixly returns: { Events: [...], Productions: [...] }
 * Each event has: Name, StartDate, EndDate, MinPrice, MaxPrice, PurchaseUrl, etc.
 */
function extractFromTixlyApi(data: any, sourceId: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  
  // Tixly has both Events (individual performances) and Productions (grouped events)
  const tixlyEvents = data?.Events || [];
  const tixlyProductions = data?.Productions || [];
  
  // Process individual Events
  for (const event of tixlyEvents) {
    try {
      const parsed: ParsedEvent = {
        id: `${sourceId}-${event.EventId}`,
        title: event.Name || 'Untitled',
        description: event.Description || '',
        startTime: event.StartDate ? new Date(event.StartDate).toISOString() : undefined,
        endTime: event.EndDate ? new Date(event.EndDate).toISOString() : undefined,
        url: event.PurchaseUrl || event.PurchaseUrlEnglish || '',
        imageUrl: event.EventImagePath || '',
        venue: event.Venue || '',
        category: event.Category || event.Genre || '',
        organizer: event.Organizer || '',
        price: event.MinPrice !== undefined || event.MaxPrice !== undefined 
          ? { min: event.MinPrice, max: event.MaxPrice }
          : undefined,
        status: event.State?.SoldOut ? 'sold_out' : 
                event.State?.SaleStatusText === 'FewTickets' ? 'few_tickets' : 'available',
        source: sourceId,
        sourceUrl: '',
        lastModified: new Date().toISOString(),
      };
      
      // Only add if we have at least a title and start time
      if (parsed.title && parsed.startTime) {
        events.push(parsed);
      }
    } catch (err) {
      // Skip malformed events
    }
  }
  
  // Process Productions (grouped events with multiple dates)
  for (const production of tixlyProductions) {
    try {
      // Production has Dates array and other metadata
      const dates = production.Dates || [];
      const eventIds = production.EventIds || [];
      
      for (let i = 0; i < dates.length; i++) {
        const parsed: ParsedEvent = {
          id: `${sourceId}-prod-${production.EventGroupId}-${i}`,
          title: production.Name || 'Untitled',
          description: production.Description || production.SubTitle || '',
          startTime: dates[i] ? new Date(dates[i]).toISOString() : undefined,
          endTime: undefined, // Productions may not have end time
          url: production.PurchaseUrl || '',
          imageUrl: production.EventImagePath || production.FeaturedImagePath || '',
          venue: production.Venue || '',
          category: production.Category || production.Genre || '',
          organizer: production.Organizer || '',
          price: production.MinPrice !== undefined || production.MaxPrice !== undefined
            ? { min: production.MinPrice, max: production.MaxPrice }
            : undefined,
          status: production.EventStates?.[i]?.SoldOut ? 'sold_out' : 'available',
          source: sourceId,
          sourceUrl: '',
          lastModified: new Date().toISOString(),
        };
        
        if (parsed.title && parsed.startTime) {
          events.push(parsed);
        }
      }
    } catch (err) {
      // Skip malformed productions
    }
  }
  
  return events;
}

/**
 * Detect API format and extract events accordingly
 */
function detectAndExtract(data: any, sourceId: string): ParsedEvent[] {
  // Tixly API: { Events: [...], Productions: [...] }
  if (data && (data.Events || data.Productions)) {
    return extractFromTixlyApi(data, sourceId);
  }
  
  // Direct array of events
  if (Array.isArray(data)) {
    return data.map((item: any, idx: number) => ({
      id: `${sourceId}-${item.id || item.EventId || idx}`,
      title: item.name || item.title || item.Name || item.Title || 'Untitled',
      description: item.description || item.Description || '',
      startTime: item.startTime || item.startDate || item.StartDate || 
                 (item.dates?.[0] ? new Date(item.dates[0]).toISOString() : undefined),
      endTime: item.endTime || item.endDate || item.EndDate || undefined,
      url: item.url || item.link || item.Url || item.purchaseUrl || item.PurchaseUrl || '',
      imageUrl: item.imageUrl || item.image || item.ImageUrl || item.EventImagePath || '',
      venue: item.venue || item.location || item.Venue || item.Location || '',
      category: item.category || item.genre || item.Category || item.Genre || '',
      organizer: item.organizer || item.Organizer || '',
      price: item.price || (item.minPrice !== undefined ? { min: item.minPrice, max: item.maxPrice } : undefined),
      status: item.status || 'available',
      source: sourceId,
      sourceUrl: '',
      lastModified: new Date().toISOString(),
    })).filter((e: ParsedEvent) => e.title && e.title !== 'Untitled');
  }
  
  // Single event object
  if (data && typeof data === 'object') {
    return [data].map((item: any, idx: number) => ({
      id: `${sourceId}-${item.id || item.EventId || idx}`,
      title: item.name || item.title || item.Name || item.Title || 'Untitled',
      description: item.description || item.Description || '',
      startTime: item.startTime || item.startDate || item.StartDate || undefined,
      endTime: item.endTime || item.endDate || item.EndDate || undefined,
      url: item.url || item.link || item.Url || item.purchaseUrl || item.PurchaseUrl || '',
      imageUrl: item.imageUrl || item.image || item.ImageUrl || '',
      venue: item.venue || item.location || item.Venue || item.Location || '',
      category: item.category || item.genre || item.Category || item.Genre || '',
      organizer: item.organizer || item.Organizer || '',
      price: item.price || (item.minPrice !== undefined ? { min: item.minPrice, max: item.maxPrice } : undefined),
      status: item.status || 'available',
      source: sourceId,
      sourceUrl: '',
      lastModified: new Date().toISOString(),
    })).filter((e: ParsedEvent) => e.title && e.title !== 'Untitled');
  }
  
  return [];
}

/**
 * Fetch and extract events from an API endpoint
 */
export async function extractFromApi(
  apiUrl: string, 
  sourceId: string,
  options: { timeout?: number } = {}
): Promise<NetworkExtractResult> {
  const errors: string[] = [];
  
  try {
    const result = await fetchJson(apiUrl, { timeout: options.timeout || 15000 });
    
    if (!result.success || !result.data) {
      return {
        events: [],
        rawCount: 0,
        parseErrors: [`Failed to fetch API: ${result.error || 'Unknown error'}`],
        sourceUrl: sourceId,
        apiUrl,
      };
    }
    
    const events = detectAndExtract(result.data, sourceId);
    
    return {
      events,
      rawCount: Array.isArray(result.data) ? result.data.length : 1,
      parseErrors: errors,
      sourceUrl: sourceId,
      apiUrl,
    };
  } catch (err: any) {
    return {
      events: [],
      rawCount: 0,
      parseErrors: [`Exception: ${err.message}`],
      sourceUrl: sourceId,
      apiUrl,
    };
  }
}
