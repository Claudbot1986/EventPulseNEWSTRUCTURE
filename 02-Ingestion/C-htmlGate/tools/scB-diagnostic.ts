/**
 * scB-diagnostic.ts — ScrapingBee failure diagnostic tool
 *
 * För varje source URL, testa:
 *   1. Direct HTTP — är servern alive överhuvudtaget?
 *   2. ScB utan JS-render — returnerar servern statiskt content?
 *   3. ScB med JS-render — kräver sidan JavaScript?
 *   4. ScB + premium proxy — identifierar origin blocker?
 *   5. Headers-analys — Cloudflare, security headers, etc.
 *
 * Usage:
 *   npx tsx 02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts <sourceId>
 *   npx tsx 02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts <sourceId> --verbose
 *   npx tsx 02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts <sourceId> --save-html
 */

import axios from 'axios';
import { getSource } from '../../tools/sourceRegistry';
import { detectJsRender } from './scrapingBeeDeep';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;
const SCRAPINGBEE_BASE = 'https://app.scrapingbee.com/api/v1/';

const RUNTIME_DIR = path.resolve(__dirname, '../../../runtime');
const LOGS_DIR = path.resolve(RUNTIME_DIR, 'logs');
const RUN_LOG = path.resolve(LOGS_DIR, `scB-diagnostic-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const MAN_FILE = path.resolve(RUNTIME_DIR, 'postTestC-manual-review.jsonl');
const OUT_QUEUES = {
  serverdown: path.resolve(RUNTIME_DIR, 'postTestC-serverdown.jsonl'),
  '404': path.resolve(RUNTIME_DIR, 'postTestC-404.jsonl'),
  error500: path.resolve(RUNTIME_DIR, 'postTestC-error500.jsonl'),
  timeout: path.resolve(RUNTIME_DIR, 'postTestC-timeout.jsonl'),
  blocked: path.resolve(RUNTIME_DIR, 'postTestC-blocked.jsonl'),
};

const DIAGNOSTIC_DIR = path.resolve(__dirname, '../../../runtime/logs/scB-diagnostics');

// --- Log helper — terminal + per-run file ---

function log(...args: unknown[]) {
  const ts = new Date().toISOString();
  const msg = args.map(a => String(a)).join(' ');
  const line = `${ts}  ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + '\n', 'utf8');
}

interface DiagnosticResult {
  sourceId: string;
  url: string;
  tests: {
    directHttp: TestResult;
    scbNoJs: TestResult;
    scbWithJs: TestResult;
    scbPremiumProxy: TestResult;
    headers: HeadersResult;
  };
  hypothesis: Hypothesis;
  recommendation: Recommendation;
}

interface TestResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  responseTime?: number;
  htmlLength?: number;
  jsRenderMarkers?: boolean;
}

interface HeadersResult {
  server?: string;
  cfRay?: string;
  cloudflare: boolean;
  securityHeaders: Record<string, string>;
}

type Hypothesis =
  | 'server_down_or_unreachable'
  | 'origin_blocks_scb_ip'
  | 'requires_js_to_serve_content'
  | 'rate_limited'
  | 'cloudflare_or_similar_cdn'
  | 'timeout_slow_server'
  | 'url_not_found'
  | 'unknown_500_error';

type Recommendation =
  | 'use_d_mode_js_rendering'
  | 'source_adapter_required'
  | 'remove_from_registry_wrong_url'
  | 'manual_review_required'
  | 'retry_later_rate_limit';

async function fetchDirect(url: string): Promise<{ html?: string; statusCode?: number; error?: string; responseTime?: number; headers?: Record<string, string> }> {
  const start = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (s) => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'sv,en;q=0.9',
      }
    });
    return {
      html: response.data as string,
      statusCode: response.status,
      responseTime: Date.now() - start,
      headers: Object.fromEntries(
        Object.entries(response.headers)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [k, String(v)])
      ),
    };
  } catch (err: any) {
    return { error: err.message, responseTime: Date.now() - start };
  }
}

async function fetchWithScB(url: string, opts: {
  renderJs?: boolean;
  premium?: boolean;
  timeoutMs?: number;
}): Promise<{ html?: string; statusCode?: number; error?: string; responseTime?: number; credits?: number }> {
  if (!SCRAPINGBEE_API_KEY) {
    return { error: 'SCRAPINGBEE_API_KEY not set' };
  }

  const start = Date.now();
  const timeout = opts.timeoutMs ?? 15000;
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_API_KEY,
    url,
    render_js: opts.renderJs ? 'true' : 'false',
    country_code: 'se',
    block_resources: 'false',
  });

  if (opts.premium) {
    params.set('premium_proxy', 'true');
  }

  try {
    const response = await axios.get(SCRAPINGBEE_BASE, { params, timeout });
    return {
      html: response.data as string,
      statusCode: 200,
      responseTime: Date.now() - start,
      credits: opts.renderJs ? 5 : 2,
    };
  } catch (err: any) {
    const status = err.response?.status;
    const msg = status ? `HTTP ${status}` : err.message;
    return { error: msg, statusCode: status, responseTime: Date.now() - start };
  }
}

function analyzeHeaders(headers: Record<string, string> | undefined): HeadersResult {
  if (!headers) return { cloudflare: false, securityHeaders: {} };

  const knownSecurity = [
    'server', 'date', 'content-type', 'cf-ray', 'cf-cache-status',
    'x-served-by', 'x-cache', 'set-cookie', 'www-authenticate',
    'x-frame-options', 'x-xss-protection', 'content-security-policy',
    'strict-transport-security',
  ];

  const securityHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (knownSecurity.includes(k.toLowerCase()) || k.toLowerCase().startsWith('cf-')) {
      securityHeaders[k] = v;
    }
  }

  return {
    server: headers['server'],
    cfRay: headers['cf-ray'],
    cloudflare: !!(headers['cf-ray'] || headers['cf-cache-status']),
    securityHeaders,
  };
}

function determineHypothesis(tests: DiagnosticResult['tests']): Hypothesis {
  const { directHttp, scbNoJs, scbWithJs, headers } = tests;

  if (directHttp.error || (directHttp.statusCode && directHttp.statusCode >= 500)) {
    return 'server_down_or_unreachable';
  }

  // Server responds to browser but ScB gets 0 bytes → anti-bot blocking ScB specifically
  if (directHttp.html && directHttp.html.length > 100 && !scbNoJs.html && !scbWithJs.html) {
    if (headers.cloudflare) return 'cloudflare_or_similar_cdn';
    return 'origin_blocks_scb_ip';
  }

  if (directHttp.statusCode === 404) {
    // Server returned a 404 page to browser but ScB got nothing → blocking ScB
    if (!scbNoJs.html && !scbWithJs.html) {
      return 'origin_blocks_scb_ip';
    }
    return 'url_not_found';
  }

  if (scbNoJs.error?.includes('500') || scbWithJs.error?.includes('500')) {
    if (headers.cloudflare) return 'cloudflare_or_similar_cdn';
    return 'origin_blocks_scb_ip';
  }

  if (scbNoJs.error?.includes('timeout') || scbWithJs.error?.includes('timeout')) {
    return 'timeout_slow_server';
  }

  if (scbNoJs.error?.includes('429') || scbWithJs.error?.includes('429')) {
    return 'rate_limited';
  }

  if (!scbNoJs.html && scbWithJs.html && scbWithJs.html.length > 1000) {
    return 'requires_js_to_serve_content';
  }

  return 'unknown_500_error';
}

function getRecommendation(hypothesis: Hypothesis): Recommendation {
  switch (hypothesis) {
    case 'server_down_or_unreachable':
    case 'url_not_found':
      return 'remove_from_registry_wrong_url';
    case 'requires_js_to_serve_content':
      return 'use_d_mode_js_rendering';
    case 'rate_limited':
      return 'retry_later_rate_limit';
    case 'cloudflare_or_similar_cdn':
    case 'origin_blocks_scb_ip':
      return 'source_adapter_required';
    case 'timeout_slow_server':
    default:
      return 'manual_review_required';
  }
}

async function runDiagnostic(sourceId: string, verbose: boolean, saveHtml: boolean): Promise<DiagnosticResult> {
  const source = getSource(sourceId);
  if (!source) throw new Error(`Source "${sourceId}" not found in registry`);

  const url = source.url;
  console.log(`\n🔍 Diagnostising: ${sourceId}`);
  console.log(`   URL: ${url}\n`);

  if (verbose) process.stdout.write('  [1/4] Direct HTTP... ');
  const directResult = await fetchDirect(url);
  console.log(`${directResult.statusCode || 'ERROR'} | ${directResult.responseTime}ms | ${directResult.html?.length || 0} bytes`);

  if (verbose) process.stdout.write('  [2/4] ScB utan JS... ');
  const scbNoJsResult = await fetchWithScB(url, { renderJs: false });
  console.log(`${scbNoJsResult.statusCode || 'ERROR'} | ${scbNoJsResult.responseTime}ms | ${scbNoJsResult.html?.length || 0} bytes`);

  if (verbose) process.stdout.write('  [3/4] ScB med JS... ');
  const scbJsResult = await fetchWithScB(url, { renderJs: true });
  console.log(`${scbJsResult.statusCode || 'ERROR'} | ${scbJsResult.responseTime}ms | ${scbJsResult.html?.length || 0} bytes`);

  if (verbose) process.stdout.write('  [4/4] ScB premium proxy... ');
  const scbPremiumResult = await fetchWithScB(url, { renderJs: true, premium: true });
  console.log(`${scbPremiumResult.statusCode || 'ERROR'} | ${scbPremiumResult.responseTime}ms | ${scbPremiumResult.html?.length || 0} bytes`);

  const headersResult = analyzeHeaders(directResult.headers);

  const tests = {
    directHttp: {
      success: !directResult.error && !!directResult.html,
      statusCode: directResult.statusCode,
      error: directResult.error,
      responseTime: directResult.responseTime,
      htmlLength: directResult.html?.length,
      jsRenderMarkers: directResult.html ? detectJsRender(directResult.html) : undefined,
    },
    scbNoJs: {
      success: !scbNoJsResult.error && !!scbNoJsResult.html,
      statusCode: scbNoJsResult.statusCode,
      error: scbNoJsResult.error,
      responseTime: scbNoJsResult.responseTime,
      htmlLength: scbNoJsResult.html?.length,
    },
    scbWithJs: {
      success: !scbJsResult.error && !!scbJsResult.html,
      statusCode: scbJsResult.statusCode,
      error: scbJsResult.error,
      responseTime: scbJsResult.responseTime,
      htmlLength: scbJsResult.html?.length,
      jsRenderMarkers: scbJsResult.html ? detectJsRender(scbJsResult.html) : undefined,
    },
    scbPremiumProxy: {
      success: !scbPremiumResult.error && !!scbPremiumResult.html,
      statusCode: scbPremiumResult.statusCode,
      error: scbPremiumResult.error,
      responseTime: scbPremiumResult.responseTime,
      htmlLength: scbPremiumResult.html?.length,
    },
    headers: headersResult,
  };

  const hypothesis = determineHypothesis(tests);
  const recommendation = getRecommendation(hypothesis);

  if (saveHtml) {
    mkdirSync(DIAGNOSTIC_DIR, { recursive: true });
    const safeId = sourceId.replace(/[^a-z0-9]/gi, '_');
    const ts = Date.now();
    if (directResult.html) writeFileSync(`${DIAGNOSTIC_DIR}/${safeId}_direct_${ts}.html`, directResult.html);
    if (scbNoJsResult.html) writeFileSync(`${DIAGNOSTIC_DIR}/${safeId}_scbNoJs_${ts}.html`, scbNoJsResult.html);
    if (scbJsResult.html) writeFileSync(`${DIAGNOSTIC_DIR}/${safeId}_scbJs_${ts}.html`, scbJsResult.html);
    if (scbPremiumResult.html) writeFileSync(`${DIAGNOSTIC_DIR}/${safeId}_scbPremium_${ts}.html`, scbPremiumResult.html);
    console.log(`\n  💾 HTML sparade: ${DIAGNOSTIC_DIR}/${safeId}_*`);
  }

  return { sourceId, url, tests, hypothesis, recommendation };
}

function printResult(result: DiagnosticResult) {
  const emoji: Record<Hypothesis, string> = {
    server_down_or_unreachable: '🔴',
    origin_blocks_scb_ip: '🔴',
    requires_js_to_serve_content: '🟡',
    rate_limited: '🟠',
    cloudflare_or_similar_cdn: '🟠',
    timeout_slow_server: '🟡',
    url_not_found: '🔴',
    unknown_500_error: '⚪',
  };

  const recEmoji: Record<Recommendation, string> = {
    use_d_mode_js_rendering: '🔧',
    source_adapter_required: '🔧',
    remove_from_registry_wrong_url: '🗑️',
    manual_review_required: '👀',
    retry_later_rate_limit: '⏳',
  };

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ${emoji[result.hypothesis]} ${result.hypothesis.replace(/_/g, ' ')}`);
  console.log(`  ${recEmoji[result.recommendation]} ${result.recommendation.replace(/_/g, ' ')}`);
  console.log('═══════════════════════════════════════════════════════════════');

  console.log('\n  Testöversikt:');
  console.log(`    Direct HTTP:  ${result.tests.directHttp.success ? '✅' : '❌'} ${result.tests.directHttp.statusCode || result.tests.directHttp.error} (${result.tests.directHttp.responseTime}ms)`);
  console.log(`    ScB utan JS:  ${result.tests.scbNoJs.success ? '✅' : '❌'} ${result.tests.scbNoJs.statusCode || result.tests.scbNoJs.error} (${result.tests.scbNoJs.responseTime}ms)`);
  console.log(`    ScB med JS:   ${result.tests.scbWithJs.success ? '✅' : '❌'} ${result.tests.scbWithJs.statusCode || result.tests.scbWithJs.error} (${result.tests.scbWithJs.responseTime}ms)`);
  console.log(`    ScB premium:  ${result.tests.scbPremiumProxy.success ? '✅' : '❌'} ${result.tests.scbPremiumProxy.statusCode || result.tests.scbPremiumProxy.error} (${result.tests.scbPremiumProxy.responseTime}ms)`);

  if (result.tests.headers.cloudflare) {
    console.log(`    Cloudflare:   ☁️  JA (cf-ray: ${result.tests.headers.cfRay})`);
  }
  if (result.tests.directHttp.jsRenderMarkers) {
    console.log(`    JS-markers:   ⚠️ Finns i direct HTTP HTML`);
  }
  if (result.tests.scbWithJs.jsRenderMarkers) {
    console.log(`    JS-markers:   ⚠️ Finns i ScB JS-rendered HTML`);
  }

  console.log('\n  HTML-storlekar:');
  console.log(`    Direct:    ${result.tests.directHttp.htmlLength || 0} bytes`);
  console.log(`    ScB noJS:  ${result.tests.scbNoJs.htmlLength || 0} bytes`);
  console.log(`    ScB JS:    ${result.tests.scbWithJs.htmlLength || 0} bytes`);
  console.log(`    ScB Prem:  ${result.tests.scbPremiumProxy.htmlLength || 0} bytes`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log('Usage:');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts <sourceId>');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts <sourceId> --verbose');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts <sourceId> --verbose --save-html');
    console.log('  npx tsx 02-Ingestion/C-htmlGate/tools/scB-diagnostic.ts --batch');
    return;
  }

  const batch = args.includes('--batch');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const saveHtml = args.includes('--save-html') || args.includes('-s');

  if (!SCRAPINGBEE_API_KEY) {
    console.error('SCRAPINGBEE_API_KEY saknas i .env!');
    process.exit(1);
  }

  if (batch) {
    mkdirSync(LOGS_DIR, { recursive: true });
    writeFileSync(RUN_LOG, '', 'utf8');
    await runBatchDiagnostic(args);
    return;
  }

  const sourceId = args[0];
  const result = await runDiagnostic(sourceId, verbose, saveHtml);
  printResult(result);
}

// Map hypothesis → queue file key
function hypothesisToQueueKey(h: string): string {
  switch (h) {
    case 'server_down_or_unreachable': return 'serverdown';
    case 'url_not_found': return '404';
    case 'unknown_500_error': return 'error500';
    case 'timeout_slow_server': return 'timeout';
    case 'origin_blocks_scb_ip':
    case 'cloudflare_or_similar_cdn':
    case 'rate_limited':
    case 'requires_js_to_serve_content': return 'blocked';
    default: return 'blocked';
  }
}

function appendToQueue(queuePath: string, entry: QueueEntry) {
  mkdirSync(path.dirname(queuePath), { recursive: true });

  // Skip if already in queue
  if (existsSync(queuePath)) {
    const existing = readFileSync(queuePath, 'utf8');
    const alreadyQueued = existing.split('\n')
      .filter(l => l.trim())
      .some(l => {
        try { return JSON.parse(l).sourceId === entry.sourceId; } catch { return false; }
      });
    if (alreadyQueued) return;
  }

  const line = JSON.stringify({
    sourceId: entry.sourceId,
    queueName: path.basename(queuePath, '.jsonl'),
    queuedAt: new Date().toISOString(),
    priority: 1,
    attempt: 0,
    queueReason: 'scb-diagnostic',
  }) + '\n';
  if (existsSync(queuePath)) {
    const existing = readFileSync(queuePath, 'utf8');
    writeFileSync(queuePath, existing + line, 'utf8');
  } else {
    writeFileSync(queuePath, line, 'utf8');
  }
}

async function runBatchDiagnostic(args: string[]) {
  interface QueueEntry { sourceId: string; queueName: string; }
  let entries: QueueEntry[] = [];

  if (existsSync(MAN_FILE)) {
    const content = readFileSync(MAN_FILE, 'utf8');
    entries = content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as QueueEntry);
  }

  if (entries.length === 0) {
    log('Inga entries i postTestC-manual-review.jsonl att diagnostisera.');
    return;
  }

  log(`Batch diagnostic: ${entries.length} sources (2-tester, 10s timeout)`);

  const counts: Record<string, { total: number; examples: string[] }> = {};
  const HYPOTHESIS_LABELS: Record<string, string> = {
    server_down_or_unreachable: 'Server nere/ouppnåelig',
    origin_blocks_scb_ip: 'Server blockerar ScB IP',
    requires_js_to_serve_content: 'Kräver JS för att leverera content',
    rate_limited: 'Rate limited',
    cloudflare_or_similar_cdn: 'Cloudflare/CDN blockerar',
    timeout_slow_server: 'Timeout - långsam server',
    url_not_found: 'URL finns inte (404)',
    unknown_500_error: 'Okänt 500-fel',
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    log(`[${i + 1}/${entries.length}] ${entry.sourceId}...`);

    const source = getSource(entry.sourceId);
    if (!source) {
      log('  NOT IN REGISTRY');
      continue;
    }

    const url = source.url;
    const directResult = await fetchDirect(url);

    // Skip ScB if direct HTTP already failed — no point wasting credits
    if (directResult.error || (directResult.statusCode && directResult.statusCode >= 400)) {
      const hypothesis = directResult.statusCode === 404
        ? 'url_not_found'
        : 'server_down_or_unreachable';

      const queueKey = hypothesisToQueueKey(hypothesis);
      appendToQueue(OUT_QUEUES[queueKey as keyof typeof OUT_QUEUES], entry);

      // Remove from MAN_FILE after successful routing
      if (existsSync(MAN_FILE)) {
        const manContent = readFileSync(MAN_FILE, 'utf8');
        const manLines = manContent.split('\n').filter(l => {
          if (!l.trim()) return false;
          try { return JSON.parse(l).sourceId !== entry.sourceId; } catch { return true; }
        });
        writeFileSync(MAN_FILE, manLines.join('\n') + '\n', 'utf8');
      }

      if (!counts[hypothesis]) counts[hypothesis] = { total: 0, examples: [] };
      counts[hypothesis].total++;
      if (counts[hypothesis].examples.length < 3) counts[hypothesis].examples.push(entry.sourceId);
      log(`${hypothesis.replace(/_/g, ' ')} → ${queueKey}`);
      continue;
    }

    const scbJsResult = await fetchWithScB(url, { renderJs: true, timeoutMs: 10000 });

    const tests: DiagnosticResult['tests'] = {
      directHttp: {
        success: !directResult.error && !!directResult.html,
        statusCode: directResult.statusCode,
        error: directResult.error,
        responseTime: directResult.responseTime,
        htmlLength: directResult.html?.length,
        jsRenderMarkers: directResult.html ? detectJsRender(directResult.html) : undefined,
      },
      scbNoJs: { success: false, htmlLength: 0 },
      scbWithJs: {
        success: !scbJsResult.error && !!scbJsResult.html,
        statusCode: scbJsResult.statusCode,
        error: scbJsResult.error,
        responseTime: scbJsResult.responseTime,
        htmlLength: scbJsResult.html?.length,
        jsRenderMarkers: scbJsResult.html ? detectJsRender(scbJsResult.html) : undefined,
      },
      scbPremiumProxy: { success: false, htmlLength: 0 },
      headers: analyzeHeaders(directResult.headers),
    };

    const hypothesis = determineHypothesis(tests);
    const queueKey = hypothesisToQueueKey(hypothesis);
    appendToQueue(OUT_QUEUES[queueKey as keyof typeof OUT_QUEUES], entry);

    // Remove from MAN_FILE after successful routing
    if (existsSync(MAN_FILE)) {
      const manContent = readFileSync(MAN_FILE, 'utf8');
      const manLines = manContent.split('\n').filter(l => {
        if (!l.trim()) return false;
        try { return JSON.parse(l).sourceId !== entry.sourceId; } catch { return true; }
      });
      writeFileSync(MAN_FILE, manLines.join('\n') + '\n', 'utf8');
    }

    if (!counts[hypothesis]) counts[hypothesis] = { total: 0, examples: [] };
    counts[hypothesis].total++;
    if (counts[hypothesis].examples.length < 3) counts[hypothesis].examples.push(entry.sourceId);
    log(`${hypothesis.replace(/_/g, ' ')} → ${queueKey}`);

    await new Promise(r => setTimeout(r, 200));
  }

  log('');
  log('═══════════════════════════════════════════════════════════════════════');
  log('DIAGNOSTIC SUMMARY');
  log('═══════════════════════════════════════════════════════════════════════');
  log(`  ${'Hypotes'.padEnd(35)} | kö             | Antal | Exempel`);
  log(`  ${'─'.repeat(35)}─┼────────────────┼───────┼─────────────────────`);

  const sorted = Object.entries(counts).sort((a, b) => b[1].total - a[1].total);
  for (const [h, data] of sorted) {
    const label = HYPOTHESIS_LABELS[h] || h;
    const qk = hypothesisToQueueKey(h);
    log(`  ${label.padEnd(35)} | ${qk.padEnd(14)} | ${String(data.total).padStart(5)} | ${data.examples.join(', ')}`);
  }

  log(`  Totalt: ${entries.length} sources`);
  log('  Köer skrivna till runtime/:');
  for (const [qk, qf] of Object.entries(OUT_QUEUES)) {
    const count = existsSync(qf) ? (readFileSync(qf, 'utf8').split('\n').filter(l => l.trim()).length) : 0;
    log(`    ${qk}: ${count} sources`);
  }
  log('═══════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
