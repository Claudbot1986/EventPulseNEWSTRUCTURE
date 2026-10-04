#!/usr/bin/env node
/**
 * mines-description-urls.mjs — Hittar nya event-källor genom att leta efter
 * URL:ar i event-beskrivningar som vi inte redan har som källa.
 *
 * Mönster:
 *  - SQL: hämta description_sv från events_public där description_sv LIKE '%http%'
 *  - Regex extraktion av alla URLs
 *  - Filtrera bort kända domäner (nortic, tickster, ticketmaster, kulturhuset, etc.)
 *  - Generera rapport med nya hosts
 *
 * Användning:
 *   node scripts/mine-description-urls.mjs
 *   node scripts/mine-description-urls.mjs --limit=500
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const KNOWN_DOMAINS = new Set([
  'nortic.se', 'eventbrite.com', 'eventbrite.se', 'ticketmaster.com', 'ticketmaster.se',
  'tickster.com', 'kulturhuset.se', 'stadsteatern.se', 'dramaten.se', 'fb.me',
  'facebook.com', 'fb.com', 'instagram.com', 'youtube.com', 'youtu.be',
  'twitter.com', 'x.com', 'tiktok.com', 'lu.ma', 'posh.vip',
  'konserthuset.se', 'berwaldhallen.se', 'kulturhuset-stadsteatern.se',
  'goteborg.se', 'sv.wikipedia.org', 'no.wikipedia.org', 'en.wikipedia.org',
  'maps.google.com', 'goo.gl', 'bit.ly',
]);

const SUB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUB || !SK) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUB, SK, { auth: { persistSession: false } });

function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

const URL_RE = /https?:\/\/[^\s<>"\)\]]+/g;

async function main() {
  const limit = parseInt((process.argv.find((a) => a.startsWith('--limit=')) ?? '--limit=2000').split('=')[1], 10);

  console.log(`Scanning ${limit} events with URLs in descriptions...`);
  const { data, error } = await supabase
    .from('events_public')
    .select('id, source, ticket_url, description_sv, description_en')
    .or('description_sv.like.%http%,description_en.like.%http%,ticket_url.like.%http%')
    .limit(limit);

  if (error) {
    console.error('DB error:', error.message);
    process.exit(2);
  }

  const hostCounts = new Map();
  const samples = new Map();

  for (const ev of data || []) {
    const texts = [ev.description_sv, ev.description_en, ev.ticket_url].filter(Boolean);
    for (const t of texts) {
      for (const url of t.match(URL_RE) || []) {
        const h = hostname(url);
        if (!h) continue;
        if (KNOWN_DOMAINS.has(h)) continue;
        // Skip internal/well-known non-event domains
        if (/(google|youtube|instagram|facebook|twitter|wikipedia|goo\.gl|bit\.ly|youtube|yahoo|microsoft|apple|amazon|w3\.org|schema|wixstatic|cloudfront|amazonaws|jsdelivr|cloudflare|googletagmanager|google-analytics|hotjar|stripe|paypal)/.test(h)) continue;
        hostCounts.set(h, (hostCounts.get(h) || 0) + 1);
        if (!samples.has(h)) samples.set(h, { url, source: ev.source });
      }
    }
  }

  const sorted = [...hostCounts.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`\n=== TOP CANDIDATE HOSTS ===`);
  console.log(`Found ${sorted.length} unique hosts`);
  for (const [host, count] of sorted.slice(0, 50)) {
    const s = samples.get(host);
    console.log(`  ${String(count).padStart(3)} × ${host.padEnd(35)} sample: ${s.url.slice(0, 60)}`);
  }

  writeFileSync('data/description-mining-results.json', JSON.stringify({
    scanned: data?.length || 0,
    candidates: sorted.map(([host, count]) => ({
      host, count, sample: samples.get(host),
    })),
  }, null, 2));
  console.log(`\nSaved ${sorted.length} candidates to data/description-mining-results.json`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });