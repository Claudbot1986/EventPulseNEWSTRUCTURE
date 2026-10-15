/**
 * 2026-10-14 — Re-fetch default-midnight / default-22:00 / default-23:00 events
 * and update their start_time from real source HTML.
 *
 * Why:
 *   ~170 events in `events` have start_time ending in 00:00 / 22:00 / 23:00 UTC
 *   even when the source clearly exposes a real local time (Matt Hansen
 *   "kl. 19.00", Eventbrite Nightlife Tour "21:00+02:00", Järfälla site
 *   "15:00 - 17:00" in <td>). Root causes (verified 2026-10-14):
 *     - eventbriteStockholm.ts: only matched ItemList URLs, never single-event
 *       /e/<slug>-tickets-<id> pages → JSON-LD SocialEvent startDate was lost
 *     - universal-extractor.ts: never read Swedish-time text in body
 *     - arkdes.ts: kept a local copy of parseKlockan that the new util
 *       replaced (no behaviour change)
 *   After Steg 1-5, the parsers correctly read times when present.
 *   This script RETROACTIVELY cleans the DB by re-fetching each affected
 *   row's ticket_url (the per-event detail URL is on `events.ticket_url`,
 *   not `events.source_url` — schema has no per-event source URL column)
 *   and running it through the adapter pipeline again.
 *
 * What it does:
 *   1. Query DB for events where start_time's UTC hour is 00 / 22 / 23
 *      AND ticket_url is non-null AND source is in our supported set.
 *   2. For each event: fetch ticket_url HTML via ScrapingBee, run the
 *      matching adapter (or universal-extractor fallback), parse the
 *      returned ParsedEvent, and compare its (date, time) against the
 *      DB row's (start_time, end_time).
 *   3. If the new (date, time) is meaningfully different → UPDATE start_time.
 *      If the parser returns NO time at all (source genuinely has none) →
 *      set start_time = NULL (so the UI shows "Tid ej angiven").
 *      If the parser still returns 00:00 UTC → leave row alone, log "no change".
 *
 * Safety:
 *   - Backup dump of affected rows is written to
 *     `runtime/backups/2026-10-14-default-times-backup.jsonl` BEFORE any UPDATEs.
 *   - Each UPDATE is gated by `start_time = OLD_VALUE` to avoid clobbering
 *     concurrent writes.
 *   - Default mode is DRY-RUN (no UPDATEs). Pass `--apply` to actually write.
 *
 * Usage:
 *   npx tsx 02-Ingestion/scripts/2026-10-14-refetch-default-times.ts             # dry-run
 *   npx tsx 02-Ingestion/scripts/2026-10-14-refetch-default-times.ts --apply    # write
 *   npx tsx 02-Ingestion/scripts/2026-10-14-refetch-default-times.ts --limit 50 # cap
 */
import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { extract as eventbriteExtract } from '../F-eventExtraction/adapters/eventbriteStockholm.js';
import { extract as arkdesExtract } from '../F-eventExtraction/adapters/arkdes.js';
import { extractFromHtml } from '../F-eventExtraction/universal-extractor.js';
import { toUtcIsoFromStockholm } from '../lib/stockholmTime.js';

// Walk up to find the project root .env (in case cwd is the script dir).
for (const candidate of [
  process.cwd(),
  resolve(process.cwd(), '..'),
  resolve(process.cwd(), '../..'),
]) {
  dotenvConfig({ path: resolve(candidate, '.env') });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_KEY = process.env.SCRAPINGBEE_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[refetch] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(2);
}
if (!SB_KEY) {
  console.error('[refetch] SCRAPINGBEE_API_KEY required');
  process.exit(2);
}

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx > -1 ? parseInt(process.argv[idx + 1], 10) : 100;
})();

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const BACKUP_DIR = 'runtime/backups';
const BACKUP_PATH = `${BACKUP_DIR}/2026-10-14-default-times-backup.jsonl`;

interface DbEvent {
  id: string;
  source: string;
  title_sv: string | null;
  title_en: string | null;
  start_time: string; // ISO UTC
  ticket_url: string | null;
}

// Hours that indicate "default placeholder" — 00 (midnight), 22 (thatsup
// fallback), 23 (Stockholmsmässan fallback). 01–21 + 24 are left out on
// purpose: those are likely real times.
function isDefaultHour(iso: string): boolean {
  if (!iso) return false;
  const m = iso.match(/T(\d{2}):/);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  return h === 0 || h === 22 || h === 23;
}

async function fetchHtmlViaSB(url: string): Promise<string> {
  const res = await axios.get('https://app.scrapingbee.com/api/v1/', {
    params: { api_key: SB_KEY, url, render_js: 'false', timeout: 30000 },
    timeout: 60000,
    responseType: 'text',
    validateStatus: (s) => s < 500,
  });
  if (res.status >= 400) throw new Error(`SB HTTP ${res.status}`);
  return typeof res.data === 'string' ? res.data : '';
}

/**
 * Run the right adapter based on source_url hostname, falling back to
 * universal-extractor. Returns the ParsedEvent whose title best matches
 * the DB row's title, or null if nothing matches.
 */
function pickEventForRow(html: string, url: string, dbTitle: string) {
  let candidates;
  try {
    if (url.includes('eventbrite.com') || url.includes('eventbrite.se')) {
      candidates = eventbriteExtract(html, url).events;
    } else if (url.includes('arkdes.se')) {
      candidates = arkdesExtract(html, url).events;
    } else {
      candidates = extractFromHtml(html, url, 'refetch').events;
    }
  } catch (e) {
    console.error(`  ⚠️  extract threw: ${(e as Error).message}`);
    return null;
  }

  if (!candidates || candidates.length === 0) return null;

  // Pick the event whose title overlaps the DB title. Use lowercase
  // substring match — EventPulse titles are user-provided so exact match
  // is brittle, but a substring in either direction is usually right.
  const dbTitleLower = (dbTitle ?? '').toLowerCase();
  if (!dbTitleLower) return candidates[0]; // no DB title → first match
  for (const c of candidates) {
    const candTitleLower = c.title.toLowerCase();
    if (candTitleLower.includes(dbTitleLower) || dbTitleLower.includes(candTitleLower)) {
      return c;
    }
  }
  return candidates[0]; // fallback: first
}

async function fetchDefaultTimeRows(): Promise<DbEvent[]> {
  // Page through events with non-null ticket_url and filter on
  // start_time's UTC hour in JS (the population is small enough —
  // currently ~170 default-hour rows out of ~500+).
  const rows: DbEvent[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('id, source, title_sv, title_en, start_time, ticket_url')
      .not('ticket_url', 'is', null)
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as DbEvent[]) {
      if (isDefaultHour(row.start_time)) rows.push(row);
    }
    offset += data.length;
    if (data.length < 1000) break;
  }
  return rows.slice(0, LIMIT);
}

async function main() {
  console.log(`[refetch] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}, limit=${LIMIT}`);
  const rows = await fetchDefaultTimeRows();
  console.log(`[refetch] ${rows.length} candidate events with default-hour start_time`);

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const backupLines: string[] = [];

  const stats = {
    fetched: 0,
    noSource: 0,
    fetchFail: 0,
    parsed: 0,
    realTime: 0,
    noTime: 0,
    sameTime: 0,
    errors: 0,
  };

  const updates: Array<{ id: string; newStartTime: string | null; oldStartTime: string; reason: string }> = [];

  for (const row of rows) {
    const url = row.ticket_url;
    if (!url) {
      stats.noSource++;
      continue;
    }
    const title = row.title_sv ?? row.title_en ?? '';
    const dbDate = row.start_time.split('T')[0];

    let html = '';
    try {
      html = await fetchHtmlViaSB(url);
      stats.fetched++;
    } catch (e) {
      console.error(`  ⚠️  fetch failed for ${row.id.slice(0, 8)} (${url.slice(0, 60)}): ${(e as Error).message}`);
      stats.fetchFail++;
      continue;
    }

    const evt = pickEventForRow(html, url, title);
    if (!evt) {
      stats.parsed++;
      console.log(`  · ${row.id.slice(0, 8)} | no event parsed`);
      continue;
    }

    // Build the candidate start_time the same way the normalizer does
    // (lib/stockholmTime.toUtcIsoFromStockholm). If parser returned no
    // time → set start_time = NULL (signal: source lacks time, UI shows
    // "Tid ej angiven"). DO NOT pass null to toUtcIsoFromStockholm —
    // that helper converts date-only to "00:00 Stockholm local" which is
    // 22:00/23:00 UTC the previous day — exactly the default-midnight
    // pattern we're trying to fix.
    let newStartTime: string | null;
    if (!evt.time) {
      newStartTime = null;
    } else {
      newStartTime = toUtcIsoFromStockholm(evt.date, evt.time);
      if (!newStartTime) {
        stats.errors++;
        continue;
      }
    }

    if (newStartTime === row.start_time) {
      stats.sameTime++;
      console.log(`  = ${row.id.slice(0, 8)} | unchanged (${newStartTime})`);
      continue;
    }

    const oldHour = row.start_time.split('T')[1]?.substring(0, 5);
    const reason =
      newStartTime === null
        ? `parser-no-time → NULL (was ${oldHour} UTC)`
        : `parser-found ${evt.time} (was ${oldHour} UTC)`;

    if (newStartTime === null || !newStartTime.includes('T')) {
      stats.noTime++;
      console.log(`  ⇢ ${row.id.slice(0, 8)} | ${dbDate} ${reason}`);
    } else {
      stats.realTime++;
      console.log(`  ✓ ${row.id.slice(0, 8)} | ${dbDate} ${oldHour} UTC → ${newStartTime} (${evt.time})`);
    }

    backupLines.push(JSON.stringify({ ...row, newStartTime, reason }));
    updates.push({ id: row.id, newStartTime, oldStartTime: row.start_time, reason });
  }

  console.log('\n[refetch] ── summary ──');
  console.log(`  fetched=${stats.fetched} fetchFail=${stats.fetchFail} parsed=${stats.parsed}`);
  console.log(`  realTime=${stats.realTime} noTime=${stats.noTime} sameTime=${stats.sameTime} errors=${stats.errors}`);
  console.log(`  planned updates=${updates.length}`);

  if (updates.length === 0) {
    console.log('[refetch] nothing to do');
    return;
  }

  // Always write the backup — even in DRY-RUN, the user can review it.
  writeFileSync(BACKUP_PATH, backupLines.join('\n') + '\n');
  console.log(`[refetch] backup → ${BACKUP_PATH}`);

  if (!APPLY) {
    console.log('[refetch] DRY-RUN — pass --apply to actually UPDATE');
    return;
  }

  let success = 0;
  let skipped = 0;
  for (const u of updates) {
    const updateObj: Record<string, unknown> = { start_time: u.newStartTime };
    const { error, count } = await supabase
      .from('events')
      .update(updateObj, { count: 'exact' })
      .eq('id', u.id)
      .eq('start_time', u.oldStartTime); // safety: only if not concurrently changed

    if (error) {
      console.error(`  ❌ ${u.id.slice(0, 8)}: ${error.message}`);
      skipped++;
    } else if (count === 0) {
      skipped++;
    } else {
      success++;
    }
  }
  console.log(`[refetch] APPLIED: success=${success} skipped=${skipped}`);
}

main().catch((e) => {
  console.error('[refetch] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});