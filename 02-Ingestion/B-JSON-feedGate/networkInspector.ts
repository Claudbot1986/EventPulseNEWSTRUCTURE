/**
 * Network Inspector — PoC för intern Network Path-discovery
 *
 * Syfte: Snabbt avgöra om en source har ett lovande Network/API-spår.
 *
 * Vad det gör:
 * 1. Provar misstänkta API-endpoints baserat på domän + känt mönster
 * 2. Fetcher JSON och letar efter event-liknande strukturer
 * 3. Filtrerar bort brus (bilder, CSS, analytics, tracking)
 * 4. Identifierar kandidater med heuristik
 * 5. Skriver en enkel rapport
 *
 * Avgränsning: Detta är INTE full browser-automation.
 * Det är ett lightweight verktyg för att snabbt få signal.
 *
 * Usage:
 *   npx tsx src/tools/networkInspector.ts <url>
 *   npx tsx src/tools/networkInspector.ts --batch <urls.txt>
 *   npx tsx src/tools/networkInspector.ts --probe <url> <endpoint-suffix>
 */

import { fetchJson, fetchHtml } from '../tools/fetchTools';
import { load } from 'cheerio';

// ─── Typer ─────────────────────────────────────────────────────────────────

type Label = 'likely_event_api' | 'possible_api' | 'low_value_noise';

interface PromotionCriteria {
  cleaner: boolean;    // API has better structure than HTML scraping would provide
  moreComplete: boolean; // API provides more fields than HTML alternatives
  moreStable: boolean;  // API structure is consistent across requests
  fieldCount: number;   // number of event-like fields found
  stabilityNotes: string;
}

type DiscoveryPath = 'json-ld' | 'network' | 'html' | 'render';

interface ApiCandidate {
  url: string;
  method: string;
  statusCode?: number;
  contentType?: string;
  why: string; // kortfattad orsak till varför den flaggades
  label: Label;
  score: number; // 0-100
  keysFound: string[]; // event-liknande nycklar i response
  responsePreview?: string; // kort utdrag av relevant data
  error?: string;
  promotion?: PromotionCriteria; // set if candidate qualifies for promotion evaluation
  discoveryPath: DiscoveryPath; // which path discovered this candidate (JSON-LD, Network, HTML, Render)
}

export interface NetworkInspectorResult {
  sourceUrl: string;
  timestamp: string;
  candidates: ApiCandidate[];
  summary: {
    likely: number;
    possible: number;
    noise: number;
    notFound: number;
    errors: number;
  };
  verdict: 'promising' | 'maybe' | 'unclear' | 'low_value';
  verdictReason: string;
}

// ─── Kända API-mönster att prova ─────────────────────────────────────────────

const COMMON_PATTERNS = [
  '/api/events',
  '/api/events/list',
  '/api/events/upcoming',
  '/api/v1/events',
  '/api/v2/events',
  '/wp-json/wp/v2/events',
  '/wp-json/tribe/events/v1/events',
  '/graphql',
  '/v1/events',
  '/v2/events',
  '/events.json',
  '/events_feed',
  '/eventFeed',
  '/kalender?format=json',
  '/program/api',
  '/api/program',
  '/api/kalender',
  '/json/events.json',
  '/api/v1/events?limit=50',
  '/wp-json/',
];

// ─── Brus-filter ─────────────────────────────────────────────────────────────

const NOISE_PATTERNS = [
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
  '.css', '.less', '.scss', '.sass',
  '.js', '.mjs', '.cjs',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '/fonts/', '/images/', '/img/', '/static/', '/assets/',
  '/media/', '/uploads/', '/icons/',
  'google-analytics', 'googletagmanager', 'facebook.net',
  'hotjar', 'segment.io', 'mixpanel', 'amplitude',
  'analytics', 'tracking', 'pixel', 'beacon',
  '.map', // source maps
  // WordPress REST API — these endpoints do NOT return events
  // They are detected by COMMON_PATTERNS but must be filtered before scoring
  '/wp-json/oembed/',       // oEmbed responses (title/type/html, not event data)
  '/wp-json/wp/v2/pages',   // WordPress page content (page metadata, not events)
];

function isNoise(url: string): boolean {
  return NOISE_PATTERNS.some(p => url.toLowerCase().includes(p));
}

// ─── Event-fält heuristik ─────────────────────────────────────────────────────

const EVENT_KEY_INDICATORS = [
  // Top-level event fields
  'title', 'name', 'eventTitle', 'event_title',
  'startDate', 'start_date', 'startTime', 'start_time', 'date', 'datetime', 'datum',
  'endDate', 'end_date', 'endTime', 'end_time',
  'venue', 'location', 'place', 'venueName', 'venue_name', 'locationName',
  'description', 'summary', 'beskrivning',
  'url', 'link', 'eventUrl', 'event_url', 'href',
  'image', 'imageUrl', 'image_url', 'thumbnail', 'poster',
  'price', 'priceInfo', 'ticketUrl', 'ticket_url', 'biljetter',
  'category', 'genre', 'type', 'eventType',
  'organizer', 'arrangör', 'arrangor', 'promoter',
  'status', 'availability',
  // Nested indicators
  'latitude', 'lat', 'longitude', 'lng', 'lon',
  'address', 'streetAddress', 'city', 'country',
  'performer', 'artist', 'act', 'band',
  'ticketPrice', 'minPrice', 'maxPrice',
  'ageRestriction', 'age', 'restrictions',
  'accessibility', 'access',
  // API container keys (indicates array of events)
  'events', 'productions', 'items', 'results', 'data', 'eventsList',
  'eventList', 'upcomingEvents', 'allEvents', 'showEvents',
];

// Low-value indicators that suggest NOT event data
const LOW_VALUE_KEYS = [
  'user', 'username', 'password', 'email', 'phone',
  'token', 'session', 'auth', 'credentials',
  'comment', 'post', 'article', 'blog', 'news',
  'menu', 'navigation', 'sidebar', 'footer', 'header',
  'settings', 'config', 'preferences',
];

function analyzeKeys(data: any, depth = 0): string[] {
  if (depth > 4) return [];
  if (!data || typeof data !== 'object') return [];

  const keys: string[] = [];

  if (Array.isArray(data)) {
    // For arrays, analyze first item to extract event-like fields
    if (data.length > 0) {
      const itemKeys = analyzeKeys(data[0], depth + 1);
      // Add as "item.fieldname" and also as bare "fieldname" for scoring
      keys.push(...itemKeys.map(k => `item.${k}`));
      keys.push(...itemKeys);
    }
  } else {
    const ownKeys = Object.keys(data);
    keys.push(...ownKeys);

    // Recurse into nested objects (limited depth)
    for (const key of ownKeys) {
      if (['location', 'venue', 'place', 'organizer', 'performer', 'geo'].includes(key)) {
        const nested = analyzeKeys(data[key], depth + 1);
        keys.push(...nested.map(k => `${key}.${k}`));
      }
      // Also analyze inside array containers (e.g. Events:[{...}], Productions:[{...}])
      if (Array.isArray(data[key]) && data[key].length > 0) {
        const itemKeys = analyzeKeys(data[key][0], depth + 1);
        for (const itemKey of itemKeys) {
          keys.push(`${key}.${itemKey}`);
          keys.push(itemKey);
        }
      }
    }
  }

  return [...new Set(keys)];
}

function scoreCandidate(keys: string[]): { score: number; label: Label; why: string } {
  const keySet = new Set(keys.map(k => k.toLowerCase()));

  let eventScore = 0;
  let lowValueScore = 0;
  const foundIndicators: string[] = [];
  const lowValueFound: string[] = [];

  for (const indicator of EVENT_KEY_INDICATORS) {
    if (keySet.has(indicator.toLowerCase())) {
      eventScore++;
      foundIndicators.push(indicator);
    }
  }

  for (const lv of LOW_VALUE_KEYS) {
    if (keySet.has(lv.toLowerCase())) {
      lowValueScore++;
      lowValueFound.push(lv);
    }
  }

  // Deduct for low-value keys
  eventScore = Math.max(0, eventScore - lowValueScore * 0.5);

  // Bonus: if we see container keys like "events" or "productions" at top level, increase score
  // Check case-insensitively since API responses may use different casing
  const CONTAINER_KEYS = ['events', 'productions', 'items', 'results', 'data', 'eventslist', 'eventlist', 'upcomingevents', 'allevents', 'showevents'];
  const containerBonus = CONTAINER_KEYS.filter(
    c => keySet.has(c.toLowerCase())
  ).length * 2;
  eventScore += containerBonus;

  // Score 0-100
  const score = Math.min(100, Math.round(eventScore * 10));

  let label: Label;
  if (score >= 60 && eventScore >= 5) {
    label = 'likely_event_api';
  } else if (score >= 25 && eventScore >= 2) {
    label = 'possible_api';
  } else {
    label = 'low_value_noise';
  }

  const why = score >= 60
    ? `Hittade ${eventScore} event-fält: [${foundIndicators.slice(0, 5).join(', ')}]`
    : score >= 25
    ? `Hittade ${eventScore} event-fält: [${foundIndicators.slice(0, 3).join(', ')}]`
    : lowValueScore > 0
    ? `Fann ${lowValueScore} low-value fält: [${lowValueFound.slice(0, 3).join(', ')}]`
    : 'Inga tydliga event-fält hittades';

  return { score, label, why };
}

/**
 * Evaluate whether a candidate meets the three Network Path promotion gates.
 * Called after scoring — only for candidates with score >= 60.
 *
 * Gate rules (from ingestion.md Source Fetching Architecture):
 * - Network Path may only be promoted if:
 *   1. cleaner — API structure is meaningfully better than HTML scraping
 *   2. moreComplete — API provides more fields than HTML alternatives
 *   3. moreStable — API structure is consistent across requests
 */
function evaluatePromotionCriteria(keys: string[], candidateUrl: string): PromotionCriteria | undefined {
  const keySet = new Set(keys.map(k => k.toLowerCase()));

  // Core field groups — API is "complete" if it provides fields covering these semantic groups
  // We match against both bare field names AND prefixed (events.field) names
  const fieldVariants: Record<string, string[]> = {
    'title': ['title', 'name', 'eventtitle', 'event_title'],
    'startdate': ['startdate', 'start_date', 'starttime', 'start_time', 'date', 'datetime'],
    'enddate': ['enddate', 'end_date', 'endtime', 'end_time'],
    'venue': ['venue', 'location', 'place', 'venuename', 'venue_name'],
    'description': ['description', 'summary'],
    'url': ['url', 'link', 'eventurl', 'event_url'],
    'image': ['image', 'imageurl', 'image_url'],
    'price': ['price', 'priceinfo', 'minprice', 'maxprice'],
    'category': ['category', 'genre', 'type'],
  };

  // Count how many semantic field groups are covered
  let coveredGroups = 0;
  const matchedFields: string[] = [];

  // Check for both lowercased bare fields AND lowercased container-prefixed fields
  // (analyzeKeys returns e.g. "Events.StartDate" — we need to match both bare and prefixed variants)
  for (const [group, variants] of Object.entries(fieldVariants)) {
    const matched = variants.some(v => {
      const lv = v.toLowerCase();
      return (
        keySet.has(lv) ||
        keySet.has(`events.${lv}`) ||
        keySet.has(`items.${lv}`) ||
        keySet.has(`productions.${lv}`)
      );
    });
    if (matched) {
      coveredGroups++;
      matchedFields.push(group);
    }
  }
  const fieldCount = coveredGroups;

  // Cleanliness: container-based APIs (Events[], Productions[]) with nested fields
  // are cleaner than HTML scraping which requires heuristic extraction
  const hasContainers = ['events', 'productions', 'items', 'results'].some(
    c => keySet.has(c.toLowerCase())
  );
  const cleaner = hasContainers || fieldCount >= 6;

  // Completeness: API provides structured fields that HTML scraping cannot reliably extract
  const moreComplete = fieldCount >= 5;

  // Stability: APIs with consistent top-level containers are more stable than HTML DOM structures
  // which can change with site updates. Also check if URL suggests a real API pattern.
  const apiPatterns = ['/api/', '/v1/', '/v2/', '/data', '/json', '/feed'];
  const looksLikeStableApi = apiPatterns.some(p => candidateUrl.toLowerCase().includes(p));
  const moreStable = hasContainers || looksLikeStableApi;

  // If all three gates pass, return promotion criteria
  if (cleaner && moreComplete && moreStable) {
    return {
      cleaner,
      moreComplete,
      moreStable,
      fieldCount,
      stabilityNotes: moreStable
        ? 'Container-based or stable URL pattern detected'
        : 'Structure suggests stability',
    };
  }

  // Partial pass — log why it didn't fully qualify
  const reasons: string[] = [];
  if (!cleaner) reasons.push('not cleaner than HTML');
  if (!moreComplete) reasons.push(`only ${fieldCount} core fields`);
  if (!moreStable) reasons.push('unstable URL pattern');

  return {
    cleaner,
    moreComplete,
    moreStable,
    fieldCount,
    stabilityNotes: `Did not qualify: ${reasons.join(', ')}`,
  };
}

// ─── Huvudlogik ─────────────────────────────────────────────────────────────

async function probeEndpoint(baseUrl: string, suffix: string): Promise<ApiCandidate> {
  // Build URL - handle various patterns
  let url: string;
  // Normalize baseUrl: add https:// if missing so URL() constructor works
  const normalizedBase = baseUrl.match(/^https?:\/\//i) ? baseUrl : `https://${baseUrl}`;
  if (suffix.startsWith('http')) {
    url = suffix;
  } else if (suffix.startsWith('/')) {
    // Extract domain from baseUrl
    try {
      const u = new URL(normalizedBase);
      url = `${u.origin}${suffix}`;
    } catch {
      url = `${normalizedBase.replace(/\/$/, '')}${suffix}`;
    }
  } else {
    url = `${baseUrl.replace(/\/$/, '')}/${suffix}`;
  }

  if (isNoise(url)) {
    return {
      url,
      method: 'PROBE',
      label: 'low_value_noise',
      score: 0,
      keysFound: [],
      why: 'Brus-URL (bild/CSS/font) — ignorerad',
      error: 'noise',
      discoveryPath: 'network',
    };
  }

  const result = await fetchJson(url, { timeout: 8000 }); // reduced from 15000ms to 8000ms for faster inspection

  if (!result.success) {
    return {
      url,
      method: 'PROBE',
      statusCode: result.statusCode,
      label: 'low_value_noise',
      score: 0,
      keysFound: [],
      why: `HTTP ${result.statusCode ?? 'fel'}: ${result.error}`,
      error: result.error,
      discoveryPath: 'network',
    };
  }

  const data = result.data;
  if (!data) {
    return {
      url,
      method: 'PROBE',
      statusCode: result.statusCode,
      label: 'low_value_noise',
      score: 0,
      keysFound: [],
      why: 'Tomt svar eller null',
      error: 'empty',
      discoveryPath: 'network',
    };
  }

  // Get content type from response if available
  const contentType = result.data && typeof result.data === 'object'
    ? 'application/json'
    : typeof data;

  // Analyze keys
  const keys = analyzeKeys(data);
  const { score, label, why } = scoreCandidate(keys);

  // Evaluate promotion criteria for candidates that scored well
  const promotion = score >= 60 ? evaluatePromotionCriteria(keys, url) : undefined;

  // Create preview of first few items
  let responsePreview: string | undefined;
  if (Array.isArray(data) && data.length > 0) {
    const preview = data.slice(0, 2).map(item => {
      if (typeof item === 'object' && item !== null) {
        const previewKeys = Object.keys(item).slice(0, 6);
        return `{${previewKeys.map(k => `"${k}"`).join(', ')}}`;
      }
      return String(item).substring(0, 80);
    });
    responsePreview = `[${preview.join(', ')}]`;
  } else if (typeof data === 'object' && data !== null) {
    const topKeys = Object.keys(data).slice(0, 6);
    responsePreview = `{${topKeys.map(k => `"${k}"`).join(', ')}}`;
  }

  return {
    url,
    method: 'PROBE',
    statusCode: result.statusCode,
    contentType,
    label,
    score,
    keysFound: keys.slice(0, 15), // top 15 keys
    why,
    responsePreview,
    promotion,
    discoveryPath: 'network',
  };
}

export async function inspectUrl(sourceUrl: string): Promise<NetworkInspectorResult> {
  // Normalize: add https:// if missing
  const normalizedUrl = sourceUrl.match(/^https?:\/\//i) ? sourceUrl : `https://${sourceUrl}`;
  const candidates: ApiCandidate[] = [];
  const errors: string[] = [];

  // 1. Probe common patterns in parallel batches of 10 (was sequential ~300s, now ~15s)
  const BATCH_SIZE = 10;
  for (let i = 0; i < COMMON_PATTERNS.length; i += BATCH_SIZE) {
    const batch = COMMON_PATTERNS.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(pattern => probeEndpoint(normalizedUrl, pattern))
    );
    for (const candidate of results) {
      if (candidate.error !== 'noise') {
        candidates.push(candidate);
      }
    }
  }

  // 2. Fetch page HTML and look for JSON Feeds / script hints
  const htmlResult = await fetchHtml(normalizedUrl, { timeout: 8000 }); // reduced from 15000ms to 8000ms
  if (htmlResult.success && htmlResult.html) {
    const $ = load(htmlResult.html);

    // Look for JSON Feed links
    $('link[type="application/json"]').each((_: any, el: any) => {
      const href = $(el).attr('href');
      if (href) {
        candidates.push({
          url: href,
          method: 'FEED_LINK',
          label: 'possible_api',
          score: 40,
          keysFound: [],
          why: 'Hittad JSON Feed i <link> tag',
          discoveryPath: 'html',
        });
      }
    });

    // Look for /wp-json/ in HTML (WordPress REST API discovery)
    if (htmlResult.html.includes('/wp-json/')) {
      const wpJsonMatch = htmlResult.html.match(/["']([^"']*\/wp-json\/[^"']*)["']/);
      if (wpJsonMatch) {
        candidates.push({
          url: wpJsonMatch[1],
          method: 'HTML_SCAN',
          label: 'possible_api',
          score: 45,
          keysFound: [],
          why: 'Hittad /wp-json/ i HTML',
          discoveryPath: 'html',
        });
      }
    }

    // Look for api-endpoints in scripts
    const apiPattern = htmlResult.html.match(/["']([^"']*\/api\/[^"']*)["']/g);
    if (apiPattern) {
      for (const match of apiPattern.slice(0, 3)) {
        const cleaned = match.replace(/["']/g, '');
        if (!isNoise(cleaned) && !candidates.some(c => c.url === cleaned)) {
          candidates.push({
            url: cleaned,
            method: 'HTML_SCAN',
            label: 'possible_api',
            score: 40,
            keysFound: [],
            why: 'Hittad API-referens i sidans HTML',
            discoveryPath: 'html',
          });
        }
      }
    }
  }

  // 3. Deduplicate candidates by URL
  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  // 4. Re-probe discovered URLs to get actual data
  const discoveredUrls = unique
    .filter(c => c.method === 'HTML_SCAN' || c.method === 'FEED_LINK')
    .map(c => c.url);

  for (const url of discoveredUrls) {
    const reProbe = await probeEndpoint(sourceUrl, url);
    const idx = unique.findIndex(c => c.url === url);
    if (idx !== -1) {
      unique[idx] = reProbe;
    }
  }

  // 5. Summary
  const summary = {
    likely: unique.filter(c => c.label === 'likely_event_api').length,
    possible: unique.filter(c => c.label === 'possible_api').length,
    noise: unique.filter(c => c.label === 'low_value_noise').length,
    notFound: unique.filter(c => c.error === 'not-found' || c.statusCode === 404).length,
    errors: unique.filter(c => c.error && c.error !== 'noise' && c.error !== 'not-found').length,
  };

  // 6. Verdict
  let verdict: NetworkInspectorResult['verdict'];
  let verdictReason: string;

  if (summary.likely >= 1) {
    verdict = 'promising';
    verdictReason = `Hittade ${summary.likely} likely API med event-fält.`;
  } else if (summary.possible >= 2) {
    verdict = 'maybe';
    verdictReason = `Hittade ${summary.possible} possible API:er. Testa manuellt i browser DevTools.`;
  } else if (summary.possible === 1) {
    verdict = 'maybe';
    verdictReason = `Hittade 1 möjlig endpoint men osäker kvalitet.`;
  } else if (summary.errors > 0 || summary.notFound > 0) {
    verdict = 'unclear';
    verdictReason = `Inga tydliga API:er hittades. ${summary.notFound} 404s, ${summary.errors} fel. Fler mönster kan finnas.`;
  } else {
    verdict = 'low_value';
    verdictReason = ` Inga event-liknande API:er hittades på vanliga mönster.`;
  }

  return {
    sourceUrl,
    timestamp: new Date().toISOString(),
    candidates: unique,
    summary,
    verdict,
    verdictReason,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  npx tsx src/tools/networkInspector.ts <url>');
    console.error('  npx tsx src/tools/networkInspector.ts --batch <urls.txt>');
    console.error('  npx tsx src/tools/networkInspector.ts --probe <url> <endpoint>');
    process.exit(1);
  }

  if (args[0] === '--batch') {
    const fs = await import('fs');
    const urls = fs.readFileSync(args[1], 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    console.log(`═══ NETWORK INSPECTOR — BATCH (${urls.length} URLs) ═══\n`);
    const results: NetworkInspectorResult[] = [];

    for (const url of urls) {
      process.stdout.write(`[${results.length + 1}/${urls.length}] ${url} ... `);
      const r = await inspectUrl(url);
      results.push(r);
      const icon = r.verdict === 'promising' ? '✅' : r.verdict === 'maybe' ? '⚠️' : r.verdict === 'unclear' ? '❓' : '❌';
      console.log(`${icon} ${r.verdict}`);
      console.log(`        → ${r.verdictReason}`);

      // Show promotion-eligible candidates
      const promotable = r.candidates.filter(c => c.promotion?.cleaner && c.promotion?.moreComplete && c.promotion?.moreStable);
      if (promotable.length > 0) {
        console.log(`        → 🎯 ${promotable.length} candidate(s) eligible for E2E promotion (Network Path):`);
        for (const c of promotable) {
          console.log(`           ${c.url} (score=${c.score}, path=${c.discoveryPath}, fields=${c.promotion.fieldCount})`);
        }
      }
    }

    // Batch summary
    console.log('\n═══ BATCH SUMMARY ═══');
    const promising = results.filter(r => r.verdict === 'promising').length;
    const maybe = results.filter(r => r.verdict === 'maybe').length;
    const unclear = results.filter(r => r.verdict === 'unclear').length;
    const lowValue = results.filter(r => r.verdict === 'low_value').length;
    console.log(`  ✅ promising: ${promising}`);
    console.log(`  ⚠️  maybe:    ${maybe}`);
    console.log(`  ❓ unclear:  ${unclear}`);
    console.log(`  ❌ low_value: ${lowValue}`);
    return;
  }

  if (args[0] === '--probe') {
    const [_, url, endpoint] = args;
    if (!endpoint) {
      console.error('Usage: --probe <url> <endpoint-suffix>');
      process.exit(1);
    }
    const result = await probeEndpoint(url, endpoint);
    console.log('═══ PROBE RESULT ═══');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Single URL
  const url = args[0];
  console.log(`═══ NETWORK INSPECTOR ═══`);
  console.log(`Source: ${url}\n`);

  const result = await inspectUrl(url);

  console.log(`Verdict: ${result.verdict.toUpperCase()}`);
  console.log(`Reason:  ${result.verdictReason}`);
  console.log();

  console.log(`─── Summary ───`);
  console.log(`  ✅ likely_event_api:   ${result.summary.likely}`);
  console.log(`  ⚠️  possible_api:      ${result.summary.possible}`);
  console.log(`  ❌ low_value_noise:   ${result.summary.noise}`);
  console.log(`  🚫 not_found (404):   ${result.summary.notFound}`);
  console.log(`  💥 errors:            ${result.summary.errors}`);
  console.log();

  if (result.candidates.length > 0) {
    console.log(`─── Candidates (${result.candidates.length}) ───`);
    for (const c of result.candidates) {
      const icon = c.label === 'likely_event_api' ? '✅' : c.label === 'possible_api' ? '⚠️' : '❌';
      console.log(`\n  ${icon} [${c.label}] score=${c.score} path=${c.discoveryPath}`);
      console.log(`     URL: ${c.url}`);
      if (c.statusCode) console.log(`     Status: ${c.statusCode}`);
      console.log(`     Method: ${c.method}`);
      console.log(`     Why: ${c.why}`);
      if (c.keysFound.length > 0) {
        console.log(`     Keys: [${c.keysFound.slice(0, 8).join(', ')}]`);
      }
      if (c.responsePreview) {
        console.log(`     Preview: ${c.responsePreview}`);
      }
      if (c.promotion) {
        const eligible = c.promotion.cleaner && c.promotion.moreComplete && c.promotion.moreStable;
        console.log(`     Promotion: ${eligible ? '🎯 ELIGIBLE' : '❌ not eligible'} (cleaner=${c.promotion.cleaner}, complete=${c.promotion.moreComplete}, stable=${c.promotion.moreStable}, fields=${c.promotion.fieldCount})`);
        if (!eligible) {
          console.log(`               → ${c.promotion.stabilityNotes}`);
        }
      }
    }
  }
}

// Guard against top-level execution when imported as module (ESM/CommonJS boundary)
import { fileURLToPath } from 'url';
if (import.meta.url === process.argv[1] || process.argv[1]?.endsWith(fileURLToPath(import.meta.url))) {
  main().catch(console.error);
}
