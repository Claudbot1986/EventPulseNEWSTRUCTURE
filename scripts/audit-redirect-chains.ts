/**
 * Step 3 — audit-redirect-chains.ts
 *
 * Read-only diagnostic. För varje Bucket B-källa (redirect-loop-killed)
 * vandrar vi de första MAX_REDIRECTS_AUDIT (5) hoppen med axios och
 * rapporterar slutlig status-kod + kedja. Avgör om höjning av
 * MAX_REDIRECTS (3 → 6) är befogad.
 *
 * Syfte: Identifiera legitima 4–6-hoppade 301/302-kedjor som idag
 * dör på MAX_REDIRECTS=3-buggen, utan att röra runA.ts eller
 * cycle-detektorn.
 *
 * Output: runtime/redirect-chain-audit.csv med kolumner:
 *   sourceId, name, originalUrl, finalStatus, hops, chain, recommendation
 *
 * Användning:
 *   npx tsx scripts/audit-redirect-chains.ts [--cap 5] [--limit 20]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../');
const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : PROJECT_ROOT;
const RUNTIME_DIR = path.resolve(DATA_ROOT, 'runtime');

const CLASSIFICATION_FILE = path.resolve(RUNTIME_DIR, 'source-discovery-classification.csv');
const OUTPUT_FILE = path.resolve(RUNTIME_DIR, 'redirect-chain-audit.csv');

// CLI args
const args = process.argv.slice(2);
const capArg = args.indexOf('--cap');
const AUDIT_CAP = capArg !== -1 ? parseInt(args[capArg + 1], 10) : 5;
const limitArg = args.indexOf('--limit');
const AUDIT_LIMIT = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : 20;

interface BucketBRow {
  sourceId: string;
  name: string;
  url: string;
}

interface AuditRow {
  sourceId: string;
  name: string;
  originalUrl: string;
  finalStatus: string;
  hops: number;
  chain: string;
  recommendation: string;
}

function parseBucketB(): BucketBRow[] {
  if (!existsSync(CLASSIFICATION_FILE)) {
    console.error(`error: ${CLASSIFICATION_FILE} not found — kör Step 1 först`);
    process.exit(1);
  }
  const content = readFileSync(CLASSIFICATION_FILE, 'utf8');
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');
  const idIdx = header.indexOf('sourceId');
  const nameIdx = header.indexOf('name');
  const bucketIdx = header.indexOf('bucket');
  const urlIdx = header.indexOf('url');

  const rows: BucketBRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // CSV kan innehålla citationstecken — vi splittar bara enkelt
    const parts = lines[i].split(',');
    if (parts[bucketIdx] === 'B_redirect-loop-killed') {
      rows.push({
        sourceId: parts[idIdx],
        name: parts[nameIdx],
        url: parts[urlIdx],
      });
    }
  }
  return rows;
}

/**
 * Normalisera URL: vissa rader saknar protokoll. Lägg till https:// om så.
 */
function normalizeUrl(u: string): string {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

/**
 * Följ redirects manuellt (som fetchTools.ts men med egen cap för audit).
 * Returnerar { finalStatus, hops, chain, error }.
 */
async function traceRedirects(startUrl: string, cap: number): Promise<{
  finalStatus: string;
  hops: number;
  chain: string;
  error?: string;
}> {
  let currentUrl = startUrl;
  const chain: string[] = [];
  const seen = new Set<string>();
  const TIMEOUT = 10000;

  for (let i = 0; i <= cap; i++) {
    if (seen.has(currentUrl)) {
      return {
        finalStatus: 'loop',
        hops: chain.length,
        chain: chain.join(' → '),
        error: `loop at ${currentUrl}`,
      };
    }
    seen.add(currentUrl);

    try {
      const response = await axios.get(currentUrl, {
        headers: { 'User-Agent': 'EventPulse-redirect-audit/1.0' },
        timeout: TIMEOUT,
        validateStatus: (s) => s < 500,
        maxRedirects: 0,
      });

      if (response.status >= 300 && response.status < 400) {
        const loc = response.headers['location'];
        if (!loc) {
          return {
            finalStatus: `${response.status}:no-location`,
            hops: chain.length,
            chain: chain.join(' → '),
            error: 'redirect without Location',
          };
        }
        let next: string;
        try {
          next = new URL(loc, currentUrl).href;
        } catch {
          return {
            finalStatus: `${response.status}:invalid-location`,
            hops: chain.length,
            chain: chain.join(' → '),
            error: `invalid Location: ${loc}`,
          };
        }
        chain.push(`${response.status}:${next}`);
        currentUrl = next;
        continue;
      }

      if (response.status === 200) {
        chain.push(`200:${currentUrl}`);
        return {
          finalStatus: '200',
          hops: chain.length,
          chain: chain.join(' → '),
        };
      }

      return {
        finalStatus: `${response.status}`,
        hops: chain.length,
        chain: chain.join(' → '),
      };
    } catch (err: any) {
      return {
        finalStatus: err.code ?? 'error',
        hops: chain.length,
        chain: chain.join(' → '),
        error: err.message,
      };
    }
  }

  // Auditen cap:ade — spara kedjan så vi ser hur långt vi kom
  return {
    finalStatus: 'cap-exceeded',
    hops: chain.length,
    chain: chain.join(' → '),
  };
}

function csvEscape(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main(): Promise<void> {
  console.log(`Step 3: redirect-chain audit`);
  console.log(`  source: ${CLASSIFICATION_FILE}`);
  console.log(`  output: ${OUTPUT_FILE}`);
  console.log(`  audit cap: ${AUDIT_CAP} hops`);
  console.log(`  limit: ${AUDIT_LIMIT} sources`);

  const bucketB = parseBucketB();
  console.log(`  Bucket B sources found: ${bucketB.length}`);

  const toAudit = bucketB.slice(0, AUDIT_LIMIT);
  const rows: AuditRow[] = [];

  let wouldResolve200 = 0;
  let wouldResolve200WithMoreHops = 0;
  let alreadyOver3 = 0;

  for (const b of toAudit) {
    const url = normalizeUrl(b.url);
    process.stdout.write(`  [${b.sourceId}] ${url.slice(0, 60)}... `);
    const result = await traceRedirects(url, AUDIT_CAP);
    const rec =
      result.finalStatus === '200'
        ? 'reachable — höj MAX_REDIRECTS till 6'
        : result.finalStatus === 'cap-exceeded' && result.hops >= 3
          ? `cap-exceeded vid ${result.hops} hopp — höj MAX_REDIRECTS för att testa`
          : result.finalStatus === 'loop'
            ? 'riktig loop — höj INTE'
            : `${result.finalStatus} — ut-of-scope (höj inte)`;
    rows.push({
      sourceId: b.sourceId,
      name: b.name,
      originalUrl: url,
      finalStatus: result.finalStatus,
      hops: result.hops,
      chain: result.chain,
      recommendation: rec,
    });
    if (result.finalStatus === '200') wouldResolve200++;
    if (result.finalStatus === 'cap-exceeded' && result.hops >= 3) wouldResolve200WithMoreHops++;
    if (result.hops > 3) alreadyOver3++;
    console.log(`${result.finalStatus} (${result.hops} hops) — ${rec}`);
  }

  // Skriv CSV
  const header = ['sourceId', 'name', 'originalUrl', 'finalStatus', 'hops', 'chain', 'recommendation'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.sourceId),
      csvEscape(r.name),
      csvEscape(r.originalUrl),
      r.finalStatus,
      r.hops,
      csvEscape(r.chain),
      csvEscape(r.recommendation),
    ].join(','));
  }
  writeFileSync(OUTPUT_FILE, lines.join('\n') + '\n', 'utf8');

  console.log(`\n  summary:`);
  console.log(`    audited: ${toAudit.length}`);
  console.log(`    would resolve 200: ${wouldResolve200}`);
  console.log(`    cap-exceeded at ≥3 hops (potential raises): ${wouldResolve200WithMoreHops}`);
  console.log(`    already over 3 hops: ${alreadyOver3}`);

  if (wouldResolve200WithMoreHops >= 3) {
    console.log(`\n  Recommendation: HÖJ MAX_REDIRECTS från 3 till 6 (≥3 källor visar cap-exceeded vid ≥3 hopp).`);
  } else if (wouldResolve200 >= 3) {
    console.log(`\n  Recommendation: HÖJ MAX_REDIRECTS från 3 till 6 (≥3 källor resolverar 200 inom 5 hopp).`);
  } else {
    console.log(`\n  Recommendation: Behåll MAX_REDIRECTS=3 (≤2 källor visar 200 inom 5 hopp).`);
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
