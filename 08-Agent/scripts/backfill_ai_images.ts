/**
 * 08-Agent/scripts/backfill_ai_images.ts
 *
 * Backfill-script: garantera att ALLA publicerade events har en AI-genererad
 * bild (image_ai_generated = TRUE, image_url pekar på /event-posters/ai-generated/).
 *
 * Användning:
 *
 *   # 1. Dry-run — visa plan, ingen write, inga BFL-anrop
 *   npx tsx 08-Agent/scripts/backfill_ai_images.ts --dry-run --limit=20
 *
 *   # 2. Kör på N events (för staging-test)
 *   npx tsx 08-Agent/scripts/backfill_ai_images.ts --limit=20
 *
 *   # 3. Kör på ALLT (production)
 *   npx tsx 08-Agent/scripts/backfill_ai_images.ts
 *
 *   # 4. Force — regenerera även redan-AI-bilder (samma dedup-grupp → samma
 *   #    bild, men BFL-anrop görs FÖR VARJE dedup-nyckel)
 *   npx tsx 08-Agent/scripts/backfill_ai_images.ts --force
 *
 *   # 5. Failed-only — processa bara events med status='failed' (efter att
 *   #    transient error är fixat, t.ex. BFL rate-limit lättat)
 *   npx tsx 08-Agent/scripts/backfill_ai_images.ts --failed-only
 *
 *   # 6. No-credits-only — processa bara events med status='no_credits'
 *   #    (efter manuell BFL-recharge)
 *   npx tsx 08-Agent/scripts/backfill_ai_images.ts --no-credits-only
 *
 * Logik:
 *   1. SELECT events enligt filter (default: image_ai_generated = FALSE
 *      OR image_url IS NULL, status='published').
 *   2. Dedup-gruppera efter lower(title_sv)::lower(venue_name).
 *   3. För VARJE dedup-grupp: POST autoGenServer /generate-for-batch med
 *      EN representant. autoGen genererar EN bild och uppdaterar ALLA
 *      events i gruppen.
 *   4. Logga: antal grupper, antal events uppdaterade, total USD-uppskattning,
 *      fel per grupp.
 *
 * Idempotens: --force ej angiven → hoppa över events där
 * image_ai_generated = TRUE och image_url pekar på /event-posters/ai-generated/.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── CLI args ────────────────────────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean;
  limit: number | null;
  offset: number;
  force: boolean;
  failedOnly: boolean;
  noCreditsOnly: boolean;
  autogenUrl: string;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    limit: null,
    offset: 0,
    force: false,
    failedOnly: false,
    noCreditsOnly: false,
    autogenUrl: process.env.AI_IMAGE_AUTOGEN_URL || 'http://localhost:7790',
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--limit':
        if (next) {
          args.limit = Math.max(1, parseInt(next, 10) || 0);
          i++;
        }
        break;
      case '--offset':
        if (next) {
          args.offset = Math.max(0, parseInt(next, 10) || 0);
          i++;
        }
        break;
      case '--force':
        args.force = true;
        break;
      case '--failed-only':
        args.failedOnly = true;
        break;
      case '--no-credits-only':
        args.noCreditsOnly = true;
        break;
      case '--autogen-url':
        if (next) {
          args.autogenUrl = next;
          i++;
        }
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`[backfill] unknown flag: ${a}`);
        process.exit(1);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
backfill_ai_images — ensure all published events have AI-generated images.

Usage:
  npx tsx 08-Agent/scripts/backfill_ai_images.ts [flags]

Flags:
  --dry-run             Print plan, no DB writes, no autoGen calls
  --limit N             Process at most N events (after dedup-grouping)
  --offset N            Skip first N rows when selecting (parallel workers)
  --force               Re-generate even already-AI rows (every dedup-key
                        issues a fresh BFL call — same group → same path)
  --failed-only         Only process events with status='failed'
  --no-credits-only     Only process events with status='no_credits'
                        (use after manual BFL recharge)
  --autogen-url URL     Override AI_IMAGE_AUTOGEN_URL
  -h, --help            Show this help

Env (read from .env):
  AI_IMAGE_AUTOGEN_URL     autoGenServer endpoint (default http://localhost:7790)
  SUPABASE_URL             required
  SUPABASE_SERVICE_ROLE_KEY required
`);
}

// ── Supabase setup ──────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// ── Event row type ──────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  venues: { name: string }[] | null;
  category_slug: string | null;
  description_sv: string | null;
  description_en: string | null;
  image_url: string | null;
  image_ai_generated: boolean | null;
  image_generation_status: string | null;
}

function venueNameOf(ev: EventRow): string {
  // PostgREST returns venues as a single object `{name: "..."}` (not an array)
  // when querying with a 1-1 relation. Be defensive about both shapes.
  const v = ev.venues as unknown;
  if (Array.isArray(v)) return (v[0] as { name?: string } | undefined)?.name ?? '';
  if (v && typeof v === 'object') return (v as { name?: string }).name ?? '';
  return '';
}

function dedupKeyOf(ev: EventRow): string {
  const t = (ev.title_sv || ev.title_en || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const v = venueNameOf(ev).trim().toLowerCase().replace(/\s+/g, ' ');
  return `${t}::${v}`;
}

interface DedupGroup {
  key: string;
  ids: string[];
  representative: EventRow;
}

// ── Fetch candidates ────────────────────────────────────────────────────────

async function fetchCandidates(args: CliArgs): Promise<EventRow[]> {
  let q = supabase
    .from('events')
    .select(
      'id, title_sv, title_en, venues(name), category_slug, ' +
        'description_sv, description_en, image_url, image_ai_generated, ' +
        'image_generation_status',
    )
    .eq('status', 'published')
    .order('created_at', { ascending: true });

  if (args.noCreditsOnly) {
    q = q.eq('image_generation_status', 'no_credits');
  } else if (args.failedOnly) {
    q = q.eq('image_generation_status', 'failed');
  } else if (!args.force) {
    // Default: bara events som INTE redan är AI-genererade
    q = q.or('image_ai_generated.is.null,image_ai_generated.eq.false');
  }

  if (args.limit !== null) {
    // Hämta 2x för att kompensera för dedup-kollapsering
    q = q.limit(args.limit * 2);
  }

  if (args.offset > 0) {
    // För icke-överlappande parallella workers: skippa första N events
    q = q.range(args.offset, args.offset + (args.limit ?? 2000) * 2 - 1);
  }

  const { data, error } = await q;
  if (error) throw new Error(`supabase fetch failed: ${error.message}`);
  return (data ?? []) as unknown as EventRow[];
}

function groupByDedup(events: EventRow[]): DedupGroup[] {
  const map = new Map<string, DedupGroup>();
  for (const ev of events) {
    const key = dedupKeyOf(ev);
    if (!key || key === '::') continue; // skippa events utan titel+venue
    if (!map.has(key)) {
      map.set(key, { key, ids: [], representative: ev });
    }
    map.get(key)!.ids.push(ev.id);
  }
  // Sortera: största grupper först (max impact)
  return Array.from(map.values()).sort((a, b) => b.ids.length - a.ids.length);
}

// ── autoGen call ────────────────────────────────────────────────────────────

interface BatchResult {
  ok: boolean;
  totalGroups: number;
  okCount: number;
  failCount: number;
  results: Array<{
    ok: boolean;
    key: string;
    eventIds: string[];
    imageUrl?: string;
    storagePath?: string;
    prompt?: string;
    error?: string;
  }>;
}

async function callAutoGenBatch(
  url: string,
  representative: EventRow,
): Promise<BatchResult> {
  const res = await fetch(`${url}/generate-for-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      events: [
        {
          id: representative.id,
          title_sv: representative.title_sv,
          // Many events have title_sv=null (English-only ingest). Send
          // title_en as `title` fallback so autoGen's `title_sv || title`
          // dedup still matches.
          title: representative.title_en ?? representative.title_sv ?? '',
          title_en: representative.title_en,
          description_sv: representative.description_sv,
          description_en: representative.description_en,
          venues: representative.venues,
          category_slug: representative.category_slug,
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`autoGen HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as BatchResult;
}

// ── Main ────────────────────────────────────────────────────────────────────

interface GroupOutcome {
  key: string;
  ok: boolean;
  eventsTouched: number;
  imageUrl?: string;
  error?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  console.log(
    `[backfill] flags: dry-run=${args.dryRun} limit=${args.limit ?? 'none'} ` +
      `force=${args.force} failed-only=${args.failedOnly} ` +
      `no-credits-only=${args.noCreditsOnly}`,
  );
  console.log(`[backfill] autoGen URL: ${args.autogenUrl}`);

  console.log('[backfill] fetching candidates…');
  const candidates = await fetchCandidates(args);
  console.log(`[backfill] fetched ${candidates.length} candidate events`);

  const groups = groupByDedup(candidates);
  const totalEvents = groups.reduce((n, g) => n + g.ids.length, 0);
  console.log(
    `[backfill] dedup → ${groups.length} unika grupper ` +
      `(av ${totalEvents} events efter dedup-kollaps)`,
  );

  if (args.limit !== null) {
    // Begränsa antal grupper (inte events) till limit
    const truncated = groups.slice(0, args.limit);
    if (truncated.length < groups.length) {
      console.log(
        `[backfill] --limit=${args.limit} → processar bara första ${truncated.length} grupperna`,
      );
    }
    groups.length = 0;
    groups.push(...truncated);
  }

  if (args.dryRun) {
    console.log('[backfill] DRY RUN — visar plan utan att skriva/anropa BFL:');
    let totalEstimatedCost = 0;
    for (const g of groups) {
      const venue = venueNameOf(g.representative);
      const status = g.representative.image_generation_status ?? 'null';
      console.log(
        `  - key="${g.key}" ids=${g.ids.length} status=${status} ` +
          `venue="${venue}"`,
      );
      totalEstimatedCost += 0.025; // BFL flux-dev ~$0.025/bild per dedup-grupp
    }
    console.log('');
    console.log(`[backfill] DRY RUN summary:`);
    console.log(`  groups:        ${groups.length}`);
    console.log(`  events:        ${groups.reduce((n, g) => n + g.ids.length, 0)}`);
    console.log(`  estimated USD: $${totalEstimatedCost.toFixed(3)} (1 BFL-call per grupp)`);
    console.log(`  to run for real: remove --dry-run`);
    return;
  }

  console.log(`[backfill] processing ${groups.length} groups…`);
  const outcomes: GroupOutcome[] = [];
  const startMs = Date.now();

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const venue = venueNameOf(g.representative);
    const status = g.representative.image_generation_status ?? 'null';
    console.log(
      `[backfill] [${i + 1}/${groups.length}] "${g.key}" (${g.ids.length} events, status=${status}, venue="${venue}")`,
    );

    try {
      const result = await callAutoGenBatch(args.autogenUrl, g.representative);
      const ok = result.results.find((r) => r.key === g.key);
      if (!ok || !ok.ok || !ok.imageUrl) {
        const err = ok?.error ?? 'no result for this key';
        console.error(`  ✗ FAILED: ${err}`);
        outcomes.push({ key: g.key, ok: false, eventsTouched: 0, error: err });
        continue;
      }
      outcomes.push({
        key: g.key,
        ok: true,
        eventsTouched: g.ids.length,
        imageUrl: ok.imageUrl,
      });
      console.log(
        `  ✓ ok → ${g.ids.length} event(s) updated, url=${ok.imageUrl}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      console.error(`  ✗ EXCEPTION: ${msg}`);
      outcomes.push({ key: g.key, ok: false, eventsTouched: 0, error: msg });
    }
  }

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - ok;
  const totalUpdated = outcomes
    .filter((o) => o.ok)
    .reduce((n, o) => n + o.eventsTouched, 0);

  console.log('');
  console.log(`[backfill] DONE in ${elapsedSec}s`);
  console.log(`  groups processed: ${outcomes.length}`);
  console.log(`  groups ok:        ${ok}`);
  console.log(`  groups failed:    ${failed}`);
  console.log(`  events updated:   ${totalUpdated}`);
  console.log(
    `  estimated USD:    $${(ok * 0.025).toFixed(3)} (1 BFL-call per ok grupp)`,
  );

  if (failed > 0) {
    console.log('');
    console.log('[backfill] failed groups:');
    for (const o of outcomes) {
      if (o.ok) continue;
      console.log(`  - "${o.key}" → ${o.error}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error('[backfill] FATAL:', err);
  process.exit(1);
});
