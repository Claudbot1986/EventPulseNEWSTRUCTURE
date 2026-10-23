#!/usr/bin/env node
/**
 * verify-shutdown-safety — bevisar att normalizer-kedjan stänger rent.
 *
 * Bakgrund (2026-10-23). Tre verkliga fel hittades i samma kedja:
 *
 *  1. `03-Queue/startWorker.ts` hade INGEN SIGTERM-handler. Node avslutar då
 *     processen omedelbart, och BullMQ-jobb som var i-flight lämnades kvar i
 *     `active` med en utgången lås — de fick varken completed, failed eller
 *     retry, och eventet persisterades ALDRIG. Mätt: 5 jobb (sigterm-test-*)
 *     fastnade i `active` med `locked=false`.
 *
 *  2. `03-Queue/drainQueue.ts --status` var ett "read-only"-läge som bara
 *     skilde sig från dräneringen med en `process.exit(0)`. Utan den raden
 *     föll status-läget rakt in i en riktig dränering av produktionskön.
 *     Mätt: en muterad variant av filen skapade en normalizer-worker och
 *     pickade upp 26 väntande jobb — som dog med "Connection is closed."
 *     fastän deras events redan fanns i databasen.
 *
 *  3. `processRawEvent` kastade ur `searchSyncQueue.add()`/`aiImageQueue.add()`
 *     — båda körs EFTER att eventet skrivits till Supabase. Ett fel där
 *     markerade jobbet som failed, vilket säger "inget persisterades".
 *
 * Kontrollerna nedan körs mot den RIKTIGA koden (riktig worker, riktig kö,
 * riktig Supabase). Negativ kontroll: check 1 körs även mot en kopia av
 * startWorker.ts UTAN SIGTERM-handler — den MÅSTE lämna orphaner, annars
 * mäter gaten ingenting.
 *
 * Rensar efter sig: alla rader den skapar har source='shutdown-probe' och
 * tas bort efteråt (inkl. event_categories och ingestion_logs).
 *
 * Usage: node scripts/verify-shutdown-safety.mjs [--only=<check>]
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROBE_SOURCE = 'shutdown-probe';
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

// ── .env ────────────────────────────────────────────────────────────────────
function envKey(key) {
  if (!existsSync(path.join(ROOT, '.env'))) return undefined;
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const REDIS_URL = envKey('REDIS_URL') || 'redis://localhost:6379';
const DATABASE_URL = envKey('DATABASE_URL');
const CHILD_ENV = {
  ...process.env,
  REDIS_URL,
  AI_IMAGE_PIPELINE_ENABLED: '0',
  EDITORIAL_ENABLED: '0',
};

// ── hjälpare ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function ok(msg) {
  console.log(`ok   ${msg}`);
}
function fail(msg) {
  failures += 1;
  console.error(`FAIL ${msg}`);
}
function info(msg) {
  console.log(`     ${msg}`);
}

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
const rawEvents = new Queue('raw_events', { connection: redis, prefix: 'bull' });

async function enqueueProbes(count, tag) {
  const ids = [];
  const start = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  for (let i = 0; i < count; i += 1) {
    const jobId = `shutdown-probe-${tag}-${Date.now()}-${i}`;
    await rawEvents.add(
      jobId,
      {
        // Titeln bär taggen så att databasraderna kan räknas exakt för
        // just det körande steget (andra steg kan lämna jobb i kön).
        title: `Provkoe avslutningssakerhet ${tag}-${i}`,
        description: 'Verifieringskö för avstängningssäkerhet — tas bort efter testet.',
        start_time: start,
        end_time: null,
        venue_name: 'Verifikationslokal',
        venue_address: 'Testgatan 1, Stockholm',
        lat: 59.3293,
        lng: 18.0686,
        categories: [],
        is_free: true,
        price_min_sek: null,
        price_max_sek: null,
        ticket_url: null,
        image_url: null,
        source: PROBE_SOURCE,
        source_id: jobId,
        detected_language: 'sv',
        raw_payload: {},
      },
      { jobId },
    );
    ids.push(jobId);
  }
  return ids;
}

async function statesOf(ids) {
  const out = {};
  for (const id of ids) {
    const job = await rawEvents.getJob(id);
    if (!job) {
      out[id] = 'missing';
      continue;
    }
    const state = await job.getState();
    out[id] = state;
  }
  return out;
}

function countBy(states) {
  const counts = {};
  for (const s of Object.values(states)) counts[s] = (counts[s] ?? 0) + 1;
  return counts;
}

async function waitForExit(proc, timeoutMs) {
  const exited = new Promise((resolve) => {
    proc.on('exit', (code, signal) => resolve({ code, signal }));
  });
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const result = await Promise.race([exited, timer]);
  return result ?? { code: null, signal: 'TIMEOUT' };
}

function runScript(scriptPath, args, timeoutMs) {
  const proc = spawn(TSX, [scriptPath, ...args], {
    cwd: ROOT,
    env: CHILD_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.stderr.on('data', (d) => { out += d.toString(); });
  return { proc, getOutput: () => out };
}

// ── databas ─────────────────────────────────────────────────────────────────
async function withDb(fn) {
  if (!DATABASE_URL) throw new Error('DATABASE_URL saknas i .env');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function countProbeRows(tag) {
  return withDb(async (c) => {
    if (tag) {
      const r = await c.query(
        'SELECT count(*)::int AS n FROM events WHERE source = $1 AND title_sv LIKE $2',
        [PROBE_SOURCE, `Provkoe avslutningssakerhet ${tag}-%`],
      );
      return r.rows[0].n;
    }
    const r = await c.query('SELECT count(*)::int AS n FROM events WHERE source = $1', [PROBE_SOURCE]);
    return r.rows[0].n;
  });
}

async function cleanupProbeRows() {
  return withDb(async (c) => {
    const before = await c.query('SELECT count(*)::int AS n FROM events WHERE source = $1', [PROBE_SOURCE]);
    await c.query(
      'DELETE FROM event_categories WHERE event_id IN (SELECT id FROM events WHERE source = $1)',
      [PROBE_SOURCE],
    );
    await c.query('DELETE FROM events WHERE source = $1', [PROBE_SOURCE]);
    await c.query('DELETE FROM ingestion_logs WHERE source = $1', [PROBE_SOURCE]);
    return before.rows[0].n;
  });
}

async function cleanupOrphans(ids) {
  for (const id of ids) {
    const job = await rawEvents.getJob(id);
    if (!job) continue;
    const state = await job.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      try {
        await job.remove();
      } catch {
        /* jobbet kan ha bytt state under tiden */
      }
    }
  }
}

/** Ta bort ALLA kvarlämnade provjobb så att nästa steg mäter sin egen körning. */
async function purgeProbeJobs() {
  for (const state of ['waiting', 'delayed', 'active']) {
    const jobs = await rawEvents.getJobs([state], 0, 500);
    for (const job of jobs) {
      if (String(job.id).startsWith('shutdown-probe-')) {
        try {
          await job.remove();
        } catch {
          /* ignoreras — kan ha bytt state */
        }
      }
    }
  }
}

// ── check 1: SIGTERM lämnar inga orphaner ──────────────────────────────────
async function sigtermScenario(scriptPath, tag, jobCount) {
  const ids = await enqueueProbes(jobCount, tag);
  const { proc, getOutput } = runScript(scriptPath, [], 0);

  // Vänta tills jobben är upptagna (processedOn satt = de är i-flight).
  const pickupDeadline = Date.now() + 40_000;
  let picked = 0;
  while (Date.now() < pickupDeadline) {
    const states = await statesOf(ids);
    picked = Object.values(states).filter((s) => s === 'active' || s === 'completed').length;
    if (picked >= Math.min(3, jobCount)) break;
    await sleep(150);
  }

  proc.kill('SIGTERM');
  const exit = await waitForExit(proc, 45_000);
  await sleep(2_000);

  const states = await statesOf(ids);
  const counts = countBy(states);
  const orphans = counts.active ?? 0;
  return { ids, exit, counts, orphans, output: getOutput() };
}

async function checkSigterm() {
  console.log('\n== check 1: SIGTERM under pågående jobb ==');

  // 1a — den riktiga startWorker.ts (med SIGTERM-handler).
  const fixed = await sigtermScenario('03-Queue/startWorker.ts', 'fixed', 25);
  info(`fast kod: exit=${fixed.exit.code} signal=${fixed.exit.signal} states=${JSON.stringify(fixed.counts)}`);
  if (fixed.exit.signal === 'TIMEOUT') {
    fail('fast kod: workern avslutade INTE inom 45 s efter SIGTERM');
  } else if (fixed.orphans > 0) {
    fail(`fast kod: ${fixed.orphans} jobb lämnades i 'active' efter SIGTERM — de persisteras aldrig`);
  } else {
    ok(`fast kod: 0 orphaner efter SIGTERM (${JSON.stringify(fixed.counts)})`);
  }

  // 1b — negativ kontroll: samma startWorker.ts UTAN SIGTERM-handler.
  // Kopian MÅSTE ligga i 03-Queue/ — annars pekar dess relativa importer
  // ('./queue', '../04-Normalizer/normalizer') fel och processen startar
  // aldrig riktigt.
  const strippedPath = path.join(ROOT, '03-Queue', '__tmp_no_sigterm.ts');
  const original = readFileSync(path.join(ROOT, '03-Queue/startWorker.ts'), 'utf8');
  const stripped = original
    .replace(/process\.on\('SIGTERM'[\s\S]*?process\.on\('SIGINT'[^\n]*\n/, '')
    .replace(/async function shutdown[\s\S]*?\n}\n/, '');
  if (stripped.includes("process.on('SIGTERM'") || stripped.includes('async function shutdown')) {
    fail('negativ kontroll: kunde inte strippa SIGTERM-handlern ur kopian');
    return;
  }
  writeFileSync(strippedPath, stripped, 'utf8');
  let negative;
  try {
    negative = await sigtermScenario(strippedPath, 'neg', 25);
  } finally {
    unlinkSync(strippedPath);
  }
  info(`negativ kontroll: exit=${negative.exit.code} signal=${negative.exit.signal} states=${JSON.stringify(negative.counts)}`);
  if (negative.exit.signal === 'TIMEOUT') {
    fail('negativ kontroll: workern utan SIGTERM-handler avslutade inte alls inom 45 s');
  } else if (negative.orphans === 0) {
    fail('negativ kontroll: utan SIGTERM-handler fanns INGA orphaner — gaten mäter ingenting');
  } else {
    ok(`negativ kontroll: ${negative.orphans} orphaner utan SIGTERM-handler — gaten kan FAIL:a`);
  }

  await cleanupOrphans([...fixed.ids, ...negative.ids]);
}

// ── check 2: --status dräner inte ─────────────────────────────────────────
async function checkStatusDoesNotDrain() {
  console.log('\n== check 2: --status är read-only ==');
  const ids = await enqueueProbes(5, 'status');
  const { proc, getOutput } = runScript('03-Queue/drainQueue.ts', ['--status'], 60_000);
  const exit = await waitForExit(proc, 45_000);
  const states = await statesOf(ids);
  const counts = countBy(states);

  info(`exit=${exit.code} signal=${exit.signal} states=${JSON.stringify(counts)}`);
  if (exit.signal === 'TIMEOUT') {
    fail('--status avslutade INTE inom 45 s — socket-läckan är tillbaka');
  } else if (exit.code !== 0) {
    fail(`--status avslutade med exit ${exit.code}: ${getOutput().split('\n').slice(-3).join(' | ')}`);
  } else if ((counts.completed ?? 0) + (counts.active ?? 0) + (counts.failed ?? 0) > 0) {
    fail(`--status dränade jobb: ${JSON.stringify(counts)} — status-läget får aldrig köa`);
  } else {
    ok(`--status avslutade rent (exit 0) utan att röra kön (${JSON.stringify(counts)})`);
  }
  await cleanupOrphans(ids);
}

// ── check 3: en riktig drain persisterar events ────────────────────────────
async function checkDrainPersists() {
  console.log('\n== check 3: riktig drain persisterar events ==');
  await purgeProbeJobs();
  const tag = `drain-${Date.now()}`;
  const ids = await enqueueProbes(5, tag);
  const { proc, getOutput } = runScript('03-Queue/drainQueue.ts', ['--max-ms', '180000'], 210_000);
  const exit = await waitForExit(proc, 200_000);
  const states = await statesOf(ids);
  const counts = countBy(states);
  const rows = await countProbeRows(tag);

  info(`exit=${exit.code} states=${JSON.stringify(counts)} db-rader=${rows}`);
  if ((counts.completed ?? 0) !== ids.length) {
    fail(`drain: ${counts.completed ?? 0}/${ids.length} jobb completed — ${getOutput().split('\n').slice(-5).join(' | ')}`);
  } else if ((counts.failed ?? 0) > 0) {
    fail(`drain: ${counts.failed} jobb failed — ett persisterat event får inte markeras failed`);
  } else if (rows !== ids.length) {
    fail(`drain: ${rows} rader lades i databasen, förväntade ${ids.length}`);
  } else {
    ok(`drain: ${ids.length} jobb completed, 0 failed, ${rows} events persisterade i Supabase`);
  }
  await cleanupOrphans(ids);
}

// ── main ───────────────────────────────────────────────────────────────────
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

try {
  if (!only || only === 'sigterm') await checkSigterm();
  if (!only || only === 'status') await checkStatusDoesNotDrain();
  if (!only || only === 'drain') await checkDrainPersists();
} catch (err) {
  fail(`oväntat fel: ${err?.stack ?? err}`);
} finally {
  const removed = await cleanupProbeRows().catch(() => 0);
  if (removed > 0) info(`städade bort ${removed} verifieringsrader (source=${PROBE_SOURCE})`);
  await rawEvents.close().catch(() => {});
  await redis.quit().catch(() => {});
}

console.log(failures === 0 ? '\nALLA KONTROLLER OK' : `\n${failures} KONTROLL(ER) MISSLYCKADES`);
process.exit(failures === 0 ? 0 : 1);
