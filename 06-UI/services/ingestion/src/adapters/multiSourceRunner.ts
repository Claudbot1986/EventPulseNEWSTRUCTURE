/**
 * Multi-Source Integration Runner
 * Connects all non-Ticketmaster sources to the MERGED pipeline
 * 
 * Usage:
 *   npx tsx src/adapters/multiSourceRunner.ts
 *   npx tsx src/adapters/multiSourceRunner.ts --source friendsarena
 *   npx tsx src/adapters/multiSourceRunner.ts --method wordpress
 */

import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import axios from 'axios';
import * as cheerio from 'cheerio';
import { rawEventsQueue } from '../queue';
import type { RawEventInput } from '@eventpulse/shared';

// Source configurations
const SOURCES = {
  // WordPress REST API
  friendsarena: {
    url: 'https://www.friendsarena.se/wp-json/wp/v2/events?per_page=50',
    method: 'wordpress' as const,
    venue: 'Friends Arena',
    address: 'Arena Road 1, 121 78 Johanneshov',
    area: 'Stockholm',
  },
  tele2arena: {
    url: 'https://www.tele2arena.se/wp-json/wp/v2/events?per_page=50',
    method: 'wordpress' as const,
    venue: 'Tele2 Arena',
    address: 'Globentorget 2, 121 77 Johanneshov',
    area: 'Stockholm',
  },

  // JSON-LD scraping
  annexet: {
    url: 'https://annexet.se/evenemang',
    method: 'json-ld' as const,
    venue: 'Annexet',
    address: '',
    area: 'Stockholm',
  },
  aviciiarena: {
    url: 'https://aviciiarena.se/evenemang',
    method: 'json-ld' as const,
    venue: 'Avicii Arena',
    address: '',
    area: 'Stockholm',
  },
  berwaldhallen: {
    url: 'https://www.berwaldhallen.se/kalender',
    method: 'json-ld' as const,
    venue: 'Berwaldhallen',
    address: '',
    area: 'Stockholm',
  },
  fryshuset: {
    url: 'https://fryshuset.se/evenemang',
    method: 'json-ld' as const,
    venue: 'Fryshuset',
    address: '',
    area: 'Stockholm',
  },
  slakthuset: {
    url: 'https://slakthusen.se',
    method: 'json-ld' as const,
    venue: 'Slakthuset',
    address: '',
    area: 'Stockholm',
  },
  sodrateatern: {
    url: 'https://sodrateatern.com/evenemang',
    method: 'json-ld' as const,
    venue: 'Södra Teatern',
    address: '',
    area: 'Stockholm',
  },
  stockholmlive: {
    url: 'https://stockholmlive.com/evenemang/',
    method: 'json-ld' as const,
    venue: 'Stockholm Live',
    address: '',
    area: 'Stockholm',
  },

  // Elasticsearch
  kulturhuset: {
    url: 'https://elastic.kulturhusetstadsteatern.se/khst-events/_search',
    method: 'elasticsearch' as const,
    venue: 'Kulturhuset Stadsteatern',
    address: '',
    area: 'Stockholm',
  },
  kulturhusetBarnUng: {
    url: 'https://elastic.kulturhusetstadsteatern.se/khst-events/_search',
    method: 'elasticsearch' as const,
    venue: 'Kulturhuset Stadsteatern',
    address: '',
    area: 'Stockholm',
    filter: 'barn',
  },

  // Direct API
  malmolive: {
    url: 'https://malmolive.se/api/events',
    method: 'api' as const,
    venue: 'Malmö Live',
    address: '',
    area: 'Malmö',
  },

  // HTML scraping
  malmoopera: {
    url: 'https://www.malmoopera.se/forestallningar',
    method: 'html' as const,
    venue: 'Malmö Opera',
    address: '',
    area: 'Malmö',
  },
  debaser: {
    url: 'https://debaser.se',
    method: 'html' as const,
    venue: 'Debaser',
    address: '',
    area: 'Stockholm',
  },
  fotografiska: {
    url: 'https://stockholm.fotografiska.com/sv/events',
    method: 'html' as const,
    venue: 'Fotografiska',
    address: 'Stadsgården, Södra Blasieholmen',
    area: 'Stockholm',
  },
};

interface SourceResult {
  name: string;
  method: string;
  status: 'success' | 'partial' | 'fail' | 'skipped';
  found: number;
  queued: number;
  errors: string[];
  duration: number;
}

/**
 * Fetch WordPress events
 */
async function fetchWordPress(source: keyof typeof SOURCES): Promise<RawEventInput[]> {
  const config = SOURCES[source];
  const events: RawEventInput[] = [];

  try {
    const resp = await axios.get(config.url, {
      timeout: 30000,
      headers: { 'User-Agent': 'EventPulse/1.0', 'Accept': 'application/json' },
    });

    if (resp.status !== 200) {
      console.log(`[${source}] HTTP ${resp.status}`);
      return events;
    }

    // Check if response is JSON array
    const data = resp.data;
    if (!Array.isArray(data)) {
      console.log(`[${source}] Response is not JSON array, type: ${typeof data}`);
      return events;
    }

    for (const ev of data) {
      try {
        const title = ev.title?.rendered || ev.title || '';
        if (!title) continue;

        const dateStr = ev.date || new Date().toISOString();
        const date = dateStr.split('T')[0];
        const time = new Date(dateStr).toTimeString().substring(0, 5);

        const description = ev.excerpt?.rendered
          ? ev.excerpt.rendered.replace(/<[^>]*>/g, '').trim()
          : '';

        events.push({
          source,
          source_id: `${source}-${ev.id}`,
          title,
          description: description.substring(0, 500),
          start_date: date,
          start_time: time,
          end_date: date,
          end_time: null,
          venue_name: config.venue,
          venue_city: config.area,
          venue_address: config.address || null,
          venue_lat: null,
          venue_lng: null,
          categories: inferCategory(source, title),
          is_free: null,
          price_min_sek: null,
          price_max_sek: null,
          ticket_url: ev.link || null,
          image_url: null,
          detected_language: 'sv',
          raw_payload: ev,
        });
      } catch (e) {
        // Skip invalid events
      }
    }
  } catch (e: any) {
    console.error(`[${source}] Fetch error:`, e.message);
  }

  return events;
}

/**
 * Fetch JSON-LD events
 */
async function fetchJsonLd(source: keyof typeof SOURCES): Promise<RawEventInput[]> {
  const config = SOURCES[source];
  const events: RawEventInput[] = [];

  try {
    const resp = await axios.get(config.url, {
      timeout: 30000,
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });

    if (resp.status !== 200) {
      return events;
    }

    const html = resp.data;
    const $ = cheerio.load(html);

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $(el).html();
        if (!content) return;
        const data = JSON.parse(content);

        let items: any[] = [];

        // Extract based on structure
        if (data['@type'] === 'ItemList' && data.itemListElement) {
          items = data.itemListElement
            .filter((x: any) => x.item?.['@type'] === 'Event')
            .map((x: any) => x.item);
        } else if (data['@graph']) {
          items = data['@graph'].filter((x: any) => x['@type'] === 'Event');
        } else if (data['@type'] === 'EventSeries' && data.subEvent) {
          items = data.subEvent.filter((x: any) => x['@type'] === 'Event');
        } else if (data['@type'] === 'Event') {
          items = [data];
        }

        for (const item of items) {
          if (!item.name) continue;

          const startDate = item.startDate || '';
          const date = startDate.split('T')[0];
          const time = startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) || '' : '';

          events.push({
            source,
            source_id: `${source}-${item.name.replace(/\s+/g, '-').substring(0, 30)}-${date}`,
            title: item.name,
            description: item.description || '',
            start_date: date,
            start_time: time,
            end_date: date,
            end_time: null,
            venue_name: item.location?.name || config.venue,
            venue_city: item.location?.address?.addressLocality || config.area,
            venue_address: item.location?.address?.streetAddress || config.address || null,
            venue_lat: item.location?.geo?.latitude ? parseFloat(item.location.geo.latitude) : null,
            venue_lng: item.location?.geo?.longitude ? parseFloat(item.location.geo.longitude) : null,
            categories: ['culture'],
            is_free: null,
            price_min_sek: null,
            price_max_sek: null,
            ticket_url: item.url || null,
            image_url: null,
            detected_language: 'sv',
            raw_payload: item,
          });
        }
      } catch (e) {
        // Skip malformed JSON
      }
    });
  } catch (e: any) {
    console.error(`[${source}] Fetch error:`, e.message);
  }

  return events;
}

/**
 * Fetch Elasticsearch events
 */
async function fetchElasticsearch(source: keyof typeof SOURCES): Promise<RawEventInput[]> {
  const config = SOURCES[source];
  const events: RawEventInput[] = [];

  // Add category filter for Barn & Ung
  const must: any[] = [{ range: { tixStartDate: { gte: 'now' } } }];
  if (config.filter === 'barn') {
    must.push({ term: { 'drupalCategory.label': 'Barn & ung' } });
  }

  try {
    const resp = await axios.post(
      config.url,
      {
        size: 50,
        query: { bool: { must } },
        sort: [{ tixStartDate: { order: 'asc' } }],
      },
      {
        timeout: 30000,
        headers: { 'User-Agent': 'EventPulse/1.0', 'Content-Type': 'application/json' },
      }
    );

    if (resp.status !== 200 || !resp.data?.hits?.hits) {
      return events;
    }

    for (const hit of resp.data.hits.hits) {
      const item = hit._source;
      if (!item) continue;

      const title = item.drupalTitle || item.tixName || '';
      if (!title) continue;

      const startDate = item.tixStartDate || '';
      const date = startDate.split('T')[0];
      const time = startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) || '' : '';

      events.push({
        source,
        source_id: `${source}-${item.tixEventId || hit._id}`,
        title,
        description: item.drupalLeadText?.[0]?.value || '',
        start_date: date,
        start_time: time,
        end_date: date,
        end_time: null,
        venue_name: item.tixVenue?.[0]?.label || config.venue,
        venue_city: item.drupalLocation?.[0]?.label || config.area,
        venue_address: config.address || null,
        venue_lat: null,
        venue_lng: null,
        categories: mapCategory(item.drupalCategory?.[0]?.label),
        is_free: null,
        price_min_sek: null,
        price_max_sek: null,
        ticket_url: item.drupalLink || null,
        image_url: null,
        detected_language: 'sv',
        raw_payload: item,
      });
    }
  } catch (e: any) {
    console.error(`[${source}] Fetch error:`, e.message);
  }

  return events;
}

/**
 * Map category from various formats
 */
function mapCategory(categoryLabel: string | string[] | undefined): string[] {
  if (!categoryLabel) return ['culture'];
  
  const label = Array.isArray(categoryLabel) ? categoryLabel[0] : categoryLabel;
  const lower = label.toLowerCase();
  
  if (lower.includes('musik') || lower.includes('konsert') || lower.includes('jazz') || lower.includes('pop')) {
    return ['music'];
  }
  if (lower.includes('teatr') || lower.includes('dans')) {
    return ['theatre'];
  }
  if (lower.includes('film')) {
    return ['film'];
  }
  if (lower.includes('barn') || lower.includes('familj')) {
    return ['family'];
  }
  if (lower.includes('sport')) {
    return ['sports'];
  }
  if (lower.includes('mat') || lower.includes('food')) {
    return ['food-drink'];
  }
  
  return ['culture'];
}

/**
 * Infer category from title
 */
function inferCategory(source: string, title: string): string[] {
  const lower = title.toLowerCase();
  
  if (lower.includes('konsert') || lower.includes('concert') || lower.includes('live')) {
    return ['music'];
  }
  if (lower.includes('fotboll') || lower.includes('football') || lower.includes('sport')) {
    return ['sports'];
  }
  if (lower.includes('teatr') || lower.includes('teater')) {
    return ['theatre'];
  }
  
  return ['culture'];
}

/**
 * Fetch from direct API
 */
async function fetchApi(source: keyof typeof SOURCES): Promise<RawEventInput[]> {
  const config = SOURCES[source];
  const events: RawEventInput[] = [];

  try {
    const resp = await axios.get(config.url, {
      timeout: 30000,
      headers: { 'User-Agent': 'EventPulse/1.0', 'Accept': 'application/json' },
    });

    const data = resp.data;
    const items = Array.isArray(data) ? data : (data?.data || []);

    for (const item of items) {
      const title = item.title || item.name || '';
      if (!title) continue;

      const startDate = item.field_date_time || item.startDate || '';
      const date = startDate.split('T')[0];
      const time = startDate.includes('T') ? startDate.split('T')[1]?.substring(0, 5) || '' : '';

      events.push({
        source,
        source_id: `${source}-${item.tessitura_event_id || item.id || Math.random()}`,
        title,
        description: item.field_text_plain_long || item.description || '',
        start_date: date,
        start_time: time,
        end_date: date,
        end_time: null,
        venue_name: item.field_venue || config.venue,
        venue_city: config.area,
        venue_address: config.address || null,
        venue_lat: null,
        venue_lng: null,
        categories: mapCategory(item.field_keywords_target_id),
        is_free: null,
        price_min_sek: null,
        price_max_sek: null,
        ticket_url: item.view_node ? `https://malmolive.se${item.view_node}` : null,
        image_url: null,
        detected_language: 'sv',
        raw_payload: item,
      });
    }
  } catch (e: any) {
    console.error(`[${source}] Fetch error:`, e.message);
  }

  return events;
}

/**
 * Fetch HTML-based events (link extraction)
 */
async function fetchHtml(source: keyof typeof SOURCES): Promise<RawEventInput[]> {
  const config = SOURCES[source];
  const events: RawEventInput[] = [];

  try {
    const resp = await axios.get(config.url, {
      timeout: 30000,
      headers: { 'User-Agent': 'EventPulse/1.0' },
    });

    if (resp.status !== 200) {
      return events;
    }

    const html = resp.data;
    const $ = cheerio.load(html);

    // Extract event links
    const eventLinks: { href: string; text: string }[] = [];
    $(`a[href*="event"], a[href*="forestallning"], a[href*="evenemang"], a[href*="show"]`).each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href && text && text.length > 3) {
        eventLinks.push({ href, text });
      }
    });

    // Deduplicate by text
    const seen = new Set<string>();
    for (const link of eventLinks) {
      if (seen.has(link.text)) continue;
      seen.add(link.text);

      events.push({
        source,
        source_id: `${source}-${link.text.replace(/\s+/g, '-').substring(0, 30)}`,
        title: link.text,
        description: '',
        start_date: new Date().toISOString().split('T')[0],
        start_time: '',
        end_date: new Date().toISOString().split('T')[0],
        end_time: null,
        venue_name: config.venue,
        venue_city: config.area,
        venue_address: config.address || null,
        venue_lat: null,
        venue_lng: null,
        categories: ['culture'],
        is_free: null,
        price_min_sek: null,
        price_max_sek: null,
        ticket_url: link.href.startsWith('http') ? link.href : `${config.url}${link.href}`,
        image_url: null,
        detected_language: 'sv',
        raw_payload: { url: link.href, text: link.text },
      });
    }
  } catch (e: any) {
    console.error(`[${source}] Fetch error:`, e.message);
  }

  return events;
}

/**
 * Run a single source
 */
async function runSource(sourceName: keyof typeof SOURCES): Promise<SourceResult> {
  const config = SOURCES[sourceName];
  const start = Date.now();

  const result: SourceResult = {
    name: sourceName,
    method: config.method,
    status: 'skipped',
    found: 0,
    queued: 0,
    errors: [],
    duration: 0,
  };

  console.log(`[${sourceName}] Fetching via ${config.method}...`);

  let events: RawEventInput[] = [];

  switch (config.method) {
    case 'wordpress':
      events = await fetchWordPress(sourceName);
      break;
    case 'json-ld':
      events = await fetchJsonLd(sourceName);
      break;
    case 'elasticsearch':
      events = await fetchElasticsearch(sourceName);
      break;
    case 'api':
      events = await fetchApi(sourceName);
      break;
    case 'html':
      events = await fetchHtml(sourceName);
      break;
  }

  result.found = events.length;
  console.log(`[${sourceName}] Found ${events.length} events`);

  // Queue events
  for (const event of events) {
    try {
      await rawEventsQueue.add(`${sourceName}:${event.source_id}`, event);
      result.queued++;
    } catch (e: any) {
      result.errors.push(e.message);
    }
  }

  result.status = result.queued > 0 ? 'success' : (result.found > 0 ? 'partial' : 'fail');
  result.duration = Date.now() - start;

  console.log(`[${sourceName}] Queued ${result.queued}/${result.found} events in ${result.duration}ms`);

  return result;
}

/**
 * Run all sources
 */
async function runAll(): Promise<SourceResult[]> {
  console.log('==================================================');
  console.log('MULTI-SOURCE INTEGRATION RUNNER');
  console.log('==================================================\n');

  const results: SourceResult[] = [];

  for (const sourceName of Object.keys(SOURCES) as (keyof typeof SOURCES)[]) {
    const result = await runSource(sourceName);
    results.push(result);
    console.log('');
  }

  return results;
}

/**
 * Print summary
 */
function printSummary(results: SourceResult[]): void {
  console.log('\n==================================================');
  console.log('SUMMARY');
  console.log('==================================================');
  console.log('Source           | Method        | Status   | Found | Queued');
  console.log('-----------------|---------------|----------|-------|--------');

  for (const r of results) {
    console.log(
      `${r.name.padEnd(16)} | ${r.method.padEnd(13)} | ${r.status.padEnd(8)} | ${String(r.found).padStart(5)} | ${String(r.queued).padStart(5)}`
    );
  }

  const totals = results.reduce(
    (acc, r) => ({ found: acc.found + r.found, queued: acc.queued + r.queued }),
    { found: 0, queued: 0 }
  );

  console.log('-----------------|---------------|----------|-------|--------');
  console.log(`TOTAL            |               |          | ${String(totals.found).padStart(5)} | ${String(totals.queued).padStart(5)}`);

  const success = results.filter(r => r.status === 'success').length;
  const partial = results.filter(r => r.status === 'partial').length;
  const fail = results.filter(r => r.status === 'fail').length;

  console.log(`\nStatus: ${success} success, ${partial} partial, ${fail} failed`);
}

// Parse command line args
const args = process.argv.slice(2);
const runSpecific = args.includes('--source');
const runMethod = args.find(a => a.startsWith('--method='));

async function main() {
  let results: SourceResult[];

  if (runMethod) {
    const method = runMethod.split('=')[1] as 'wordpress' | 'json-ld' | 'elasticsearch' | 'api' | 'html';
    console.log(`Running all ${method} sources...`);
    results = [];
    for (const [name, config] of Object.entries(SOURCES)) {
      if (config.method === method) {
        const result = await runSource(name as keyof typeof SOURCES);
        results.push(result);
      }
    }
  } else {
    results = await runAll();
  }

  printSummary(results);
}

main().catch(console.error);
