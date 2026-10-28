#!/usr/bin/env node
/**
 * ingest-direct-jsonld.mjs — Generic fetcher för källor med JSON-LD på landing-sidan.
 *
 * Till skillnad från sitemap-discovery som kräver URL-patterns i sitemap,
 * extraherar denna direkt JSON-LD events från source-filen URL.
 *
 * T0201.5 (2026-10-06, Steg 3): push till raw_events BullMQ-queue istället
 * för direkt upsert. Ger normalizer chans att köra categoryKeywords + T0201 +
 * dedup + venue_id resolution per event.
 *
 * Användning:
 *   node scripts/ingest-direct-jsonld.mjs                    # alla 196+ sources
 *   node scripts/ingest-direct-jsonld.mjs --slug=dansenshus  # en source
 *   node scripts/ingest-direct-jsonld.mjs --dry-run
 */

import 'dotenv/config';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createBullQueue } from '../03-Queue/redisClient.mjs';
import { createQueueErrorTracker } from './lib/queue-errors.mjs';
import { fetchText, describeRefusal } from './lib/http-fetch.mjs';
import { errnoOf } from './lib/net-error.mjs';
import * as cheerio from 'cheerio';

const CONCURRENCY = parseInt(process.env.JSONLD_CONCURRENCY ?? '10', 10);
const PER_REQUEST_TIMEOUT = 12000;

// 2026-10-28 — köfelsamling: högst 3 provrader, och exit ≠ 0 om inget
// kunde köas. Se scripts/lib/queue-errors.mjs.
const queueErrors = createQueueErrorTracker();
let totalQueued = 0;

/**
 * 2026-10-28 — källor som SVARADE men nekade vår förfrågan (403/406/429).
 *
 * Mätt på riktig körning: 7 av 139 källor nekade, 129 svarade normalt.
 * Den gamla koden skrev alla som "fetch failed", vilket kedjan klassar som
 * TRANSPORTFEL — kedjan gick röd med exit 69 ("nätet dog") medan nätet var
 * friskt. En vägran är inte ett transportfel: servern svarade.
 */
const refusals = [];
/**
 * 2026-10-28 — källor som inte gick att NÅ (timeout, DNS, koppling).
 *
 * Ett sådant fel är per källa, inte per värld. Mätt 2026-10-28:
 * riksarkivet.se svarar inte inom 12 s — varje natt, deterministiskt.
 * Om varje sådan källa gjorde kedjan röd med exit 69 ("nätet dog") skulle
 * kedjan vara röd varje natt av en anledning som har inget med kedjans
 * hälsa att göra — och operatören skulle sluta tro på exit 69.
 */
const failures = [];
/** Källor som svarade normalt (vi fick HTML, oavsett vad som stod i den). */
let reachableSources = 0;

const SUB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
if (!SUB || !SK) { console.error('Missing env'); process.exit(2); }
const supabase = createClient(SUB, SK, { auth: { persistSession: false } });

// T0201.5: BullMQ raw_events-queue. Workern (startWorker.ts) dränerar och
// processar varje event genom normalizern. Direkt-upsert kringgår all
// kategori-mappning, dedup och T0201 — något vi fasar ut enligt Steg 3.
// 2026-10-28 — central Redis-klient (03-Queue/redisClient.mjs).
// Den gamla inline-optionen hade maxRetriesPerRequest: null UTAN
// enableOfflineQueue: false — dvs. kommandon lade sig i offline-kön när
// Redis var borta och skicket aldrig kom fram. Det var en del av
// 2-timmars-hängningen 2026-10-26.
const rawEventsQueue = createBullQueue('raw_events');

function dedupHash(title, startTime, sourceId) {
  return createHash('sha256').update(`${sourceId}::${title}::${startTime}`).digest('hex');
}

class Sem {
  constructor(n) { this.n = n; this.q = []; this.waiters = []; }
  async acquire() { if (this.n > 0) { this.n--; return; } await new Promise((r) => this.waiters.push(r)); }
  release() { const next = this.waiters.shift(); if (next) next(); else this.n++; }
}

/**
 * Hämta HTML.
 *
 * REGELN (2026-10-28, mätt på riktig körning):
 *   - 2xx       → vi har HTML.
 *   - 4xx / 5xx → servern SVARADE men nekade. Detta är en vägran, inte ett
 *                 transportfel, och det ska inte rapporteras som ett.
 *   - kastat    → nätverket nådde inte fram. Felet kastas VIDARE, så att
 *                 kedjan klassar det som transportfel (exit 69).
 *
 * VARFÖR detta ändrades. Den gamla versionen returnerade null i BÅDA fallen
 * och anroparen skrev "fetch failed" — en text som klassificeras som
 * transportfel. Följden: 10 av 139 källor som svarade 403/406/429 gjorde
 * att kedjan gick röd med exit 69 ("nätet dog") medan 129 av 139 källor
 * svarade normalt.
 *
 * @param {string} url
 * @returns {Promise<{ ok: true, html: string } | { ok: false, kind: 'refused', status: number }>}
 */
async function fetchHtml(url) {
  const res = await fetchText(url, {
    timeoutMs: PER_REQUEST_TIMEOUT,
    headers: { 'User-Agent': 'EventPulse-Bot/1.0 (events discovery)', Accept: 'text/html' },
  });
  if (res.ok) return { ok: true, html: res.text };
  return { ok: false, kind: 'refused', status: res.status };
}

function extractJsonLd(html) {
  const events = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        // Direct Event
        if (d['@type'] === 'Event' || (Array.isArray(d['@type']) && d['@type'].includes('Event'))) {
          events.push(extractEvent(d));
        }
        // ItemList with nested Events (Luma, etc.)
        if (d['@type'] === 'ItemList' && Array.isArray(d.itemListElement)) {
          for (const li of d.itemListElement) {
            const ev = li.item ?? li;
            if (ev && (ev['@type'] === 'Event' || (Array.isArray(ev['@type']) && ev['@type'].includes('Event')))) {
              events.push(extractEvent(ev));
            }
          }
        }
      }
    } catch {}
  }
  return events;
}

function extractEvent(d) {
  const loc = d.location || {};
  const addr = loc.address || {};
  const address = [addr.streetAddress, addr.postalCode, addr.addressLocality].filter(Boolean).join(', ') || null;
  // T0201.5: extrahera @type för categories-fält (Event→community,
  // MusicEvent→music, etc). Detta matas till normalizerns canonicalizeCategorySlug
  // som omvandlar till kanon-slug. Saknas @type → categories=[] →
  // normalizer faller tillbaka till source-default eller 'community'.
  const ldType = d['@type'] ?? null;
  const typeMap = {
    'MusicEvent': 'music',
    'TheaterEvent': 'theater',
    'ComedyEvent': 'standup',
    'DanceEvent': 'community',
    'Festival': 'festival',
    'SportsEvent': 'sport',
    'ScreeningEvent': 'film',
    'ExhibitionEvent': 'art-exhibitions',
    'EducationEvent': 'community',
    'ChildrensEvent': 'community',
  };
  const categories = ldType && typeMap[ldType] ? [typeMap[ldType]] : [];

  return {
    name: d.name,
    startDate: d.startDate,
    endDate: d.endDate || null,
    url: d.url || null,
    venue: loc.name || null,
    address,
    lat: loc.geo?.latitude != null ? parseFloat(loc.geo.latitude) : null,
    lng: loc.geo?.longitude != null ? parseFloat(loc.geo.longitude) : null,
    description: d.description?.slice(0, 500) || null,
    categories,
  };
}

async function processSource(src, sem) {
  await sem.acquire();
  try {
    // 2026-10-28 — skilj på de tre utfallen. Ett verkligt transportfel
    // (nätet nådde inte fram) kastas vidare och fångas här, så att det kan
    // skiljas från en vägran i returvärdet. En vägran är INTE ett fel.
    let fetched;
    try {
      fetched = await fetchHtml(src.url);
    } catch (err) {
      return { slug: src.slug, error: err };
    }
    if (!fetched.ok) {
      return { slug: src.slug, refused: fetched.status };
    }
    const html = fetched.html;
    // Källan svarade. Det spelar roll oavsett vad som stod i svaret — en
    // källa som svarade men som har inga framtida evenemang är inte samma
    // sak som en källa som aldrig svarade.
    reachableSources += 1;

    const events = extractJsonLd(html);
    const now = Date.now();
    const future = events.filter((e) => {
      if (!e.name || !e.startDate) return false;
      const ts = new Date(e.startDate).getTime();
      return !isNaN(ts) && ts > now;
    });

    if (future.length === 0) {
      return { slug: src.slug, error: 'no future events', fetched: events.length };
    }

    // T0201.5: Bygg RawEventInput-payloads och push till raw_events-queue.
    // Workern dränerar kön i 15-min drain-fönstret (startWorker.ts under
    // supervisor-steget) och kör normalizer per event.
    const raws = future.map((ev) => {
      const hasCoord = typeof ev.lat === 'number' && ev.lat !== 0
                    && typeof ev.lng === 'number' && ev.lng !== 0;
      const lat = hasCoord ? ev.lat : null;
      const lng = hasCoord ? ev.lng : null;
      return {
        // Required RawEventInput fields:
        title: ev.name,
        description: ev.description,
        start_time: ev.startDate,
        end_time: ev.endDate ?? null,
        venue_name: ev.venue,
        venue_address: ev.address,
        lat, lng,
        categories: ev.categories,
        is_free: false,  // JSON-LD ger inte pris → false default
        price_min_sek: null,
        price_max_sek: null,
        ticket_url: ev.url,
        image_url: null,
        source: src.slug,
        source_id: null,  // JSON-LD ger inget externt ID — normalizer dedupar på title+start
        detected_language: null,
        raw_payload: {
          venue: ev.venue,
          address: ev.address,
          fetched_via: 'direct-jsonld',
          fetched_at: new Date().toISOString(),
        },
      };
    });

    // Pre-dedup mot befintliga events för att inte fylla kön med dubletter
    // (även om normalizer dedupar, det är onödigt arbete).
    const existingKeys = new Set();
    const { data: existingRows } = await supabase
      .from('events')
      .select('dedup_hash')
      .eq('source', src.slug);
    for (const r of existingRows ?? []) if (r.dedup_hash) existingKeys.add(r.dedup_hash);

    let pageQueued = 0;
    let pageSkipped = 0;
    for (let i = 0; i < raws.length; i++) {
      const r = raws[i];
      const hash = dedupHash(r.title, r.start_time, src.slug);
      if (existingKeys.has(hash)) { pageSkipped++; continue; }
      try {
        await rawEventsQueue.add(`directjsonld-${hash.slice(0, 16)}`, r, {
          removeOnComplete: 1000,
          removeOnFail: 5000,
        });
        pageQueued++;
      } catch (e) {
        queueErrors.record(e, `${src.slug}: queue.add failed for ${r.title}`);
      }
    }
    totalQueued += pageQueued;

    return {
      slug: src.slug,
      fetched: events.length,
      future: future.length,
      persisted: pageQueued,
      duplicates: pageSkipped,
    };
  } finally {
    sem.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlySlug = args.find((a) => a.startsWith('--slug='))?.split('=')[1];

  const files = readdirSync('sources').filter((f) => f.endsWith('.jsonl') && !f.startsWith('_'));
  const sources = [];
  const seen = new Set();
  for (const f of files) {
    try {
      const lines = readFileSync(join('sources', f), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const d = JSON.parse(line);
        if (d.url && !seen.has(d.id)) {
          if (onlySlug && d.id !== onlySlug) continue;
          seen.add(d.id);
          sources.push({ slug: d.id, url: d.url });
          break;
        }
      }
    } catch {}
  }

  console.log(`Direct JSON-LD ingestion — ${sources.length} sources dryRun=${dryRun} concurrency=${CONCURRENCY}`);

  const totals = { fetched: 0, future: 0, persisted: 0, duplicates: 0, errors: 0, refused: 0, unreachable: 0, empty: 0 };
  const sem = new Sem(CONCURRENCY);

  const promises = sources.map(async (src) => {
    try {
      const r = await processSource(src, sem);
      if (r.refused !== undefined) {
        // 2026-10-28 — servern svarade men nekade. Det är en FÖRSÄMRING, inte
        // ett fel: kedjan ska se den (DEGRADED) men INTE gå röd med "nätet
        // dog". Formuleringen är avsiktligtfri från "fetch failed" och
        // "HTTP 403" — annars skulle kedjans textklassificator felklassa den.
        refusals.push({ slug: r.slug, status: r.refused });
        totals.refused += 1;
        console.log(`  ${r.slug}: ${describeRefusal(r.refused)}`);
        console.error(`[direct-jsonld] DEGRADED källa ${r.slug}: ${describeRefusal(r.refused)}`);
      } else if (r.error) {
        if (r.error === 'no future events') {
          // Tomt resultat, inte ett fel. Räknas separat så att "errors" i
          // TOTAL-raden inte längre blandar ihop "inga evenemang" med
          // "kunde inte nå".
          totals.empty += 1;
          console.log(`  ${r.slug}: no future events${r.fetched !== undefined ? ` (fetched=${r.fetched})` : ''}`);
        } else {
          // 2026-10-28 — kunde inte NÅ källan. Per källa, inte per värld:
          // DEGRADED-markören gör att kedjan ser försämringen utan att gå
          // röd med "nätet dog". Rött blir det först om världen är trasig
          // (se avslutningen av main).
          const reason = errnoOf(r.error) ?? 'nätverksfel';
          failures.push({ slug: r.slug, reason });
          totals.unreachable += 1;
          totals.errors += 1;
          console.log(`  ${r.slug}: gick inte att nå (${reason})`);
          console.error(`[direct-jsonld] DEGRADED källa ${r.slug}: gick inte att nå (${reason})`);
        }
      } else {
        console.log(`  ${r.slug}: fetched=${r.fetched} future=${r.future} persisted=${r.persisted} dupes=${r.duplicates}`);
        totals.fetched += r.fetched;
        totals.future += r.future;
        totals.persisted += r.persisted;
        totals.duplicates += r.duplicates;
      }
    } catch (e) {
      console.error(`  ${src.slug}: FATAL ${e.message}`);
      totals.errors++;
      queueErrors.record(e, `källa ${src.slug}`);
    }
  });

  await Promise.all(promises);

  console.log(`\n=== TOTAL ===`);
  // 2026-10-28 — formatet på första fältet är load-bearing: kedjan räknar
  // persisterade events ur raden /^fetched=\d+ future=\d+ persisted=(\d+)/m
  // (STEP_COUNT_RECIPES i scripts/ingestion-cron.ts). Lägg INTE nya fält
  // före "persisted".
  console.log(`fetched=${totals.fetched} future=${totals.future} persisted=${totals.persisted} duplicates=${totals.duplicates} errors=${totals.errors} refused=${totals.refused} unreachable=${totals.unreachable} empty=${totals.empty}`);
  if (totals.refused + totals.unreachable > 0) {
    console.log(
      `  ${totals.refused} källa/källor svarade men nekade, ${totals.unreachable} gick inte att nå — ` +
        'detta är INGA transportfel för kedjan',
    );
  }
  return { sourceCount: sources.length };
}

/**
 * 2026-10-28 — ÄRLIG SLUTKOD för steget.
 *
 * REGELN. Ett fel i EN källa är en försämring (DEGRADED), inte ett fel i
 * världen. Kedjan ska visa försämringen, men den får inte rapporteras som
 * "nätet dog" — särskilt inte när samma källa misslyckas varje natt
 * (riksarkivet.se svarar inte inom 12 s, mätt 2026-10-28).
 *
 * RÖTT blir det först när världen är trasig:
 *   - ingen källa svarade alls (nätet är nere), eller
 *   - mer än hälften av källorna gick inte att nå (nätet dog mitt i körningen).
 *
 *   exit 69 = transportfel. Kedjan går röd, operatören letar nätverksfel.
 *   exit 75 = ofullständigt (alla nekade). Kedjan visar steget som försämrat.
 *   exit 0  = steget gick igenom. Försämringar syns i degradedSteps.
 *
 * @param {number} sourceCount
 * @param {number} queueExitCode
 * @returns {number}
 */
function resolveExitCode(sourceCount, queueExitCode) {
  if (queueExitCode !== 0) return queueExitCode;
  if (sourceCount > 0 && reachableSources === 0 && failures.length > 0) {
    console.error(
      `[direct-jsonld] ingen av ${sourceCount} källor svarade — nätverket nådde inte fram (exit=69)`,
    );
    return 69;
  }
  if (failures.length * 2 > sourceCount) {
    console.error(
      `[direct-jsonld] ${failures.length} av ${sourceCount} källor gick inte att nå — världen är trasig, inte källorna (exit=69)`,
    );
    return 69;
  }
  if (sourceCount > 0 && reachableSources === 0 && refusals.length > 0) {
    console.error(
      `[direct-jsonld] alla ${refusals.length} källor svarade men nekade — inget kom in (exit=75)`,
    );
    return 75;
  }
  return 0;
}

main().then(async ({ sourceCount }) => {
  await rawEventsQueue.close();
  queueErrors.printSummary('direct-jsonld');
  // Sammanfattningen av försämringarna går till stderr med DEGRADED-markör,
  // så att kedjan ser steget som sämre än utlovat (utan att gå röd).
  if (refusals.length + failures.length > 0) {
    console.error(
      `[direct-jsonld] DEGRADED ${refusals.length + failures.length} av ${sourceCount} källor ` +
        `gick inte igenom (${failures.length} otillgängliga, ${refusals.length} nekade)`,
    );
  }
  process.exit(resolveExitCode(sourceCount, queueErrors.exitCode(totalQueued)));
}).catch((e) => { console.error('FATAL:', e); process.exit(1); });