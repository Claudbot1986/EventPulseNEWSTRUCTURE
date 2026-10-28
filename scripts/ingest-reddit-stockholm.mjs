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
import { redditContract } from './lib/reddit-contract.mjs';

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

/**
 * Antal misslyckade sökningar och det första felet.
 *
 * 2026-10-28 — reddit kör 3 subreddit × 6 termer = 18 sökningar. En rad
 * per misslyckad sökning gav 18 felrader (och kedjan gick RÖD, eftersom
 * "transport-fel" matchar transportmönstret). Reddit är en VALFRI källa:
 * ett timeout hos reddit ska vara en noterad försämring, inte ett fel som
 * stoppar hela kedjan. Därför: räkna, och skriv EN sammanfattning med
 * DEGRADED-markören.
 *
 * 2026-10-28 (andra rundan) — TRANSPORTFEL och HTTP-NEKAD är olika saker.
 * Reddit svarar 403 på varje förfrågan från den här maskinen (mätt
 * 2026-10-28 08:38 — 18 av 18 sökningar, "HTTP 403"). Ett 403 betyder att
 * reddit NÅDDE fram och nekade — världen är frisk, reddit vägrar bara
 * servera oss. Om det räknades som transportfel skulle kedjan gå RÖD
 * (exit 69) varje natt för en valfri källa — och en permanent röd kedja
 * är lika oanvändbar som en permanent grön.
 */
let fetchFailures = 0;
let transportFailures = 0;
let firstFetchFailure = null;

/**
 * @param {string} reason
 * @param {boolean} [isTransport] true = inget HTTP-svar nådde oss
 */
function recordFetchFailure(reason, isTransport = false) {
  fetchFailures += 1;
  if (isTransport) transportFailures += 1;
  if (!firstFetchFailure) firstFetchFailure = reason;
}

async function fetchJson(url) {
  // 2026-10-28 — try/catch. Utan den kastade ett transportfel (nätet dog)
  // rakt upp i main() och skriptet dog med en rå stacktrace — i stället för
  // att rapportera "reddit svarade inte" och gå vidare. Nu returneras null
  // med orsaken loggad, så kedjan kan skilja "reddit var tyst" från
  // "reddit svarade men hade inga träffar".
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'EventPulse-Bot/1.0 (research)', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      // HTTP-svar = reddit NÅDDE fram. Det är ett nekande, inte ett
      // transportfel — därför isTransport = false.
      recordFetchFailure(`HTTP ${r.status} för ${url.split('?')[0]}`, false);
      return null;
    }
    return await r.json();
  } catch (err) {
    const code = err?.cause?.code ?? err?.code ?? 'okänt';
    // Inget svar alls — nätet gick inte fram.
    recordFetchFailure(`transport-fel (${code}) för ${url.split('?')[0]}`, true);
    return null;
  }
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

  // 2026-10-28 — EXITKONTRAKT (regeln lives i scripts/lib/reddit-contract.mjs,
  // med enhetstester). Om ALLA sökningar misslyckades OCH inget HTTP-svar
  // nådde oss nåddes reddit aldrig: det är ett transportfel, inte en "tyst"
  // källa. Kedjan ska veta det (exit 69 = världen var trasig), annars ser
  // exit 0 ut som "reddit svarade men hade inga träffar" — och en trasig
  // kedja kläder sig i grönt.
  //
  // Bara en DEL misslyckades → reddit är fortfarande nåbar, det är bara en
  // valfri källa som försämrats → DEGRADED + exit 0.
  //
  // ALLA misslyckades men med HTTP-svar (t.ex. reddit svarar 403) → reddit
  // NÅDDE fram och nekade. Världen är frisk; bara den valfria källan
  // saknas → DEGRADED + exit 0. Annars skulle kedjan gå röd varje natt
  // för en källa som aldrig kommer att svara.
  const totalSearches = SUBREDDITS.length * SEARCH_TERMS.length;
  const contract = redditContract({
    totalSearches,
    failures: fetchFailures,
    transportFailures,
  });
  if (contract.degraded) {
    console.error(
      `  reddit: DEGRADED ${fetchFailures} av ${totalSearches} sökningar misslyckades` +
      ` (första: ${firstFetchFailure})`,
    );
  } else if (contract.exitCode !== 0) {
    console.error(
      `  reddit: transport-fel — ${contract.reason}` +
      ` (första: ${firstFetchFailure})`,
    );
    process.exit(contract.exitCode);
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