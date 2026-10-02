#!/usr/bin/env node
/**
 * Deep description backfill — multi-strategy (Round 2 utökning).
 *
 * Tidigare backfills missade många sidor pga:
  - Trasig JSON-LD (Webflow-sajter som Fållan) → JSON.parse kraschar → 0 events
  - H1-baserad single-event-sida (ingen article/time/microdata) → C1 hittar inget → body fallback triggas aldrig
  - Body-fallback kräver events-detect först → om 0 events, ingen description alls
 *
 * Denna script gör en aggressiv multi-strategy description extraction oavsett
 * om universal-extractor hittar events eller inte.
 *
 * Strategier (i ordning):
 *   1. JSON-LD description (även om JSON är trasig — försök parsa tolerant)
 *   3. <meta property="og:description">
 *   4. <meta name="description">
 *   5. Första <p> med >=100 tecken (även om universal-extractor hittar 0 events)
 *   6. H1 + datum + första paragraf (även för single-event-sidor)
 *
 * Run:
 *   npx tsx scripts/backfill-descriptions-deep.mjs [batch-arg]
 *
 * Batch-arg (CLI): lista på sources (default = alla gap-källor).
 * Används för parallell exekvering med multipla workers.
 */

import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing env'); process.exit(2); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ─── Strategy 1: Robust JSON-LD parsing ─────────────────────────────────────
// Tolerate broken JSON-LD by extracting the description substring via regex.

function extractFromBrokenJsonLd(html) {
  // First try normal parse
  const $ = cheerio.load(html);
  let found = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html() || '';
    try {
      const data = JSON.parse(content);
      // Recursively search for description field
      const desc = findDescriptionDeep(data);
      if (desc && desc.length >= 10) found = desc;
    } catch {
      // Try regex extraction (handles broken JSON like fallan.nu)
      const m = content.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m && m[1].length >= 20) {
        found = m[1]
          .replace(/\\"/g, '"')
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
          .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&aring;/g, 'å').replace(/&quot;/g, '"');
  }
    }
  });
  return found;
}

function findDescriptionDeep(obj, depth = 0) {
  if (depth > 10) return null;
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.description === 'string' && obj.description.length >= 10) return obj.description;
  for (const key of Object.keys(obj)) {
    const found = findDescriptionDeep(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

// ─── Strategy 2-4: Meta tags ────────────────────────────────────────────────

// 2026-10-02 — Template-meta-filter (Round 2 lärdom). Live Nation-sajter
// (gotalejon.se, ticketmaster, livenation.se m.fl.) använder en generic
// template-meta istället för riktig event-beskrivning. Dessa måste INTE
// prioriteras över body — body har den riktiga description.
// Filter känner
const META_TEMPLATE_RX = [
  /^Find\s+\S+\s+tickets at[^|]+\|\s*Videos, biography, tour dates/i,
  /^Find\s+\S+\s+tickets at/i,
  /^Tickets?\s+for[^.]+\.\s*$/i,  // "Tickets for X." utan info
  /tour dates, performance times/i,
  /^Buy\s+\S+\s+tickets[^.]+\.\s*$/i,
];

function isTemplateMeta(text) {
  return META_TEMPLATE_RX.some(rx => rx.test(text));
}

function extractFromMetaTags(html) {
  const $ = cheerio.load(html);
  const og = $('meta[property="og:description"]').attr('content');
  if (og && og.trim().length >= 20 && !isTemplateMeta(og.trim())) return og.trim();
  const meta = $('meta[name="description"]').attr('content');
  if (meta && meta.trim().length >= 20 && !isTemplateMeta(meta.trim())) return meta.trim();
  return null;
}

// ─── Strategy 5-6: Body content ──────────────────────────────────────────────

// Filtrer: 6 — Round 2 lärdom (spelning.se). Filtrera bort skräp som ofta
// contaminates body-paragrafer på konsert-listingsajter:
//   - Sektionsrubriker: "OM KONSERTEN", "OM EVENTET", "OM FÖRESTÄLLNINGEN"
//   - Kategorier: "POP", "ROCK", "MUSIK", "JAZZ" etc.
//   - Prisinfo: "Biljetter från 895 kr", "Pris: 100 kr"
//   - Disclaimer: "Annonslänk", "Uppdaterades för X månader sedan"
const JUNK_RX = [
  /^(OM KONSERTEN|OM EVENTET|OM FÖRESTÄLLNINGEN|OM EVENT|BESKRIVNING|INFO)\s*$/i,
  /^(POP|ROCK|MUSIK|JAZZ|CLASSICAL|METAL|INDIE|ELECTRONIC|FOLK|OPERETT|HIP-HOP|COUNTRY|BLUE|SOUL)\s*$/i,
  /Biljetter (från|kostar|till|sedan)/i,
  /^Pris\s*[:.]/i,
  /Uppdaterades för/i,
  /^Annonslänk\.?/i,
  /^Annons\.?\s/i,
];

function isJunkParagraph(text) {
  return JUNK_RX.some(rx => rx.test(text));
}

function extractFromBody(html) {
  const $ = cheerio.load(html);

  // Strip script/style/nav/header/footer
  $('script, style, nav, header, footer, aside, [role="navigation"], [aria-hidden="true"]').remove();

  const SWEDISH_RX = /[åäöÅÄÖ]/;
  const candidates = [];
  $('p').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text.length < 30) return;
    if (text.includes('{') || text.includes('function()')) return;
    if (isJunkParagraph(text)) return;
    candidates.push({ text, isSv: SWEDISH_RX.test(text), len: text.length });
  });

  if (candidates.length > 0) {
    // Filtrera bort korta paragrafer (<50 chars) — ofta etiketter
    const meaningful = candidates.filter(c => c.len >= 50);
    if (meaningful.length > 0) {
      meaningful.sort((a, b) => b.len - a.len);
      // Konkatenera de 2-3 bästa om de får rimspruta
      if (meaningful.length >= 2 && meaningful[0].len + meaningful[1].len <= 1500) {
        return meaningful.slice(0, 3).map(p => p.text).join(' ');
      }
      return meaningful[0].text;
    }
  }

  // Try main/article fallback
  const articleText = $('main, [role="main"], article').first().text()
    .replace(/\s+/g, ' ').trim();
  if (articleText.length >= 100) return articleText.slice(0, 800);

  // Last resort
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  if (bodyText.length >= 100) return bodyText.slice(0, 800);

  return null;
}

// ─── Worker fetch ────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  try {
    const r = await fetch('https://eventpulse-fetch-worker.eventpulsefetch.workers.dev/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// ─── Main strategy pipeline ──────────────────────────────────────────────────

async function findDescription(html) {
  if (!html || html.length < 200) return null;

  const jsonLd = extractFromBrokenJsonLd(html);
  const meta = extractFromMetaTags(html);
  const body = extractFromBody(html);

  // 2026-10-02 — Round 2 lärdom (spelning.se): JSON-LD description kan vara
  // kort ("6 föreställningar...") men body innehåller utförligartigare text
  // (artist-info, beskrivning, "OM KONSERTEN" + kategorier). Om JSON-LD är
  // <300 chars, konkatenera med body om body utgör en fullständsk beskrivning.
  if (jsonLd && jsonLd.length >= 300) {
    return jsonLd;
  }

  // Om body har bättre text, använd den (eller konkatenera)
  if (body && body.length >= 200) {
    // Konkatenera om båda är rimligt långa
    if (jsonLd && jsonLd.length >= 50 && (jsonLd.length + body.length) <= 1500) {
      return `${jsonLd} ${body}`;
    }
    return body;
  }

  return jsonLd || meta;
}

// ─── Database operations ──────────────────────────────────────────────────────────

const DEFAULT_SOURCES = [
  'sthlmlist', 'gota-lejon', 'gratisistockholm', 'kultur-stockholm',
  'jarfalla', 'sodrateatern', 'china-teatern', 'konstkalendern', 'intiman',
  'medborgarhuset-2', 'fasching', 'eventbrite-discovery', 'arkdes',
  'thatsup-stockholm-articles', 'allevents-in', 'spelning-se', 'kth-2',
  'berwaldhallen', 'lokalhelhet-calendar', 'staffan', 'lysekil',
  'kultur-stockholm-calendar'
];

const TARGET_SOURCES = process.argv.length > 2
  ? process.argv.slice(2)
  : DEFAULT_SOURCES;

async function fetchEventsForSource(source) {
  const events = [];
  let from = 0;
  while (true) {
    // 2026-10-02 — hämta events där description_sv ELLER description_en är
    // null ELLER tom sträng (""). Tidig är inte klar filtrera bort "" —
    // description="" är samma sak som "no description" för vårt syfte.
    const { data, error } = await supabase.from('events')
      .select('id, ticket_url, description_sv, description_en')
      .eq('source', source)
      .not('ticket_url', 'is', null)
      .or('description_sv.is.null,description_sv.eq.,description_en.is.null,description_en.eq.')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    // Säkrar vid NULL/empty i JavaScript efter hämtning (försvar i djuplösht)
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
  const startTime = Date.now();
  console.log(`[backfill-deep] BEGIN ${new Date().toISOString()}`);
  console.log(`[backfill-deep] targets: ${TARGET_SOURCES.join(', ')}`);

  let totalUpdated = 0, totalNoUrl = 0, totalNoDesc = 0, totalErrored = 0;
  const summary = [];

  for (const source of TARGET_SOURCES) {
    const sourceStart = Date.now();
    let events;
    try {
      events = await fetchEventsForSource(source);
    } catch (e) {
      console.log(`  [${source}] fetch failed: ${e.message}`);
      continue;
    }
    if (events.length === 0) {
      summary.push({ source, total: 0, updated: 0, noDesc: 0 });
      continue;
    }

    let sourceUpdated = 0, sourceNoDesc = 0;
    const seen = new Set();
    const uniqUrls = [];
    for (const e of events) {
      if (seen.has(e.ticket_url)) continue;
      seen.add(e.ticket_url);
      uniqUrls.push({ url: e.ticket_url, ids: events.filter(x => x.ticket_url === e.ticket_url).map(x => x.id) });
    }
    console.log(`\n[${source}] ${events.length} events / ${uniqUrls.length} unique URLs`);

    for (const { url, ids } of uniqUrls) {
      try {
        const html = await fetchHtml(url);
        if (!html || html.length < 200) {
          sourceNoDesc++;
          continue;
        }
        const desc = await findDescription(html);
        if (!desc || desc.length < 20) {
          sourceNoDesc++;
          continue;
        }
        const { error } = await supabase.from('events')
          .update({ description_sv: desc, description_en: desc })
          .in('id', ids);
        if (error) throw error;
        sourceUpdated += ids.length;
      } catch (e) {
        sourceNoDesc++;
      }
    }

    console.log(`  [${source}] updated ${sourceUpdated} | no-desc ${sourceNoDesc} | ${Math.round((Date.now() - sourceStart)/1000)}s`);
    summary.push({ source, total: events.length, updated: sourceUpdated, noDesc: sourceNoDesc });
    totalUpdated += sourceUpdated;
    totalNoDesc += sourceNoDesc;
  }

  console.log(`\n[backfill-deep] DONE in ${Math.round((Date.now() - startTime)/1000)}s`);
  console.log(`  Total updated: ${totalUpdated}`);
  console.log(`  Total no-description-found: ${totalNoDesc}`);
  console.log('\nPer source:');
  for (const s of summary) {
    if (s.total === 0) continue;
    console.log(`  ${s.source.padEnd(35)} ${s.updated} av ${s.total} (no-desc: ${s.noDesc})`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });