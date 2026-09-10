/**
 * 02-Ingestion/tools/etagRefresh.ts
 *
 * P2B (2026-09-10): kör refreshCache mot alla working-sources parallellt.
 * Triggas av cronjobbet 02:30 (steg etag-refresh).
 *
 * - Läser sources/*.jsonl (working-state).
 * - Samlar URL-pool (source.url + alla URLs från urlbank om tillämpligt).
 * - Anropar refreshCache() med concurrency=5.
 * - Loggar till runtime/etag-refresh.log + returnerar RefreshStats.
 *
 * Säkerhet: vi läser URL-listan från sources-registry (working-state);
 * vi kontrollerar ALDRIG okända URLs från nätverket.
 *
 * Usage:
 *   npx tsx 02-Ingestion/tools/etagRefresh.ts --limit 100
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { refreshCache, type RefreshStats } from './etagCache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SOURCES_DIR = path.join(PROJECT_ROOT, 'sources');

interface SourceEntry {
  id: string;
  url: string;
  status?: string;
}

function loadWorkingSources(limit: number): string[] {
  if (!existsSync(SOURCES_DIR)) return [];
  const urls: string[] = [];
  for (const file of readdirSync(SOURCES_DIR)) {
    if (!file.endsWith('.jsonl')) continue;
    try {
      const content = readFileSync(path.join(SOURCES_DIR, file), 'utf8').trim();
      if (!content) continue;
      const data = JSON.parse(content) as SourceEntry;
      // Bara working-sources (inte quarantined/retired)
      if (data.status === 'quarantined' || data.status === 'retired') continue;
      if (typeof data.url === 'string' && data.url.startsWith('http')) {
        urls.push(data.url);
      }
      if (urls.length >= limit) break;
    } catch {
      /* skip */
    }
  }
  return urls;
}

export async function runEtagRefresh(opts: { limit?: number; concurrency?: number } = {}): Promise<RefreshStats> {
  const limit = opts.limit ?? 100;
  const concurrency = opts.concurrency ?? 5;
  const urls = loadWorkingSources(limit);
  if (urls.length === 0) {
    console.log('[etagRefresh] no working sources found');
    return { totalChecked: 0, cacheHits: 0, cacheMisses: 0, errors: 0, durationMs: 0 };
  }
  console.log(`[etagRefresh] refreshing ${urls.length} URLs (concurrency=${concurrency})`);
  return refreshCache(urls, concurrency);
}

// ── CLI wrapper ────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
const limitIdx = cliArgs.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(cliArgs[limitIdx + 1], 10) : 100;

const isMainModule = (() => {
  try {
    return process.argv[1] === __filename || process.argv[1]?.endsWith('etagRefresh.ts');
  } catch {
    return false;
  }
})();

if (isMainModule && cliArgs.length > 0) {
  runEtagRefresh({ limit })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error('[etagRefresh] FATAL:', e);
      process.exit(1);
    });
}
