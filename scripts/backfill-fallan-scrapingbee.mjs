#!/usr/bin/env node
/**
 * Fållan.js-render description backfill (2026-10-02).
 *
 * Lärdom: Fållan-sidor (Webflow/Next.js) laddar description via JavaScript efter
 * page load. Worker-fetch får bara 15-30KB HTML där <h1>, <time> och en
 * cookiebot-pare finns. Den riktiga description (artist-info, "Now he is
 * coming to Stockholm..." etc.) renderas efter JS-execution.
 *
 * Fix: kör ScrapingBee med render_js=true + wait=5000 för att få den fulla
 * renderade HTML:an. Extrahera description genom att:
 *   1. Hitta alla textblock ≥100 chars
 *   2. Filtrera bort cookiebot, navigation, footer, marketing
 *   3. Välj de 2-4 längsta relevanta blocken
 *
 * Språkdetektering (Round 2 lärdom): Om description innehåller >30% svenska
 * ord/tecken → sätt som description_sv. Annars → description_en. Övriga lämnas null.
 * Inte båda-description-sv=en — vi vill ha originalspråket.
 *
 * Run: npx tsx scripts/backfill-fallan-scrapingbee.mjs [source1] [source2] ...
 *   Default targets: sthlmlist (där Fållan-sidor pekas via aggregator)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_KEY = process.env.SCRAPINGBEE_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE env'); process.exit(2); }
if (!SB_KEY) { console.error('Missing SCRAPINGBEE_API_KEY'); process.exit(2); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const TARGET_SOURCES = process.argv.length > 2
  ? process.argv.slice(2)
  : ['sthlmlist'];

const PAGE = 1000;

const EXCLUDE_RX = [
  /^Cookies?/i,
  /^Tracks? /i,
  /^Used by /i,
  /^This cookie/i,
  /^Lagen säger/i,
  /^Cookies för /i,
  /^Vi använder /i,
  /^En del av /i,
  /^Nödvändiga /i,
  /^Används av /i,
  /^Acceptera/i,
  /^Skip to content/i,
  /^navigation/i,
  /^\s*$/,
];

function isJunkText(text) {
  return EXCLUDE_RX.some(rx => rx.test(text));
}

/**
 * Enkel språkdetektering baserad på svenska indikatorer.
 * Returnerar 'sv' om texten är övervästlig svenska, annars 'en'.
 */
function detectLanguage(text) {
  const swedishChars = (text.match(/[åäöÅÄÖ]/g) || []).length;
  const swedishWords = (text.match(/\b(och|med|för|att|det|den|en|ett|som|i|är|har|denna|ska|kommer|spelar|kom|år|tid)\b/gi) || []).length;
  const totalWords = text.split(/\s+/).length;
  const swedishFraction = totalWords > 0 ? (swedishWords + swedishChars) / totalWords : 0;
  return swedishFraction > 0.03 ? 'sv' : 'en';
}

async function renderWithSB(url) {
  const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SB_KEY}&url=${encodeURIComponent(url)}&render_js=true&wait=5000`;
  const r = await fetch(apiUrl);
  if (!r.ok) {
    throw new Error(`SB ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`);
  }
  return await r.text();
}

/**
 * Extrahera description från rendered HTML.
 * Strategier:
 *   1. JSON-LD description (om finns)
 *   3. Long textblocks i body
 */
function extractDescription(html) {
  // 1. JSON-LD
  const jsonLdM = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || [];
  for (const block of jsonLdM) {
    const raw = block.replace(/^<script[^>]*>|<\/script>$/g, '');
    try {
      const data = JSON.parse(raw);
      const find = (obj, d = 0) => {
        if (d > 5 || !obj || typeof obj !== 'object') return null;
        if (typeof obj.description === 'string' && obj.description.length >= 80) return obj.description;
        for (const k of Object.keys(obj)) {
          const f = find(obj[k], d + 1);
          if (f) return f;
        }
        return null;
      };
      const desc = find(data);
      if (desc) return desc;
    } catch { /* ignore */ }
  }

  // 2. Textblocks
  let h = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, ' ');
  h = h.replace(/<style[^>]*>[\s\S]*?<\/style>/g, ' ');
  // Decode entities
  h = h.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  h = h.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  h = h.replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&aring;/g, 'å');
  h = h.replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Aring;/g, 'Å');

  // Find all textblocks (no tags inside)
  const textBlocks = h.match(/>([^<>{}\[\]]{80,})</g) || [];
  const candidates = [];
  for (const block of textBlocks) {
    const text = block.slice(1, -1).replace(/\s+/g, ' ').trim();
    if (isJunkText(text)) continue;
    if (text.length < 80) continue;
    candidates.push(text);
  }

  if (candidates.length === 0) return null;

  // Dedupe
  const unique = Array.from(new Set(candidates));

  // Ta de 2-3 längsta och konkatenera (utan upprepning)
  unique.sort((a, b) => b.length - a.length);
  if (unique.length >= 2 && unique[0].length + unique[1].length <= 1500) {
    return unique.slice(0, 3).join(' ');
  }
  return unique[0];
}

async function fetchEventsForSource(source) {
  const events = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('events')
      .select('id, ticket_url, description_sv, description_en')
      .eq('source', source)
      .not('ticket_url', 'is', null)
      .or('description_sv.is.null,description_sv.eq.,description_en.is.null,description_en.eq.')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    const filtered = data.filter(e =>
      !e.description_sv || e.description_sv.trim().length < 10 ||
      !e.description_en || e.description_en.trim().length < 10
    );
    events.push(...filtered);
    if (data.length < 1000) break;
    from += 1000;
  }
  return events;
}

async function main() {
  console.log(`[fallan-sb] BEGIN ${new Date().toISOString()}`);
  console.log(`[fallan-sb] targets: ${TARGET_SOURCES.join(', ')}`);

  let totalUpdated = 0, totalSkipped = 0, totalErrored = 0;
  const summary = [];

  for (const source of TARGET_SOURCES) {
    let events;
    try {
      events = await fetchEventsForSource(source);
    } catch (e) {
      console.log(`  [${source}] fetch failed: ${e.message}`);
      continue;
    }
    if (events.length === 0) {
      summary.push({ source, total: 0, updated: 0 });
      continue;
    }

    // Unika URLs
    const seen = new Set();
    const uniqUrls = [];
    for (const e of events) {
      if (!e.ticket_url || seen.has(e.ticket_url)) continue;
      seen.add(e.ticket_url);
      const ids = events.filter(x => x.ticket_url === e.ticket_url).map(x => x.id);
      uniqUrls.push({ url: e.ticket_url, ids });
    }
    console.log(`\n[${source}] ${events.length} events / ${uniqUrls.length} unique URLs`);

    let sourceUpdated = 0, sourceErrored = 0, sourceNoDesc = 0;
    for (const { url, ids } of uniqUrls) {
      try {
        const html = await renderWithSB(url);
        const desc = extractDescription(html);
        if (!desc || desc.length < 50) {
          sourceNoDesc++;
          continue;
        }
        const lang = detectLanguage(desc);
        const update = lang === 'sv'
          ? { description_sv: desc, description_en: null }
          : { description_sv: null, description_en: desc };
        const { error } = await supabase.from('events')
          .update(update)
          .in('id', ids);
        if (error) throw error;
        sourceUpdated += ids.length;
        totalUpdated += ids.length;
        console.log(`  [${lang}] ${url.slice(0, 70)} → ${ids.length} (${desc.length} chars)`);
      } catch (err) {
        sourceErrored++;
        totalErrored++;
        console.log(`  [err] ${url.slice(0, 70)}: ${err.message}`);
      }
    }

    console.log(`  [${source}] updated: ${sourceUpdated} | no-desc: ${sourceNoDesc} | errored: ${sourceErrored}`);
    summary.push({ source, total: events.length, updated: sourceUpdated });
    totalSkipped += sourceNoDesc;
  }

  console.log(`\n[fallan-sb] DONE`);
  console.log(`  total events updated: ${totalUpdated}`);
  console.log(`  total events no-desc: ${totalSkipped}`);
  console.log(`  total events errored: ${totalErrored}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });