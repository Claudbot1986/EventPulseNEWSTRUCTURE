/**
 * 03-Queue/generateMissingImages.ts — Backfill AI images for events.
 *
 * CLI som hittar events utan image_url (eller alla events om --force)
 * och genererar AI-bilder via 08-Agent/services/imageGen.
 *
 * Usage:
 *   npx tsx 03-Queue/generateMissingImages.ts                  # alla events utan image_url
 *   npx tsx 03-Queue/generateMissingImages.ts --limit 100       # cap antal events
 *   npx tsx 03-Queue/generateMissingImages.ts --source ticketmaster   # per source
 *   npx tsx 03-Queue/generateMissingImages.ts --dry-run         # testa utan API-anrop
 *   npx tsx 03-Queue/generateMissingImages.ts --force           # regenerera även events MED image_url
 *   npx tsx 03-Queue/generateMissingImages.ts --include-existing  # alias för --force
 *
 * Idempotens: dedupKey(title::venue) → samma koncept = samma bild.
 *
 * Förväntad körning:
 *   100 events utan bild ≈ 50 unika dedupGroups ≈ $1.25 kostnad (flux-dev)
 *
 * See docs/AI-IMAGE-PIPELINE-PLAN.md.
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { generateBatch } from '../08-Agent/services/imageGen.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadCliEnv(): void {
  dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
}

interface CliArgs {
  limit: number;
  source?: string;
  dryRun: boolean;
  force: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    limit: Infinity,
    dryRun: false,
    force: false,
    concurrency: 4,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) {
      args.limit = parseInt(argv[i + 1], 10);
      i++;
    } else if (a === '--source' && argv[i + 1]) {
      args.source = argv[i + 1];
      i++;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--force' || a === '--include-existing') {
      args.force = true;
    } else if (a === '--concurrency' && argv[i + 1]) {
      args.concurrency = Math.max(1, Math.min(8, parseInt(argv[i + 1], 10) || 4));
      i++;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 1) {
    args.limit = Infinity;
  }
  return args;
}

function printHelp(): void {
  console.log(`
generateMissingImages — Backfill AI images for EventPulse events.

Usage:
  npx tsx 03-Queue/generateMissingImages.ts [options]

Options:
  --limit N            Cap antal events att processera (default: alla)
  --source <id>        Filtrera per source (t.ex. 'ticketmaster')
  --concurrency N      Parallella BFL-anrop (1-8, default 4)
  --dry-run            Hämta events men anropa INTE BFL API
  --force              Regenerera även events som redan har image_url
  --include-existing   Alias för --force
  --help, -h           Visa denna hjälp

Cost: ~$0.025 per unik dedupGroup (flux-dev, 1024×1024).
Idempotent: kör flera gånger ger samma resultat utan extra kostnad.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EventPulse  │  Backfill AI images för events              ');
  console.log('═══════════════════════════════════════════════════════════');
  if (args.dryRun) console.log('  [DRY-RUN — inga BFL-anrop]');
  if (args.force) console.log('  [FORCE — regenererar även events med befintlig image_url]');
  if (args.source) console.log(`  [SOURCE-FILTER: ${args.source}]`);
  if (Number.isFinite(args.limit)) console.log(`  [LIMIT: ${args.limit}]`);
  console.log();

  if (!process.env.BFL_API_KEY) {
    console.error('  FATAL: BFL_API_KEY saknas i .env');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('  FATAL: SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas');
    process.exit(1);
  }

  if (args.dryRun) {
    // I dry-run: bara räkna events som skulle processeras
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    let q = supabase
      .from('events')
      .select('id, source, title_sv, category_slug, image_url', { count: 'exact' })
      .eq('status', 'published');

    if (!args.force) q = q.is('image_url', null);
    if (args.source) q = q.eq('source', args.source);
    if (Number.isFinite(args.limit)) q = q.limit(args.limit);

    const { data, count, error } = await q;
    if (error) {
      console.error('  FATAL:', error.message);
      process.exit(1);
    }

    console.log(`  Events som skulle processeras: ${count ?? data?.length ?? 0}`);
    if (data && data.length > 0) {
      console.log('\n  Första 5:');
      data.slice(0, 5).forEach((e) => {
        console.log(`    - [${e.source ?? '?'}] ${(e.title_sv || '').slice(0, 50)} (${e.id.slice(0, 8)})`);
      });
    }
    console.log('\n  [DRY-RUN] Ingen API-anrop gjord. Kör utan --dry-run för att faktiskt generera.\n');
    process.exit(0);
  }

  // Verklig körning
  const effectiveLimit = Number.isFinite(args.limit) ? args.limit : 1000;
  // generateBatch i imageGen.ts stöder bara onlyMissing idag (filter image_url IS NULL).
  // --force är en framtida utökning — för nu loggar vi en varning.
  if (args.force) {
    console.log('  WARNING: --force regenererar events som redan har image_url är INTE implementerat ännu.');
    console.log('     Just nu processeras bara events där image_url IS NULL.');
    console.log('     (För full force-regenerate, rensa image_url i Supabase först.)\n');
  }

  const t0 = Date.now();
  const result = await generateBatch(effectiveLimit, {
    onlyMissing: !args.force,
    concurrency: args.concurrency,
    onProgress: (done, total) => {
      const pct = ((done / total) * 100).toFixed(1);
      process.stdout.write(`\r  [${done}/${total}] ${pct}% klar`);
    },
  });
  process.stdout.write('\n');
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log();
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  KLAR  │  ${result.okCount} ok, ${result.failCount} failed  │  ${elapsed}s`);
  console.log(`         ${result.totalFetched} events hämtade, ${result.uniqueGroups} unika dedupGroups`);
  console.log(`         ~$${(result.okCount * 0.025).toFixed(2)} uppskattad kostnad`);
  console.log('═══════════════════════════════════════════════════════════');

  if (result.errors.length > 0) {
    console.log('\n  Failures:');
    result.errors.forEach((e) => {
      console.log(`    - ${e.eventIds.join(', ')}: ${e.error}`);
    });
  }

  console.log();
  process.exit(result.failCount > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  loadCliEnv();
  main().catch((err) => {
    console.error('[generateMissingImages] Fatalt fel:', err);
    process.exit(1);
  });
}
