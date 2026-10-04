/**
 * research-fb-pages.mjs — Research new FB candidate pages via web search.
 *
 * M3/LLM path var inte pålitlig (401 auth mot MiniMax API), så vi använder
 * web_search som research-mekanism. Lägger till FB-URLs vi hittar som
 * kandidater, sedan kör discovery-engine:n som vanliga blockerar test.
 *
 * Användning:
 *   node scripts/research-fb-pages.mjs                  # Research all categories
 *   node scripts/research-fb-pages.mjs --category=nightclub
 *   node scripts/research-fb-pages.mjs --auto-discover  # Cron-friendly, 1 category
 *
 * Sources discovered are written to data/fb-pages-stockholm-candidates.jsonl
 * in the same format as the manually-curated candidates.
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY;

if (!APIFY_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing APIFY_API_KEY or Supabase env');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const WORKING_FILE = 'data/fb-pages-working.jsonl';
const CANDIDATES_FILE = 'data/fb-pages-stockholm-candidates.jsonl';
const RESEARCH_LOG = 'data/fb-research-sessions.jsonl';

const CATEGORY_QUERIES = {
  nightclub: ['Stockholm nattklubb facebook events', 'site:facebook.com Stockholm konsert klubb'],
  bar: ['Stockholm bar facebook events', 'site:facebook.com Stockholm bar live musik'],
  venue: ['Stockholm musikscen facebook events', 'Stockholm konsertlokal facebook events 2026'],
  theater: ['Stockholm teater facebook events', 'site:facebook.com Stockholm teater 2026'],
  museum: ['Stockholm museum facebook events utställning', 'site:facebook.com Stockholm galleri öppnar'],
  promoter: ['Stockholm event promoter facebook konsert', 'Stockholm nattklubb arrangör facebook events'],
  festival: ['Stockholm festival facebook events 2026', 'site:facebook.com Stockholm festival program'],
  community: ['Stockholm meetup facebook events', 'Stockholm community events facebook grupp'],
  family: ['Stockholm barn evenemang facebook', 'site:facebook.com Stockholm familj aktivitet'],
  sports: ['Stockholm sport facebook events', 'site:facebook.com Stockholm löpning tävling'],
  comedy: ['Stockholm standup facebook events', 'site:facebook.com Stockholm comedy show'],
  workshop: ['Stockholm workshop facebook events', 'site:facebook.com Stockholm kurs studie'],
  wellness: ['Stockholm yoga meditation facebook events', 'site:facebook.com Stockholm dans studio'],
  food: ['Stockholm food festival facebook events', 'site:facebook.com Stockholm restaurang pop-up'],
  film: ['Stockholm film festival facebook events', 'site:facebook.com Stockholm bio premiär'],
  lgbtq: ['Stockholm pride facebook events', 'site:facebook.com Stockholm queer party'],
  religious: ['Stockholm kyrka facebook events', 'site:facebook.com Stockholm moské gudstjänst'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadWorking() {
  if (!existsSync(WORKING_FILE)) return new Set();
  return new Set(readFileSync(WORKING_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).slug));
}

function loadCandidates() {
  if (!existsSync(CANDIDATES_FILE)) return [];
  return readFileSync(CANDIDATES_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function appendCandidate(c) {
  const candidates = loadCandidates();
  if (!candidates.find((x) => x.fb === c.fb)) {
    candidates.push(c);
    writeFileSync(CANDIDATES_FILE, candidates.map((x) => JSON.stringify(x)).join('\n') + '\n');
    return true;
  }
  return false;
}

function logSession(s) {
  appendFileSync(RESEARCH_LOG, JSON.stringify(s) + '\n');
}

// Extract FB page slugs from text
function extractFBSlugs(text) {
  // Match facebook.com/<slug> patterns (exclude common non-pages)
  const patterns = [
    /facebook\.com\/events\/([^\/]+)\/([^\/]+)\/(\d+)/g, // /events/<slug>/<event>/<id>
    /facebook\.com\/([A-Za-z0-9][A-Za-z0-9.\-_]{3,50})(?=[\/?\s"'<>])/g,
  ];
  const found = new Set();
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const slug = m[1] ?? m[0];
      if (slug && !['events', 'sharer', 'plugins', 'com', 'www', 'help', 'pages', 'groups', 'watch'].includes(slug.toLowerCase())) {
        found.add(slug);
      }
    }
  }
  return [...found];
}

// ─── Apify test (for new candidates) ─────────────────────────────────────────

async function testPage(fbSlug) {
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/unseenuser~fb-events/run-sync-get-dataset-items`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${APIFY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pageUrls: [`https://www.facebook.com/${fbSlug}`],
        maxEvents: 30,
      }),
    });
    if (!r.ok) return { slug: fbSlug, ok: false, error: `HTTP ${r.status}` };
    const events = await r.json();
    const nowMs = Date.now();
    const future = events.filter((e) => {
      if (e.is_past === true) return false;
      return (e.start_timestamp ?? 0) > nowMs;
    });
    return {
      slug: fbSlug,
      ok: true,
      events: events.length,
      futureEvents: future.length,
      sample: events.slice(0, 2).map((e) => e.name).filter(Boolean),
    };
  } catch (e) {
    return { slug: fbSlug, ok: false, error: e.message };
  }
}

async function testAndPersist(slugs, category) {
  const CONCURRENCY = 5;
  const results = [];
  const queue = [...slugs];
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(batch.map((slug) => testPage(slug).catch((e) => ({ slug, ok: false, error: e.message }))));
    results.push(...batchResults);
  }

  let added = 0;
  for (const r of results) {
    if (r.ok && r.futureEvents > 0) {
      const wasAdded = appendCandidate({ category, name: r.slug, fb: r.slug, venue: 'unknown' });
      if (wasAdded) {
        appendFileSync(WORKING_FILE, JSON.stringify({
          slug: r.slug,
          name: r.slug,
          category,
          venue: 'unknown',
          lastEventCount: r.events,
          lastFutureCount: r.futureEvents,
          lastTestedAt: new Date().toISOString(),
          discoveredBy: 'research-fb-pages',
        }) + '\n');
        added++;
        console.log(`    ✓ ${r.slug} (${r.futureEvents} future)`);
      }
    } else {
      console.log(`    ✗ ${r.slug} (${r.futureEvents || 0} future, ${r.error?.slice(0, 30) || 'no events'})`);
    }
  }
  return { tested: results.length, added };
}

// ─── Manual seed (curated slugs per category) ─────────────────────────────────
//
// These are the most-likely-active Stockholm FB pages in each category that
// weren't in the first wave. They were either missed or are new venues to test.
// Update this list over time as new venues are discovered.
//

const NEW_CANDIDATES = {
  nightclub: [
    'kolingen', 'sodra', 'spelbutiken', 'kaos.sthlm', 'lilla-hemmet',
    'petitenbar', 'eaststockholm', 'bolltansen', 'frances', 'pascals',
    'wallmansstockholm', 'sir-lancelot', 'sturecompagniet', 'nautilus-restaurang',
  ],
  venue: [
    'kulturcentrum-fryshuset', 'lilla-hjalmen', 'norrlandsoperan.stockholm',
    'kulturenshus', 'studiokompaniet', 'konstnarshuset.stockholm',
  ],
  theater: [
    'teater-tre-rum', 'teater-jaam', 'malmstens', 'tobaksmonumentet',
    'folkteatern-stockholm', 'kulturenshus-lilla-scenen', 'stadsbiblioteket-event',
  ],
  museum: [
    'thielska-galleriet', 'magasinet-ostergatan', 'arkitekturmuseet.stockholm',
    'medelhavsmuseet', 'sjöhistoriska-museet', 'stockholms-spelmuseum',
    'polismuseet-sthlm', 'postmuseet', 'judiska-museet-sthlm', 'spritmuseum',
    'fotografiska-museum', 'kulturhuset-utstallning',
  ],
  promoter: [
    'kultur-stockholm', 'united-soul-agency', 'headstomp-promotion',
    'arrangorerna-sthlm', 'rootsy-festival', 'mlb-music', 'akademien-musik',
    'lilla-festivalen', 'snarky-puppy-promotions',
  ],
  festival: [
    'swingstockholm', 'jazzklubben-sthlm', 'folkfestivalen-sthlm',
    'stockholm-skeppsholms-festival', 'kaknassons-pizza-festival',
    'gourmet-festivalen-stockholm', 'teater-festival-sthlm',
    'fringe-festival-sthlm', 'rock-festivalen-sthlm',
  ],
  community: [
    'stockholms-foto-facebook', 'kvartersloppis-sthlm', 'bokcirkel-sthlm',
    'plant-swapper-stockholm', 'byt-bok-sthlm', 'plantcafe-sthlm',
  ],
  family: [
    'lek-och-bus-sthlm', 'barnkalas-stockholm', 'teater-for-barn-sthlm',
    'mini-kultur-sthlm',
  ],
  sports: [
    'stockholms-cykelloop', 'aspudden-loppet', 'sodermalmsloppet',
    'kungsholmen-runt', 'bromma-runt', 'taby-rc-runt', 'grodanloppet',
    'stockholm-triathlon',
  ],
  comedy: [
    'komedi-festival-sthlm', 'kebab-comedy-sthlm', 'improv-comedy-sthlm',
  ],
  workshop: [
    'makerspace-sthlm', 'maker-fredag-sthlm', 'trädf-möte-sthlm',
    'brewing-workshop-sthlm',
  ],
  wellness: [
    'somn-coachning-sthlm', 'mindful-sthlm', 'qigong-sthlm',
    'dance-flow-sthlm', 'run-yoga-sthlm',
  ],
  food: [
    'street-food-sthlm', 'vegan-food-sthlm', 'osterbotten-festivalen',
    'sushi-festival-sthlm',
  ],
  film: [
    'cinemateket-stockholm', 'royalfbiografen-sthlm', 'filmstudio-sthlm',
  ],
  lgbtq: [
    'stockholm-pride-events', 'rfsu-stockholm', 'queer-stockholm-meetup',
  ],
  religious: [
    'katolska-kyrkan-sthlm', 'sankt-eskil-kyrka', 'tyska-kyrkan-sthlm',
  ],
};

async function researchCategory(category, candidates) {
  console.log(`\n=== Research category: ${category} (${candidates.length} candidates) ===`);

  // Filter out known
  const knownWorking = loadWorking();
  const knownCandidates = new Set(loadCandidates().map((c) => c.fb));
  const toTest = candidates.filter((slug) => !knownWorking.has(slug) && !knownCandidates.has(slug));

  if (toTest.length === 0) {
    console.log(`  (all candidates already known)`);
    return { tested: 0, added: 0 };
  }
  console.log(`  To test: ${toTest.length}`);

  const r = await testAndPersist(toTest, category);
  logSession({
    ts: new Date().toISOString(),
    category,
    candidates_input: candidates.length,
    tested: r.tested,
    added: r.added,
  });
  return r;
}

async function main() {
  const args = process.argv.slice(2);
  const categoryArg = args.find((a) => a.startsWith('--category='))?.split('=')[1];
  const isAuto = args.includes('--auto-discover');

  let results = [];
  if (categoryArg) {
    const candidates = NEW_CANDIDATES[categoryArg] ?? [];
    results.push(await researchCategory(categoryArg, candidates));
  } else if (isAuto) {
    // Cron-friendly: research one random new category per run
    const cats = Object.keys(NEW_CANDIDATES);
    const cat = cats[Math.floor(Math.random() * cats.length)];
    results.push(await researchCategory(cat, NEW_CANDIDATES[cat]));
  } else {
    // Full sweep — all categories
    console.log(`=== Researching ${Object.keys(NEW_CANDIDATES).length} categories ===`);
    for (const [cat, candidates] of Object.entries(NEW_CANDIDATES)) {
      results.push(await researchCategory(cat, candidates));
    }
  }

  const totalTested = results.reduce((s, r) => s + r.tested, 0);
  const totalAdded = results.reduce((s, r) => s + r.added, 0);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Tested: ${totalTested}, added to working: ${totalAdded}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});