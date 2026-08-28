/**
 * runD-constrained-agent.ts — CLI för constrained AI agent (render fallback)
 *
 * Pipeline: generate → execute (validate) → check → fix → save
 *
 * Användning:
 *   npx tsx 02-Ingestion/D-renderGate/runD-constrained-agent.ts --source-id <id>
 *   npx tsx 02-Ingestion/D-renderGate/runD-constrained-agent.ts --from-url <url>
 *   npx tsx 02-Ingestion/D-renderGate/runD-constrained-agent.ts --source-id <id> --validate-only
 *   npx tsx 02-Ingestion/D-renderGate/runD-constrained-agent.ts --source-id <id> --max-tokens 2000
 *
 * Indata:
 *   - --source-id <id>  : slå upp URL via sourceRegistry
 *   - --from-url <url>  : godtycklig URL (för discovery)
 *   - --validate-only   : kör hela pipeline, spara INTE adapter
 *   - --max-tokens <n>  : cap per AI-anrop (default 2000)
 *   - --force           : skriv över befintlig adapter
 *   - --dry             : skriv inte manifest
 *   - --show            : skriv ut config till stdout
 *
 * Utdata:
 *   - runtime/adapters/{sourceId}.json
 *   - runtime/adapters/_manifest.jsonl (append)
 *   - runtime/logs/runD-constrained-agent-{ISO}.log
 *
 * Säkerhet:
 *   - Skriver inte kod som körs — bara JSON-config
 *   - Token-cap förhindrar prompt-bomb
 *   - Closed loop: max 3 fix-iterations inbyggt i pipeline
 */

import { writeFileSync, mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import {
  runPipeline,
  saveAdapter,
  loadAdapter,
  appendManifest,
  type CollectorConfig,
  type CollectorType,
} from './constrainedAgent.js';
import { getSource } from '../tools/sourceRegistry.js';

const __filename = (() => {
  try { return decodeURIComponent(new URL(import.meta.url).pathname); } catch { return ''; }
})();

const PROJECT_ROOT = path.resolve(__filename, '../../..');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');

dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env'), override: true });

const RUN_LOG = path.resolve(LOGS_DIR, `runD-constrained-agent-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + '\n', 'utf8');
}

interface CliArgs {
  sourceId?: string;
  url?: string;
  validateOnly: boolean;
  maxTokens: number;
  force: boolean;
  dry: boolean;
  showOnly: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    sourceId: get('--source-id'),
    url: get('--from-url'),
    validateOnly: argv.includes('--validate-only'),
    maxTokens: parseInt(get('--max-tokens') || '2000', 10),
    force: argv.includes('--force'),
    dry: argv.includes('--dry'),
    showOnly: argv.includes('--show'),
  };
}

function resolveUrl(args: CliArgs): { sourceId: string; url: string } {
  if (args.sourceId) {
    const source = getSource(args.sourceId);
    if (!source) {
      throw new Error(`Source "${args.sourceId}" not found in sourceRegistry`);
    }
    return { sourceId: args.sourceId, url: source.url };
  }
  if (args.url) {
    try {
      const u = new URL(args.url);
      const slug = u.host.replace(/^www\./, '').replace(/\./g, '-') + u.pathname.replace(/[^a-z0-9]/gi, '-').slice(0, 30);
      return { sourceId: `adhoc-${slug}`.toLowerCase(), url: args.url };
    } catch {
      throw new Error(`Invalid URL: ${args.url}`);
    }
  }
  throw new Error('Either --source-id <id> or --from-url <url> is required');
}

async function main() {
  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(RUN_LOG, '', 'utf8');

  const args = parseArgs();
  const { sourceId, url } = resolveUrl(args);

  log('═══════════════════════════════════════════════════════════════════');
  log('D-AI Constrained Agent — Render Fallback');
  log(`sourceId=${sourceId} url=${url}`);
  log(`validateOnly=${args.validateOnly} maxTokens=${args.maxTokens} force=${args.force}`);
  log('═══════════════════════════════════════════════════════════════════');

  // Kolla om adapter redan finns
  const existing = loadAdapter(sourceId);
  if (existing && !args.force) {
    log(`[EXISTS] Adapter for ${sourceId} already exists at runtime/adapters/${sourceId}.json`);
    log(`  type=${existing.type} aiConfidence=${existing.aiConfidence} validationPassed=${existing.validationPassed}`);
    log(`  Use --force to overwrite.`);
    if (args.showOnly) {
      console.log(JSON.stringify(existing, null, 2));
    }
    return;
  }

  // Kör pipeline
  const result = await runPipeline({
    sourceId,
    url,
    maxTokens: args.maxTokens,
    rateLimitMs: 1500,
    validateOnly: args.validateOnly,
  });

  log(`[PIPELINE] iterations=${result.iterations} tokens=${result.promptTokens}+${result.responseTokens}`);
  log(`[PIPELINE] validationPassed=${result.validationPassed} notes=${result.validationNotes}`);

  const cfg: CollectorConfig = result.config;
  const selectedSelectors = Object.keys(cfg.selectors).filter(k => Boolean((cfg.selectors as Record<string, unknown>)[k]));
  log(`[CONFIG] type=${cfg.type} selectors=${selectedSelectors.join(',')}`);
  log(`[CONFIG] aiConfidence=${cfg.aiConfidence} candidateUrls=${cfg.candidateUrls?.length ?? 0}`);

  if (cfg.validationPassed) {
    log(`[OK] Config validated against HTML sample`);
  } else {
    log(`[WARN] Config did NOT validate. Consider manual review or different source.`);
  }

  // Spara om ej validate-only
  if (!args.validateOnly) {
    const file = saveAdapter(cfg);
    log(`[SAVED] ${file}`);
    if (!args.dry) {
      appendManifest({
        sourceId,
        savedAt: new Date().toISOString(),
        type: cfg.type as CollectorType,
        aiConfidence: cfg.aiConfidence,
        validationPassed: !!cfg.validationPassed,
        validationNotes: cfg.validationNotes,
        iterations: result.iterations,
        tokens: { prompt: result.promptTokens, response: result.responseTokens },
        file,
      });
      log(`[MANIFEST] Appended to runtime/adapters/_manifest.jsonl`);
    }
  } else {
    log(`[VALIDATE-ONLY] No file saved.`);
  }

  if (args.showOnly) {
    console.log(JSON.stringify(cfg, null, 2));
  }

  log('═══════════════════════════════════════════════════════════════════');
  log(`SUMMARY: ${cfg.validationPassed ? 'PASS' : 'FAIL'} | tokens: ${result.promptTokens}+${result.responseTokens} | iterations: ${result.iterations}`);
  log('═══════════════════════════════════════════════════════════════════');

  process.exit(cfg.validationPassed ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  appendFileSync(RUN_LOG, `\n[FATAL] ${(e as Error).message}\n${(e as Error).stack || ''}\n`, 'utf8');
  process.exit(1);
});
