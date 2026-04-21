/**
 * Source Tester - Test all non-Ticketmaster sources
 * Run with: npx tsx test-sources.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import axios from 'axios';
import * as cheerio from 'cheerio';

async function testFetch(url: string, name: string): Promise<{ success: boolean; status?: number; error?: string }> {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'EventPulse/1.0 Test' },
    });
    return { success: response.status === 200, status: response.status };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function testJsonLd(url: string, name: string): Promise<{ found: number; events: string[] }> {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'EventPulse/1.0 Test' },
    });

    if (response.status !== 200) {
      return { found: 0, events: [] };
    }

    const html = response.data;
    const $ = cheerio.load(html);
    let count = 0;
    const titles: string[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $(el).html();
        if (!content) return;
        const data = JSON.parse(content);

        // Check ItemList
        if (data['@type'] === 'ItemList' && data.itemListElement) {
          for (const item of data.itemListElement) {
            if (item.item?.['@type'] === 'Event' && item.item.name) {
              count++;
              if (titles.length < 3) titles.push(item.item.name);
            }
          }
        }

        // Check @graph
        if (data['@graph']) {
          for (const item of data['@graph']) {
            if (item['@type'] === 'Event' && item.name) {
              count++;
              if (titles.length < 3) titles.push(item.name);
            }
          }
        }

        // Check EventSeries
        if (data['@type'] === 'EventSeries' && data.subEvent) {
          for (const sub of data.subEvent) {
            if (sub['@type'] === 'Event' && sub.name) {
              count++;
              if (titles.length < 3) titles.push(sub.name);
            }
          }
        }

        // Check direct Event
        if (data['@type'] === 'Event' && data.name) {
          count++;
          if (titles.length < 3) titles.push(data.name);
        }
      } catch (e) {
        // Skip
      }
    });

    return { found: count, events: titles };
  } catch (err: any) {
    return { found: 0, events: [] };
  }
}

async function testWordPress(url: string, name: string): Promise<{ found: number; events: string[] }> {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'EventPulse/1.0 Test', 'Accept': 'application/json' },
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      return { found: 0, events: [] };
    }

    const events = response.data.slice(0, 5);
    const titles = events.map((e: any) => e.title?.rendered || e.title || 'untitled');

    return { found: response.data.length, events: titles };
  } catch (err: any) {
    return { found: 0, events: [] };
  }
}

async function testElasticsearch(url: string, name: string): Promise<{ found: number; events: string[] }> {
  try {
    const query = {
      size: 20,
      query: {
        bool: {
          must: [{ range: { tixStartDate: { gte: 'now' } } }],
        },
      },
      sort: [{ tixStartDate: { order: 'asc' } }],
    };

    const response = await axios.post(url, query, {
      timeout: 15000,
      headers: { 'User-Agent': 'EventPulse/1.0 Test', 'Content-Type': 'application/json' },
    });

    if (response.status !== 200 || !response.data?.hits?.hits) {
      return { found: 0, events: [] };
    }

    const hits = response.data.hits.hits;
    const titles = hits.slice(0, 3).map((h: any) => h._source?.drupalTitle || h._source?.tixName || 'untitled');

    return { found: hits.length, events: titles };
  } catch (err: any) {
    return { found: 0, events: [] };
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('NON-TICKETMASTER SOURCE TESTER');
  console.log('==================================================\n');

  const sources = [
    // WordPress REST API
    { name: 'friendsarena', url: 'https://www.friendsarena.se/wp-json/wp/v2/events?per_page=50', method: 'wordpress' },
    { name: 'tele2arena', url: 'https://www.tele2arena.se/wp-json/wp/v2/events?per_page=50', method: 'wordpress' },

    // JSON-LD scraping
    { name: 'annexet', url: 'https://annexet.se/evenemang', method: 'json-ld' },
    { name: 'aviciiarena', url: 'https://aviciiarena.se/evenemang', method: 'json-ld' },
    { name: 'berwaldhallen', url: 'https://www.berwaldhallen.se/kalender', method: 'json-ld' },
    { name: 'fryshuset', url: 'https://fryshuset.se/evenemang', method: 'json-ld' },
    { name: 'slakthuset', url: 'https://slakthusen.se', method: 'json-ld' },
    { name: 'sodrateatern', url: 'https://sodrateatern.com/evenemang', method: 'json-ld' },
    { name: 'stockholmlive', url: 'https://stockholmlive.com/evenemang/', method: 'json-ld' },

    // Elasticsearch
    { name: 'kulturhuset', url: 'https://elastic.kulturhusetstadsteatern.se/khst-events/_search', method: 'elasticsearch' },
    { name: 'kulturhusetBarnUng', url: 'https://elastic.kulturhusetstadsteatern.se/khst-events/_search', method: 'elasticsearch' },

    // Direct API
    { name: 'malmolive', url: 'https://malmolive.se/api/events', method: 'api' },

    // HTML scraping
    { name: 'malmoopera', url: 'https://www.malmoopera.se/forestallningar', method: 'html' },
    { name: 'debaser', url: 'https://debaser.se', method: 'html' },
    { name: 'fotografiska', url: 'https://stockholm.fotografiska.com/sv/events', method: 'html' },
  ];

  const results: any[] = [];

  for (const source of sources) {
    console.log(`Testing ${source.name} (${source.method})...`);
    
    const fetchResult = await testFetch(source.url, source.name);
    
    let testResult = {
      name: source.name,
      method: source.method,
      url: source.url,
      fetchSuccess: fetchResult.success,
      fetchStatus: fetchResult.status,
      fetchError: fetchResult.error,
      eventsFound: 0,
      eventTitles: [] as string[],
    };

    if (fetchResult.success) {
      switch (source.method) {
        case 'wordpress':
          const wpResult = await testWordPress(source.url, source.name);
          testResult.eventsFound = wpResult.found;
          testResult.eventTitles = wpResult.events;
          break;
        case 'json-ld':
          const jsonLdResult = await testJsonLd(source.url, source.name);
          testResult.eventsFound = jsonLdResult.found;
          testResult.eventTitles = jsonLdResult.events;
          break;
        case 'elasticsearch':
          const esResult = await testElasticsearch(source.url, source.name);
          testResult.eventsFound = esResult.found;
          testResult.eventTitles = esResult.events;
          break;
        case 'api':
          // Already fetched above
          break;
        case 'html':
          // Already fetched, need to parse
          break;
      }
    }

    results.push(testResult);
    console.log(`  -> ${fetchResult.success ? 'OK' : 'FAIL'}: ${testResult.eventsFound} events\n`);
  }

  // Print summary table
  console.log('\n==================================================');
  console.log('SUMMARY TABLE');
  console.log('==================================================');
  console.log('Source           | Method       | Fetch | Events | Sample Title');
  console.log('-----------------|--------------|-------|--------|------------');

  for (const r of results) {
    const name = r.name.padEnd(16);
    const method = r.method.padEnd(12);
    const fetch = r.fetchSuccess ? 'OK' : 'FAIL';
    const events = String(r.eventsFound).padStart(6);
    const title = r.eventTitles[0]?.substring(0, 30) || '-';
    console.log(`${name} | ${method} | ${fetch.padStart(5)} | ${events} | ${title}`);
  }

  // Categorize by status
  const working = results.filter(r => r.fetchSuccess && r.eventsFound > 0);
  const partial = results.filter(r => r.fetchSuccess && r.eventsFound === 0);
  const failed = results.filter(r => !r.fetchSuccess);

  console.log('\n==================================================');
  console.log('STATUS CATEGORIES');
  console.log('==================================================');
  console.log(`WORKING (${working.length}): ${working.map(s => s.name).join(', ')}`);
  console.log(`PARTIAL (${partial.length}): ${partial.map(s => s.name).join(', ')}`);
  console.log(`FAILED (${failed.length}): ${failed.map(s => s.name).join(', ')}`);

  // Save results
  console.log('\n==================================================');
  console.log('Test complete!');
  console.log('==================================================');

  return results;
}

runTests().catch(console.error);
