/**
 * runDiscovery — CLI entrypoint för URLBank source discovery.
 *
 * Läser runtime/sources_status.jsonl, genererar kandidat-URLs per aktiv källa
 * baserat på productivity + stability heuristics, och skriver till
 * runtime/discovery-candidates.jsonl (om inte --dry-run).
 *
 * OBS: "source-candidate auto-promotion" är DO NOT BUILD YET enligt BACKLOG.
 * Output INTE auto-appliceras — kandidater granskas manuellt (eller av supervisor)
 * innan de flyttas in i riktiga source configs.
 *
 * Användning:
 *   npx tsx 02-Ingestion/G-universalScout/runDiscovery.ts [options]
 *
 *   --source-id <id>    En specifik källa
 *   --limit N           Max N källor att processa (default: alla)
 *   --dry-run           Visa kandidater utan att skriva till disk
 *   --min-score <num>   Tröskelvärde (default: 0.05)
 *   --all-status        Inkludera även icke-success källor (default: false)
 *   --help              Visa hjälp
 */

import { runDiscovery, writeCandidates } from './urlbank.js';
import type { DiscoveryCandidate } from './urlbank.js';

interface CliOptions {
  sourceId?: string;
  limit?: number;
  dryRun: boolean;
  minScore: number;
  onlySuccess: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    minScore: 0.05,
    onlySuccess: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--source-id':
        opts.sourceId = argv[++i];
        break;
      case '--limit':
        opts.limit = Number(argv[++i]);
        if (!Number.isFinite(opts.limit) || opts.limit <= 0) {
          throw new Error(`--limit måste vara positivt nummer, fick: ${argv[i]}`);
        }
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--min-score':
        opts.minScore = Number(argv[++i]);
        if (!Number.isFinite(opts.minScore) || opts.minScore < 0) {
          throw new Error(`--min-score måste vara >= 0, fick: ${argv[i]}`);
        }
        break;
      case '--all-status':
        opts.onlySuccess = false;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        console.warn(`[runDiscovery] okänd flagga ignoreras: ${a}`);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`runDiscovery — URLBank-style source discovery

Användning:
  npx tsx 02-Ingestion/G-universalScout/runDiscovery.ts [options]

Options:
  --source-id <id>    En specifik källa (default: alla)
  --limit N           Max N källor att processa (default: alla)
  --dry-run           Visa kandidater utan att skriva till disk
  --min-score <num>   Tröskelvärde (default: 0.05)
  --all-status        Inkludera även icke-success källor
  --help, -h          Visa denna hjälp

Output:
  runtime/discovery-candidates.jsonl (om inte --dry-run)

OBS: source-candidate auto-promotion är DO NOT BUILD YET enligt BACKLOG.
Kandidater granskas manuellt innan de flyttas in i riktiga source configs.
`);
}

function formatCandidate(c: DiscoveryCandidate): string {
  return `  [score=${c.score.toFixed(3)} prod=${c.productivity} stab=${c.stability}] ${c.candidateUrl}\n    reason: ${c.reason}`;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  console.log(`[runDiscovery] start`);
  console.log(`[runDiscovery]   sourceId: ${opts.sourceId ?? '(all)'}`);
  console.log(`[runDiscovery]   limit: ${opts.limit ?? '(all)'}`);
  console.log(`[runDiscovery]   min-score: ${opts.minScore}`);
  console.log(`[runDiscovery]   dry-run: ${opts.dryRun}`);
  console.log(`[runDiscovery]   only-success: ${opts.onlySuccess}`);

  const candidates = await runDiscovery({
    sourceId: opts.sourceId,
    limit: opts.limit,
    minScore: opts.minScore,
    onlySuccess: opts.onlySuccess,
  });

  console.log(`\n[runDiscovery] ${candidates.length} kandidater hittade`);

  const bySource = new Map<string, DiscoveryCandidate[]>();
  for (const c of candidates) {
    if (!bySource.has(c.sourceId)) bySource.set(c.sourceId, []);
    bySource.get(c.sourceId)!.push(c);
  }

  for (const [sourceId, list] of bySource.entries()) {
    console.log(`\n── ${sourceId} (${list.length} kandidater) ──`);
    for (const c of list) {
      console.log(formatCandidate(c));
    }
  }

  if (opts.dryRun) {
    console.log(`\n[runDiscovery] dry-run — inget skrivet till disk.`);
    return;
  }

  if (candidates.length === 0) {
    console.log(`\n[runDiscovery] inga kandidater — inget att skriva.`);
    return;
  }

  const written = writeCandidates(candidates);
  console.log(`\n[runDiscovery] ${written} nya rader skrivna till runtime/discovery-candidates.jsonl`);
  console.log(`[runDiscovery] (befintliga rader med samma sourceId+candidateUrl skrivs över med nya scores)`);
}

main().catch((e) => {
  console.error(`[runDiscovery] FATAL: ${(e as Error).message}`);
  console.error((e as Error).stack);
  process.exit(1);
});