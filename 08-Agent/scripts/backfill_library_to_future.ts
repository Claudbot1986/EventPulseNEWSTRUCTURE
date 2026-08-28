/**
 * 08-Agent/scripts/backfill_library_to_future.ts
 *
 * En-gångs-backfill: tilldela biblioteks-bilder till framtida events som
 * saknar AI-genererad bild. Mål: fylla Utforska-feed med fina bilder utan att
 * bränna BFL-kredit.
 *
 * Logik:
 *   1. Kör `backfillFromPastAi()` först om biblioteket är tomt — extraherar
 *      1 246 unika past-AI-URL:er med kategori-metadata.
 *   2. SELECT future events där image_url IS NULL eller image_ai_generated=false.
 *   3. För VARJE event: pickLibraryFallback(category_slug) → om match,
 *      markEventWithLibraryFallback(event_id, match).
 *   4. Logga: antal events processed, antal med library match, antal utan.
 *
 * Idempotens: markEventWithLibraryFallback är idempotent (samma URL om
 * biblioteket inte ändras). Kör flera gånger = samma slutresultat.
 *
 * Användning:
 *   # Dry-run (default) — visa plan, inga writes
 *   npx tsx 08-Agent/scripts/backfill_library_to_future.ts
 *
 *   # Verklig körning
 *   npx tsx 08-Agent/scripts/backfill_library_to_future.ts --apply
 *
 *   # Hoppa över steg 1 (om biblioteket redan är populerat)
 *   npx tsx 08-Agent/scripts/backfill_library_to_future.ts --skip-past-ai-backfill --apply
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  pickLibraryFallback,
  markEventWithLibraryFallback,
  backfillFromPastAi,
} from '../utils/imageLibrary';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

interface EventRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  category_slug: string | null;
  start_time: string | null;
  image_url: string | null;
  image_ai_generated: boolean | null;
}

interface CliArgs {
  apply: boolean;
  limit: number | null;
  skipPastAiBackfill: boolean;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const args: CliArgs = {
    apply: false,
    limit: null,
    skipPastAiBackfill: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--apply':
        args.apply = true;
        break;
      case '--limit':
        if (next) {
          args.limit = Math.max(1, parseInt(next, 10) || 0);
          i++;
        }
        break;
      case '--skip-past-ai-backfill':
        args.skipPastAiBackfill = true;
        break;
      case '--help':
      case '-h':
        console.log(`
backfill_library_to_future — assign library images to future events.

Usage:
  npx tsx 08-Agent/scripts/backfill_library_to_future.ts [flags]

Flags:
  --apply                   Actually mark events with library URL (step 2).
                            Step 1 (populating library from past-AI) is always
                            idempotent — no flag needed for that.
                            Default = step 2 dry-run (read-only).
  --limit N                 Process at most N events.
  --skip-past-ai-backfill   Skip step 1 (don't populate library from past-AI).
                            Use when library is already populated.
  -h, --help                Show this help.

Default workflow:
  1. backfillFromPastAi() — always runs, idempotent
  2. For each future event with no AI image → pickLibraryFallback → assign
     (writes only with --apply)
`);
        process.exit(0);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  console.log(`[library-backfill] flags: apply=${args.apply} limit=${args.limit ?? 'none'} skip-past-ai-backfill=${args.skipPastAiBackfill}`);

  // ── Steg 1: Populera biblioteket med past-AI-bilder ──
  // Idempotent — storage_path är UNIQUE. Kör alltid så dry-run-outputen
  // är meningsfull (steg 2 måste ha ett populerat bibliotek att fråga).
  // Hoppa över med --skip-past-ai-backfill om biblioteket redan är fyllt.
  if (!args.skipPastAiBackfill) {
    console.log('[library-backfill] Steg 1: populating library from past-AI URLs…');
    const pastAiResult = await backfillFromPastAi({ dryRun: false });
    console.log(
      `[library-backfill] past-AI inserted: ${pastAiResult.inserted} ` +
        `(skipped: ${pastAiResult.skipped}, total unique URLs: ${pastAiResult.total})`,
    );
  } else {
    console.log('[library-backfill] Steg 1: SKIPPED (--skip-past-ai-backfill)');
  }

  // ── Steg 2: Hämta future events som behöver bild ──
  console.log('[library-backfill] Steg 2: fetching future events without AI image…');
  let q = supabase
    .from('events')
    .select('id, title_sv, title_en, category_slug, start_time, image_url, image_ai_generated')
    .eq('status', 'published')
    .gt('start_time', new Date().toISOString())
    .or('image_url.is.null,image_ai_generated.eq.false')
    .order('start_time', { ascending: true });

  if (args.limit !== null) {
    q = q.limit(args.limit);
  }

  const { data: events, error } = await q;
  if (error) throw new Error(`fetch future events failed: ${error.message}`);
  if (!events || events.length === 0) {
    console.log('[library-backfill] No future events need library images. Done.');
    return;
  }
  console.log(`[library-backfill] fetched ${events.length} future event(s) needing image`);

  // ── Steg 3: Tilldela biblioteks-bild ──
  const rows = events as unknown as EventRow[];
  let assigned = 0;
  let noMatch = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const ev = rows[i];
    const match = await pickLibraryFallback({
      category_slug: ev.category_slug,
    });

    if (!match.url || !match.library_id) {
      noMatch++;
      if (i < 10 || i % 100 === 0) {
        console.log(`[library-backfill]   [${i + 1}/${rows.length}] ${ev.id} → no library match (cat=${ev.category_slug ?? 'null'})`);
      }
      continue;
    }

    if (!args.apply) {
      // Dry-run: räkna bara
      assigned++;
      if (i < 10 || i % 100 === 0) {
        console.log(
          `[library-backfill]   [${i + 1}/${rows.length}] ${ev.id} → would assign ` +
            `library_id=${match.library_id} match_type=${match.match_type}`,
        );
      }
      continue;
    }

    // Apply: skriv till DB
    try {
      await markEventWithLibraryFallback(ev.id, match);
      assigned++;
      if (i < 10 || i % 100 === 0) {
        console.log(
          `[library-backfill]   [${i + 1}/${rows.length}] ${ev.id} → ✓ assigned ` +
            `library_id=${match.library_id} match_type=${match.match_type}`,
        );
      }
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : 'unknown';
      console.error(`[library-backfill]   [${i + 1}/${rows.length}] ${ev.id} → ✗ ${msg}`);
    }
  }

  console.log('');
  console.log(`[library-backfill] DONE ${args.apply ? '(applied)' : '(dry-run)'}`);
  console.log(`  total events:    ${rows.length}`);
  console.log(`  assigned:        ${assigned}`);
  console.log(`  no match:        ${noMatch}`);
  console.log(`  failed:          ${failed}`);
  console.log(`  match rate:      ${((assigned / rows.length) * 100).toFixed(1)}%`);

  if (!args.apply && assigned > 0) {
    console.log('');
    console.log(`[library-backfill] Run with --apply to actually write to DB.`);
  }
}

main().catch((err: unknown) => {
  console.error('[library-backfill] FATAL:', err);
  process.exit(1);
});