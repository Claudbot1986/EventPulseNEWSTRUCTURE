/**
 * MONSTERKÖRNING — Batch 1-10 e2e test
 * Kör sources 1-10 från 100testcandidates.md genom hela pipelinen:
 * 01-Sources → 02-Ingestion (A-G) → 03-Queue → 04-Normalizer → 05-Supabase → 06-UI
 *
 * Körs från: NEWSTRUCTURE/08-testResults/
 * Verktyg:   NEWSTRUCTURE/01-Sources/diagnostics/, NEWSTRUCTURE/02-Ingestion/, NEWSTRUCTURE/03-Queue/
 * Branch: experimente2e
 * Datum: 2026-03-30
 *
 * Root: NEWSTRUCTURE är root för allt arbete, loggar och exekvering.
 */

// Inline dotenv — avoids npm dependency at runtime (sync, no import needed)
import { readFileSync, existsSync } from 'fs';
const envPath = '/Users/claudgashi/EventPulse-recovery/clawdbot2/project/00EVENTPULSEFINALDESTINATION/.env';
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}
// Validate env loaded
if (!process.env.SUPABASE_URL) throw new Error('.env not loaded — SUPABASE_URL missing');

import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import { fetchHtml as doFetchHtml, fetchJson as doFetchJson } from '../02-Ingestion/tools/fetchTools';
import { extractFromJsonLd } from '../02-Ingestion/F-eventExtraction/extractor';
import { rawEventsQueue } from '../03-Queue/queue';

// ─── Inline RawEventInput (samma som @eventpulse/shared) ─────────────────────
interface RawEventInput {
  source: string;
  source_id: string;
  title: string;
  description: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  venue_name: string;
  venue_city: string;
  venue_address: string;
  venue_lat: number | null;
  venue_lng: number | null;
  category: string;
  url: string;
  image_url: string | null;
  price_info: string | null;
  promoter: string | null;
  organizer: string | null;
  accessibility: string | null;
  age_restriction: string | null;
  tags: string[];
  raw_data: any;
}

// ─── Batch 1-10 URLs ──────────────────────────────────────────────────────────
const BATCH_URLS = [
  { id: 1,  name: 'Konserthuset Stockholm',    url: 'https://www.konserthuset.se',     prev: 'no-jsonld' },
  { id: 2,  name: 'Berwaldhallen',             url: 'https://www.berwaldhallen.se',   prev: 'no-jsonld' },
  { id: 3,  name: 'GSO',                       url: 'https://www.gso.se',              prev: 'no-jsonld' },
  { id: 4,  name: 'Malmö Live',                url: 'https://www.malmolive.se',        prev: 'no-jsonld' },
  { id: 5,  name: 'Fryshuset',                url: 'https://www.fryshuset.se',        prev: 'no-jsonld' },
  { id: 6,  name: 'Avicii Arena',             url: 'https://www.aviciiarena.se',     prev: 'wrong-type' },
  { id: 7,  name: 'Kulturhuset Stadsteatern', url: 'https://www.kulturhuset.se',     prev: 'wrong-type' },
  { id: 8,  name: 'Malmö Opera',              url: 'https://www.malmoopera.se',      prev: 'no-jsonld' },
  { id: 9,  name: 'GöteborgsOperan',         url: 'https://www.goteborgsoperan.se', prev: 'DNS' },
  { id: 10, name: 'Kungliga Operan',           url: 'https://www.operan.se',          prev: 'no-jsonld' },
];

// ─── Supabase admin client ───────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Types ──────────────────────────────────────────────────────────────────
interface StepResult {
  step: string;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  detail: string;
  events?: number;
  error?: string;
}

interface SourceE2EResult {
  id: number;
  name: string;
  url: string;
  prevStatus: string;
  steps: StepResult[];
  finalStatus: 'success' | 'partial' | 'fail';
  eventsQueued: number;
  eventsNormalized: number;
  errors: string[];
}

// ─── Run diagnoseUrl as subprocess ───────────────────────────────────────────
// Uses the LOCAL jsonLdDiagnostic in NEWSTRUCTURE/01-Sources/diagnostics/
const NEWSTRUCTURE_ROOT = '/Users/claudgashi/EventPulse-recovery/clawdbot2/project/00EVENTPULSEFINALDESTINATION/NEWSTRUCTURE';
const INGESTION_ROOT = '/Users/claudgashi/EventPulse-recovery/clawdbot2/project/00EVENTPULSEFINALDESTINATION/temp/services/ingestion';

async function diagnoseUrlSubprocess(url: string): Promise<{ diagnosis: string; reason: string; eventsExtracted: number; foundTypes: string[] }> {
  return new Promise((resolve) => {
    // Try NEWSTRUCTURE first, fall back to temp/ingestion if needed
    const diagnosticPath = `${NEWSTRUCTURE_ROOT}/01-Sources/diagnostics/jsonLdDiagnostic.ts`;
    const proc = spawn('npx', ['tsx', diagnosticPath, url], {
      cwd: INGESTION_ROOT,
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && stderr) {
        resolve({ diagnosis: 'fetch-failed', reason: stderr.substring(0, 200), eventsExtracted: 0, foundTypes: [] });
        return;
      }

      const diagMatch = stdout.match(/Diagnosis:\s*(\w+)/);
      const reasonMatch = stdout.match(/Reason:\s*(.+)/);
      const eventsMatch = stdout.match(/eventsExtracted:\s*(\d+)/);
      const typesMatch = stdout.match(/All @types Found:\s*\[([^\]]+)\]/);

      resolve({
        diagnosis: diagMatch?.[1] ?? 'unknown',
        reason: reasonMatch?.[1] ?? 'no output',
        eventsExtracted: parseInt(eventsMatch?.[1] ?? '0', 10),
        foundTypes: typesMatch?.[1]?.split(',').map((t: string) => t.trim()) ?? [],
      });
    });

    proc.on('error', (err) => {
      resolve({ diagnosis: 'fetch-failed', reason: err.message, eventsExtracted: 0, foundTypes: [] });
    });
  });
}

// ─── Inline fetch wrappers ───────────────────────────────────────────────────
async function fetchHtml(url: string, timeout = 20000) {
  return doFetchHtml(url, { timeout });
}

async function fetchJson(url: string, timeout = 5000) {
  return doFetchJson(url, { timeout });
}

// ─── Try Network Gate ────────────────────────────────────────────────────────
async function tryNetworkGate(url: string): Promise<{ found: boolean; detail: string }> {
  try {
    const result = await fetchJson(`${url}/api/events`, timeout);
    if (result.success) return { found: true, detail: 'Found /api/events endpoint' };
  } catch {}
  try {
    const result = await fetchJson(`${url}/api/v1/events`, timeout);
    if (result.success) return { found: true, detail: 'Found /api/v1/events endpoint' };
  } catch {}
  return { found: false, detail: 'No open API found' };
}

// ─── Map to RawEventInput ───────────────────────────────────────────────────
function toRawEventInput(event: any, source: string): RawEventInput {
  return {
    source,
    source_id: event.id || event['@id'] || String(Math.random()),
    title: event.name || event.headline || 'Unknown',
    description: event.description || '',
    start_date: event.startDate ? event.startDate.split('T')[0] : '',
    start_time: event.startDate || '',
    end_date: event.endDate ? event.endDate.split('T')[0] : '',
    end_time: event.endDate || '',
    venue_name: event.location?.name || event.venue?.name || '',
    venue_city: event.location?.address?.addressLocality || '',
    venue_address: event.location?.address?.streetAddress || '',
    venue_lat: event.location?.geo?.latitude || null,
    venue_lng: event.location?.geo?.longitude || null,
    category: 'culture',
    url: event.url || event.sameAs || '',
    image_url: event.image || null,
    price_info: null,
    promoter: null,
    organizer: null,
    accessibility: null,
    age_restriction: null,
    tags: [],
    raw_data: event,
  };
}

// ─── MAIN: Test single source ───────────────────────────────────────────────
async function testSource(entry: typeof BATCH_URLS[0]): Promise<SourceE2EResult> {
  const result: SourceE2EResult = {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    prevStatus: entry.prev,
    steps: [],
    finalStatus: 'fail',
    eventsQueued: 0,
    eventsNormalized: 0,
    errors: [],
  };

  const log = (step: string, status: StepResult['status'], detail: string, extra?: Partial<StepResult>) => {
    result.steps.push({ step, status, detail, ...extra });
    const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : status === 'warn' ? '⚠️' : '⏭️';
    console.log(`  ${icon} [${step}] ${detail}`);
  };

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`#${entry.id} ${entry.name} (${entry.url})`);
  console.log(`Prev diagnosis: ${entry.prev}`);

  // Step 1: Diagnostik via subprocess (01-Sources) — uses LOCAL jsonLdDiagnostic
  try {
    const diag = await diagnoseUrlSubprocess(entry.url);
    const diagOk = diag.diagnosis === 'success';
    log('01-Sources/Diagnosis', diagOk ? 'pass' : 'warn',
      `Diagnosis: ${diag.diagnosis} — ${diag.reason.substring(0, 80)}`);
    log('01-Sources/Diagnosis', diag.diagnosis === 'success' ? 'pass' : 'warn',
      `Events extracted: ${diag.eventsExtracted}`, { events: diag.eventsExtracted });
  } catch (err: any) {
    log('01-Sources/Diagnosis', 'fail', `Error: ${err.message}`);
    result.errors.push(`Diagnosis error: ${err.message}`);
  }

  // Step 2: Fetch HTML (02-Ingestion) — uses LOCAL fetchTools
  let html: string | null = null;
  try {
    const fetchResult = await fetchHtml(entry.url, 20000);
    if (fetchResult.success && fetchResult.html) {
      html = fetchResult.html;
      log('02-Ingestion/Fetch', 'pass', `Fetched ${html.length} bytes`);
    } else {
      log('02-Ingestion/Fetch', 'fail', `HTTP ${fetchResult.statusCode}: ${fetchResult.error}`);
      result.errors.push(`Fetch failed: ${fetchResult.error}`);
    }
  } catch (err: any) {
    log('02-Ingestion/Fetch', 'fail', `Error: ${err.message}`);
    result.errors.push(`Fetch error: ${err.message}`);
  }

  // Step 3: Network Gate (B) — only if no-jsonld or wrong-type
  let networkFound = false;
  if (html && (entry.prev === 'no-jsonld' || entry.prev === 'wrong-type')) {
    try {
      const ng = await tryNetworkGate(entry.url);
      networkFound = ng.found;
      log('02-Ingestion/NetworkGate', ng.found ? 'warn' : 'skip', ng.detail);
    } catch (err: any) {
      log('02-Ingestion/NetworkGate', 'skip', `Skipped: ${err.message}`);
    }
  } else {
    log('02-Ingestion/NetworkGate', 'skip', 'Skipped — not no-jsonld/wrong-type');
  }

  // Step 4: JSON-LD Extraction (F-eventExtraction) — uses LOCAL extractor
  let extractedEvents: any[] = [];
  if (html) {
    try {
      const extractResult = extractFromJsonLd(html, entry.name, entry.url);
      extractedEvents = extractResult.events || [];
      if (extractedEvents.length > 0) {
        log('02-Ingestion/Extract', 'pass',
          `Extracted ${extractedEvents.length} events via JSON-LD`,
          { events: extractedEvents.length });
      } else {
        log('02-Ingestion/Extract', 'warn',
          `No events extracted (${extractResult.parseErrors.length} parse errors)`,
          { events: 0 });
      }
    } catch (err: any) {
      log('02-Ingestion/Extract', 'fail', `Error: ${err.message}`);
      result.errors.push(`Extract error: ${err.message}`);
    }
  }

  // Step 5: Queue (03-Queue) — uses LOCAL queue
  let queuedCount = 0;
  if (extractedEvents.length > 0) {
    try {
      const rawEvents: RawEventInput[] = extractedEvents.map(e => toRawEventInput(e, entry.name));
      for (const raw of rawEvents) {
        const jobId = `${entry.name}-${raw.source_id}`.replace(/[^a-zA-Z0-9-]/g, '-');
        await rawEventsQueue.add('process-raw-event', raw, { jobId });
        queuedCount++;
      }
      result.eventsQueued = queuedCount;
      log('03-Queue', queuedCount > 0 ? 'pass' : 'fail',
        `Queued ${queuedCount} events to rawEventsQueue`);
    } catch (err: any) {
      log('03-Queue', 'fail', `Queue error: ${err.message}`);
      result.errors.push(`Queue error: ${err.message}`);
    }
  } else {
    log('03-Queue', 'skip', 'No events to queue');
  }

  // Step 6: Supabase check (04-Normalizer → 05-Supabase)
  let normalizedCount = 0;
  if (queuedCount > 0) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const { count } = await supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('source', entry.name);
      normalizedCount = count || 0;
      log('05-Supabase', normalizedCount > 0 ? 'pass' : 'warn',
        `Found ${normalizedCount} events from ${entry.name} in database`);
    } catch (err: any) {
      log('05-Supabase', 'warn', `DB check skipped: ${err.message}`);
    }
    result.eventsNormalized = normalizedCount;
  } else {
    log('05-Supabase', 'skip', 'No events queued — skipped DB check');
  }

  // Step 7: UI readiness check (06-UI)
  if (result.eventsNormalized > 0) {
    log('06-UI', 'pass', `Events available for UI display (${result.eventsNormalized} events)`);
  } else {
    log('06-UI', 'skip', 'No events in DB — UI nothing to show');
  }

  // Final status
  if (result.eventsNormalized > 0) {
    result.finalStatus = 'success';
  } else if (result.eventsQueued > 0 || extractedEvents.length > 0) {
    result.finalStatus = 'partial';
  } else {
    result.finalStatus = 'fail';
  }

  return result;
}

// ─── Run batch ───────────────────────────────────────────────────────────────
async function runBatch() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  MONSTERKÖRNING — Batch 1-10 e2e test                    ║');
  console.log('║  Branch: experimente2e | Date: 2026-03-30                 ║');
  console.log('║  ROOT: NEWSTRUCTURE (all work from here)                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const results: SourceE2EResult[] = [];

  for (const entry of BATCH_URLS) {
    try {
      const r = await testSource(entry);
      results.push(r);
    } catch (err: any) {
      console.error(`  ❌ UNHANDLED: ${err.message}`);
      results.push({
        id: entry.id,
        name: entry.name,
        url: entry.url,
        prevStatus: entry.prev,
        steps: [{ step: 'UNHANDLED', status: 'fail', detail: err.message }],
        finalStatus: 'fail',
        eventsQueued: 0,
        eventsNormalized: 0,
        errors: [err.message],
      });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('BATCH SUMMARY');
  console.log('═'.repeat(60));

  const success = results.filter(r => r.finalStatus === 'success').length;
  const partial = results.filter(r => r.finalStatus === 'partial').length;
  const fail = results.filter(r => r.finalStatus === 'fail').length;
  const totalQueued = results.reduce((s, r) => s + r.eventsQueued, 0);
  const totalNorm = results.reduce((s, r) => s + r.eventsNormalized, 0);

  console.log(`\nTotal sources: ${results.length}`);
  console.log(`✅ success:  ${success}`);
  console.log(`⚠️  partial:  ${partial}`);
  console.log(`❌ fail:     ${fail}`);
  console.log(`Events queued:     ${totalQueued}`);
  console.log(`Events normalized: ${totalNorm}`);

  console.log('\n─── Per-source results ───');
  for (const r of results) {
    const icon = r.finalStatus === 'success' ? '✅' : r.finalStatus === 'partial' ? '⚠️' : '❌';
    console.log(`\n${icon} #${r.id} ${r.name}`);
    console.log(`   prev: ${r.prevStatus} → final: ${r.finalStatus}`);
    console.log(`   queued: ${r.eventsQueued}, normalized: ${r.eventsNormalized}`);
    for (const step of r.steps) {
      if (step.status === 'fail' || step.status === 'warn') {
        console.log(`   [${step.step}] ${step.detail}`);
        if (step.error) console.log(`     error: ${step.error}`);
      }
    }
  }

  // Save JSON log to NEWSTRUCTURE/08-testResults/
  const { writeFileSync } = await import('fs');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFile = `${NEWSTRUCTURE_ROOT}/08-testResults/${ts}-batch1-10-log.json`;
  writeFileSync(logFile, JSON.stringify(results, null, 2));
  console.log(`\n💾 Log saved: ${logFile}`);

  return results;
}

// Run
runBatch().catch(console.error);
