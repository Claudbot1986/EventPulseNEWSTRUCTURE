/**
 * scB-404-recovery.ts — Source URL Recovery Tool
 *
 * For sources in postTestC-serverdown and postTestC-404 queues:
 *  1. Ask MiniMax (minimax-m2.7:cloud) what the new event URL might be
 *  2. Verify the suggested URL is alive (HEAD → 200)
 *  3. Write corrected sources to postB-preC-queue.jsonl
 *  4. Log all corrections to runtime/corrections.csv
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/tools/scB-404-recovery.ts
 *   npx tsx 02-Ingestion/C-htmlGate/tools/scB-404-recovery.ts <sourceId>
 *   npx tsx 02-Ingestion/C-htmlGate/tools/scB-404-recovery.ts --dry-run
 */

import axios from 'axios';
import { getSource, updateSourceUrl } from '../../tools/sourceRegistry';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  writeFileSync,
  appendFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

const RUNTIME_DIR = path.resolve(__dirname, '../../../runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `scB-404-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const CORRECTIONS_CSV = path.resolve(RUNTIME_DIR, 'corrections.csv');
const OUTPUT_QUEUE = path.resolve(RUNTIME_DIR, 'postB-preC-queue.jsonl');

const IN_QUEUES = {
  serverdown: path.resolve(RUNTIME_DIR, 'postTestC-serverdown.jsonl'),
  '404': path.resolve(RUNTIME_DIR, 'postTestC-404.jsonl'),
};

// --- Log helper — terminal + per-run file ---

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + '\n', 'utf8');
}

// --- Ollama / MiniMax ---

async function askMiniMax(domain: string, oldUrl: string): Promise<string> {
  const prompt = `Given the domain "${domain}" which previously hosted events at "${oldUrl}".
The page is now returning 404 or the server is down.

What is the most likely current URL for their events/calendar page?
Answer with only the URL, nothing else. If you don't know, say "UNKNOWN".`;

  return new Promise((resolve) => {
    const proc = spawn(
      'ollama',
      [
        'launch', 'claude',
        '--model', 'minimax-m2.7:cloud',
        '--', '--dangerously-skip-permissions',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`  [ollama exit ${code}] ${stderr.slice(0, 200)}`);
        resolve('UNKNOWN');
        return;
      }
      resolve(stdout.trim());
    });

    proc.on('error', (err) => {
      console.error(`  [ollama error] ${err.message}`);
      resolve('UNKNOWN');
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// --- URL verification ---

async function verifyUrlAlive(url: string): Promise<boolean> {
  try {
    const response = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

// --- CSV logging ---

function logCorrection(
  sourceId: string,
  oldUrl: string,
  newUrl: string,
  status: 'recovered' | 'not_found' | 'error',
) {
  const date = new Date().toISOString().split('T')[0];
  const line = `${sourceId},${oldUrl},${newUrl},${status},${date}\n`;
  if (!existsSync(CORRECTIONS_CSV)) {
    writeFileSync(CORRECTIONS_CSV, 'source_id,old_url,new_url,status,date\n', 'utf8');
  }
  appendFileSync(CORRECTIONS_CSV, line, 'utf8');
}

// --- Queue writing ---

function writeToOutputQueue(sourceId: string, newUrl: string) {
  // Skip if already in output queue
  if (existsSync(OUTPUT_QUEUE)) {
    const existing = readFileSync(OUTPUT_QUEUE, 'utf8');
    const alreadyQueued = existing.split('\n')
      .filter(l => l.trim())
      .some(l => {
        try { return JSON.parse(l).sourceId === sourceId; } catch { return false; }
      });
    if (alreadyQueued) {
      log(`  ⚠️  ${sourceId} finns redan i output-kön, skippar`);
      return;
    }
  }

  const entry = JSON.stringify({
    sourceId,
    url: newUrl,
    queueName: 'postB-preC',
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 0,
    queueReason: 'scb-404-recovery',
  }) + '\n';
  appendFileSync(OUTPUT_QUEUE, entry, 'utf8');
}

// --- Remove from input queues ---

function removeFromInputQueues(sourceId: string) {
  for (const [, queuePath] of Object.entries(IN_QUEUES)) {
    if (!existsSync(queuePath)) continue;
    const content = readFileSync(queuePath, 'utf8');
    const lines = content.split('\n').filter(l => {
      if (!l.trim()) return false;
      try { return JSON.parse(l).sourceId !== sourceId; } catch { return true; }
    });
    writeFileSync(queuePath, lines.join('\n') + '\n', 'utf8');
  }
}

// --- Per-source recovery ---

interface RecoveryResult {
  sourceId: string;
  oldUrl: string;
  suggestedUrl: string;
  alive: boolean;
  status: 'recovered' | 'not_found' | 'error';
  error?: string;
}

async function recoverSource(
  sourceId: string,
  dryRun: boolean,
): Promise<RecoveryResult> {
  const source = getSource(sourceId);
  if (!source) {
    return {
      sourceId,
      oldUrl: 'unknown',
      suggestedUrl: 'UNKNOWN',
      alive: false,
      status: 'error',
      error: 'Source not found in registry',
    };
  }

  const oldUrl = source.url;
  const domain = new URL(oldUrl).hostname;

  log(`🔎 ${sourceId} (${domain})...`);

  const suggested = await askMiniMax(domain, oldUrl);
  log(`  → "${suggested}"`);

  if (suggested === 'UNKNOWN' || !suggested.startsWith('http')) {
    log('  ❌ NOT FOUND');
    logCorrection(sourceId, oldUrl, 'UNKNOWN', 'not_found');
    return { sourceId, oldUrl, suggestedUrl: suggested, alive: false, status: 'not_found' };
  }

  const alive = await verifyUrlAlive(suggested);

  if (alive) {
    log('  ✅ ALIVE');
    logCorrection(sourceId, oldUrl, suggested, 'recovered');
    if (!dryRun) {
      updateSourceUrl(sourceId, suggested);
      writeToOutputQueue(sourceId, suggested);
      removeFromInputQueues(sourceId);
    }
    return { sourceId, oldUrl, suggestedUrl: suggested, alive: true, status: 'recovered' };
  } else {
    log('  ❌ DEAD');
    logCorrection(sourceId, oldUrl, suggested, 'not_found');
    return { sourceId, oldUrl, suggestedUrl: suggested, alive: false, status: 'not_found' };
  }
}

// --- Main ---

interface QueueEntry {
  sourceId: string;
  queueName: string;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage:');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/tools/scB-404-recovery.ts');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/tools/scB-404-recovery.ts <sourceId>');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/tools/scB-404-recovery.ts --dry-run');
    return;
  }

  const dryRun = args.includes('--dry-run');
  const singleId = args.find((a) => !a.startsWith('--'));

  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(RUN_LOG, '', 'utf8'); // init per-run log file

  if (singleId) {
    const result = await recoverSource(singleId, dryRun);
    console.log('\nResult:', result);
    return;
  }

  // Batch mode
  const entries: QueueEntry[] = [];
  for (const [, queuePath] of Object.entries(IN_QUEUES)) {
    if (existsSync(queuePath)) {
      const content = readFileSync(queuePath, 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as QueueEntry);
        } catch {
          // skip malformed
        }
      }
    }
  }

  if (entries.length === 0) {
    console.log('Inga sources i serverdown/404-köerna att återställa.');
    return;
  }

  log(`scB-404-recovery: ${entries.length} sources (dry-run: ${dryRun})`);

  const results: RecoveryResult[] = [];

  for (let i = 0; i < entries.length; i++) {
    log(`[${i + 1}/${entries.length}]`);
    results.push(await recoverSource(entries[i].sourceId, dryRun));
    if (i < entries.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const recovered = results.filter((r) => r.status === 'recovered').length;
  const notFound = results.filter((r) => r.status === 'not_found').length;
  const errors = results.filter((r) => r.status === 'error').length;

  log('');
  log('═══════════════════════════════════════════════════════════════');
  log('RECOVERY SUMMARY');
  log('═══════════════════════════════════════════════════════════════');
  log(`  ✅ Recovered: ${recovered}`);
  log(`  ❌ Not found: ${notFound}`);
  log(`  ⚠️  Errors:    ${errors}`);
  log(`  📝 Total:     ${results.length}`);
  if (!dryRun) {
    log(`  Output queue: ${OUTPUT_QUEUE}`);
  } else {
    log('[DRY RUN — no files written]');
  }
  log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
