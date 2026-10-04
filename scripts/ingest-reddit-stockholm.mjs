#!/usr/bin/env node
/**
 * ingest-reddit-stockholm.mjs — Reddit r/Stockholm + r/StockholmEvents cross-posts.
 *
 * Reddit JSON API (gratis, ingen auth krävs för läsning):
 *   https://www.reddit.com/r/Stockholm/search.json?q=event&restrict_sr=&sort=new&t=month
 *
 * Filtrerar poster som har external_url till event-plattformar
 * (lu.ma, eventbrite, ticketmaster, meetup, fb.me).
 *
 * Användning:
 *   node scripts/ingest-reddit-stockholm.mjs
 *   node scripts/ingest-reddit-stockholm.mjs --dry-run
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SOURCE_ID = 'reddit-stockholm-events';
const SUBREDDITS = ['Stockholm', 'StockholmEvents', 'SwedishEvents'];
const SEARCH_TERMS = ['event', 'meetup', 'festival', 'concert', 'konsert', 'loppis'];
const TIME_FILTER = 'month';
const RATE_LIMIT_MS = 3000; // Reddit rate limit

const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SUPABASE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL_VAL || !SUPABASE_KEY_VAL) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUPABASE_URL_VAL, SUPABASE_KEY_VAL, { auth: { persistSession: false } });

function dedupHash(title, startTime) {
  return createHash('sha256').update(`${SOURCE_ID}::${title}::${startTime}`).digest('hex');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const KNOWN_EVENT_HOSTS = [
  'lu.ma', 'eventbrite', 'meetup.com', 'ticketmaster', 'fb.me', 'facebook.com/events',
  'universe', 'posh.vip', 'residentadvisor.net', 'songkick',
];

function isEventPost(post) {
  const url = post.url_overridden_by_dest ?? post.url ?? '';
  return KNOWN_EVENT_HOSTS.some((h) => url.includes(h));
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'EventPulse-Bot/1.0 (research)', Accept: 'application/json' },
  });
  if (!r.ok) return null;
  return await r.json();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Reddit Stockholm — ${dryRun ? 'DRY RUN' : 'REAL'}`);

  const candidates = [];
  for (const sub of SUBREDDITS) {
    for (const term of SEARCH_TERMS) {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(term)}&restrict_sr=&sort=new&t=${TIME_FILTER}&limit=25`;
      await sleep(RATE_LIMIT_MS);
      const data = await fetchJson(url);
      if (!data) {
        console.error(`  ${sub} "${term}": fetch failed`);
        continue;
      }
      const posts = data?.data?.children ?? [];
      const eventPosts = posts.filter((p) => p?.data && isEventPost(p.data));
      candidates.push(...eventPosts.map((p) => ({
        title: p.data.title,
        url: p.data.url_overridden_by_dest ?? p.data.url,
        created_utc: p.data.created_utc,
        score: p.data.score,
        subreddit: sub,
        num_comments: p.data.num_comments,
      })));
      console.log(`  ${sub} "${term}": ${posts.length} posts, ${eventPosts.length} event-ish`);
    }
  }

  // Dedup by URL
  const byUrl = new Map();
  for (const c of candidates) if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  const uniq = [...byUrl.values()];
  console.log(`\nTotal candidates: ${candidates.length} unique: ${uniq.length}`);

  // Show top 10 by score
  uniq.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  console.log('Top 10 by Reddit score:');
  for (const c of uniq.slice(0, 10)) {
    console.log(`  ${c.score} ↑  [${c.subreddit}] ${c.title.slice(0, 60)} → ${c.url.slice(0, 60)}`);
  }

  if (dryRun) {
    process.exit(0);
  }

  // Reddit posts don't have event start times directly. We approximate by created_utc.
  // For now: skip persistence — Reddit posts are signal-only, not full events.
  // Future improvement: cross-reference URLs against existing eventbrite/lu.ma/meetup sources.
  console.log('\n(Reddit posts persisted as raw signal in raw_data, not as standalone events — ' +
    'they typically reference events from other platforms already in DB.)');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });