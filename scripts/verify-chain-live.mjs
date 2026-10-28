#!/usr/bin/env node
/**
 * verify-chain-live.mjs — GATE L3/L4/L5/L7: kedjan producerar EVENTS, kön
 * töms, status.json ljuger inte, och ledgerbeviset skrivs.
 *
 * Varför (2026-10-28). Rot-GATES.md hade 103 gröna gates, men ingen av dem
 * bevisade att kedjan producerar events. Under tre nätter skrev kedjan
 * "klart" med 0 events. De fyra gaterna här mäter det som faktiskt spelar roll:
 *
 *   L3 — kedjan producerar events OCH persisterar dem i databasen.
 *   L4 — kön `bull:raw_events:wait` är tom efter körningen.
 *   L5 — `status.json` med `running: true` motsvarar en pid som lever.
 *   L7 — ledgerbeviset skrevs (annars vet vi inte om jobben nådde databasen).
 *
 * Mätningen sker FÖRE och EFTER, i samma process, med samma kodväg som
 * runtime använder. Bevisfilen skrivs till
 * `runtime/verification-reports/chain-live-<TS>.json` med
 * `{eventsPublicBefore, eventsPublicAfter, queueBefore, queueAfter, steps[], durationMs}`.
 *
 * VARFÖR L3 inte mäter "events_public växer" (2026-10-28). Dedup gör att
 * varje återimporterat event mappar mot en befintlig rad — så en korrekt
 * kedja ger NOLL nya rader i `events_public` trots att den skrev 5 402 events
 * till databasen. Att kräva "växer" vore att kräva att kedjan är trasig.
 * Rätt mått är: importen köar N > 0 events, drainen slutför M > 0 jobb med
 * 0 misslyckade (varje jobb persisterar en rad — normalizern kastar annars),
 * och inga rader försvinner ur `events_public`.
 *
 * VARFÖR gaten tvingar produktion. Import-ledgern gör importen idempotent:
 * en omkörning med oförändrade källor importerar 0 events. Det är RÄTT
 * beteende, men det gör gaten meningslös (den skulle vara röd varje gång).
 * Före körningen tas därför bort ett par ledgerposter för källor som har
 * FRAMTIDA events — då importeras de igen, och hela vägen
 * extract → kö → normalisera → Supabase provas på riktigt.
 *
 * Användning:
 *   node scripts/verify-chain-live.mjs --limit 50            # hel kedjan
 *   node scripts/verify-chain-live.mjs --only import-to-eventpulse,worker-drain
 *   node scripts/verify-chain-live.mjs --queue-only           # bara L4
 *   node scripts/verify-chain-live.mjs --no-run               # bara mäta (ingen körning)
 *   node scripts/verify-chain-live.mjs --exercise 0           # tvinga inte produktion
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { pickProducableSources } from './lib/extracted-events.mjs';
import { liveChainPids } from './lib/chain-guard.mjs';
import {
  ledgerStates,
  ledgerFailureLines,
  queuedGrewWithoutEvidence,
} from './lib/ledger-inspect.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const argValue = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
};

const QUEUE_KEY = 'bull:raw_events:wait';
const STATUS_PATH = path.join(PROJECT_ROOT, 'runtime', 'ingestion-cron.status.json');
const OVERVIEW_LOG = path.join(PROJECT_ROOT, 'runtime', 'ingestion-cron', 'chain-overview.log');
const REPORT_DIR = path.join(PROJECT_ROOT, 'runtime', 'verification-reports');
const LEDGER_PATH = path.join(PROJECT_ROOT, 'runtime', 'import-ledger.jsonl');

let ok = true;
const fail = (msg) => {
  console.error(`  FAIL: ${msg}`);
  ok = false;
};
const info = (msg) => console.log(`  ${msg}`);

// ── Mätning 1: events_public ────────────────────────────────────────────────

/**
 * Antal rader i events_public via PostgREST `Prefer: count=exact`.
 * Returnerar null om Supabase inte svarar — "vet inte", inte "noll".
 *
 * @returns {Promise<number | null>}
 */
async function countEventsPublic() {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `${base.replace(/\/$/, '')}/rest/v1/events_public?select=id`,
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: 'count=exact',
            Range: '0-0',
          },
        },
      );
      if (!response.ok) return null;
      // PostgREST svarar "0-0/NNNNN" i content-range när count=exact används.
      const contentRange = response.headers.get('content-range') ?? '';
      const match = /\/(\d+)\s*$/.exec(contentRange);
      if (match) return Number(match[1]);
      // Saknas content-range → räkna raderna i svaret (fungerar bara för små
      // tabeller, men bättre än att returnera 0 och ljuga).
      const body = await response.json();
      return Array.isArray(body) ? body.length : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// ── Mätning 2: ködjup ──────────────────────────────────────────────────────

/**
 * Ködjup i bull:raw_events:wait via ioredis (samma klientfamilj som runtime).
 * Returnerar null om Redis inte svarar.
 *
 * @returns {Promise<number | null>}
 */
async function queueDepth() {
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      connectTimeout: 3_000,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    client.on('error', () => {});
    try {
      await client.connect();
      return await client.llen(QUEUE_KEY);
    } finally {
      client.disconnect();
    }
  } catch {
    return null;
  }
}

// ── Mätning 3: status.json-liveness (GATE L5) ───────────────────────────────

/**
 * status.json får INTE säga running:true med en död pid.
 * Det var watchdogens "ZOMBIE"-läge under nattet 26–28 okt.
 *
 * @returns {{ running: boolean, pid: number | null, alive: boolean, ok: boolean, detail: string }}
 */
function checkStatusLiveness() {
  if (!fs.existsSync(STATUS_PATH)) {
    return { running: false, pid: null, alive: false, ok: false, detail: 'status.json saknas' };
  }
  let status;
  try {
    status = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch (err) {
    return {
      running: false,
      pid: null,
      alive: false,
      ok: false,
      detail: `status.json kan inte tolkas: ${err instanceof Error ? err.message : err}`,
    };
  }
  const pid = typeof status.pid === 'number' ? status.pid : null;
  if (!status.running) {
    return { running: false, pid, alive: false, ok: true, detail: `running=false (pid ${pid ?? '?'})` };
  }
  if (pid === null) {
    return { running: true, pid: null, alive: false, ok: false, detail: 'running=true men pid saknas' };
  }
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (err) {
    alive = /** @type {any} */ (err)?.code === 'EPERM';
  }
  return {
    running: true,
    pid,
    alive,
    ok: alive,
    detail: alive ? `running=true, pid ${pid} lever` : `running=true men pid ${pid} är död — ZOMBIE`,
  };
}

// ── Mätning 4: chain-overview.log ──────────────────────────────────────────

/**
 * Läs de rader i chain-overview.log som tillkom under en tidsperiod.
 * Letar efter hängningar och preflight-fel.
 *
 * @param {number} sinceEpochMs
 * @returns {{ preflightFail: number, stepTimeout: number, silentTransport: number, lines: number }}
 */
function overviewSince(sinceEpochMs) {
  if (!fs.existsSync(OVERVIEW_LOG)) return { preflightFail: 0, stepTimeout: 0, silentTransport: 0, lines: 0 };
  const raw = fs.readFileSync(OVERVIEW_LOG, 'utf8');
  let preflightFail = 0;
  let stepTimeout = 0;
  let silentTransport = 0;
  let lines = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(parsed?.ts ?? '');
    if (!Number.isFinite(ts) || ts < sinceEpochMs) continue;
    lines++;
    if (parsed?.event === 'preflight-fail') preflightFail++;
    if (parsed?.event === 'step-timeout') stepTimeout++;
    if (parsed?.event === 'silent-transport-error') silentTransport++;
  }
  return { preflightFail, stepTimeout, silentTransport, lines };
}

// ── Mätning 5: tvinga produktion + mäta databasskrivningar ────────────────

/**
 * Antal NYA rader i `events` som skapats sedan en given tidpunkt.
 *
 * Detta är den enda DB-sidan av L3 som inte kan luras av dedup: en rad som
 * skapas är garanterat en riktig skrivning. Uppdateringar (dedup-träffar)
 * syns inte här — de mäts via drainens `completed`/`failed`.
 *
 * @param {string} iso
 * @returns {Promise<number | null>}
 */
async function countEventsCreatedSince(iso) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `${base.replace(/\/$/, '')}/rest/v1/events?select=id&created_at=gte.${encodeURIComponent(iso)}`,
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: 'count=exact',
            Range: '0-0',
          },
        },
      );
      if (!response.ok) return null;
      const contentRange = response.headers.get('content-range') ?? '';
      const match = /\/(\d+)\s*$/.exec(contentRange);
      return match ? Number(match[1]) : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// ── Mätning 6: ledger-radernas tillstånd ────────────────────────────────────
// Implementeras i scripts/lib/ledger-inspect.mjs (ren, testad utan Redis).

// ── Kör kedjan ──────────────────────────────────────────────────────────────

/**
 * Kör ingestion-cron och fånga exit + output.
 *
 * @param {string[]} extraArgs
 * @returns {Promise<{ exitCode: number, durationMs: number, output: string }>}
 */
function runChain(extraArgs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn('npx', ['tsx', 'scripts/ingestion-cron.ts', ...extraArgs], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, AI_IMAGE_PIPELINE_ENABLED: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (c) => { output += c.toString('utf8'); });
    child.stderr.on('data', (c) => { output += c.toString('utf8'); });
    child.on('exit', (code) => {
      resolve({ exitCode: code ?? 1, durationMs: Date.now() - startedAt, output });
    });
  });
}

// ── Huvudflöde ──────────────────────────────────────────────────────────────

const limit = argValue('--limit');
const only = argValue('--only');
const queueOnly = has('--queue-only');
const noRun = has('--no-run');
// Hur många källor som ska importeras om för att bevisa produktion.
// 0 = tvinga inte (gaten mäter bara vad en körning faktiskt gjorde).
const exerciseCount = argValue('--exercise') !== undefined ? Number(argValue('--exercise')) : 3;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const startedAt = Date.now();
const runStartIso = new Date(startedAt).toISOString();

console.log(`[verify-chain-live] mäter världen (${new Date().toISOString()})`);

const eventsBefore = await countEventsPublic();
const queueBefore = await queueDepth();
const ledgerBefore = ledgerStates(LEDGER_PATH);
info(`events_public före: ${eventsBefore === null ? 'okänt (Supabase svarade inte)' : eventsBefore}`);
info(`kö ${QUEUE_KEY} före: ${queueBefore === null ? 'okänt (Redis svarade inte)' : queueBefore}`);
info(
  `ledger före: ${ledgerBefore.total} rader ` +
    `(persisted=${ledgerBefore.persisted} queued=${ledgerBefore.queued} ` +
    `empty=${ledgerBefore.empty} failed=${ledgerBefore.failed})`,
);

let exercise = null;
if (!queueOnly && !noRun && exerciseCount > 0) {
  const candidates = pickProducableSources(startedAt);
  const chosen = candidates.slice(0, exerciseCount);
  exercise = {
    dropped: chosen.map((c) => `${c.sourceId}(${c.future} framtida)`),
    sourceIds: chosen.map((c) => c.sourceId),
  };
  if (chosen.length > 0) {
    info(`L3: tvingar produktion — ${chosen.length} källa/källor importeras om: ${exercise.dropped.join(', ')}`);
  } else {
    info('L3: ingen källa med framtida events hittades — ingen import tvingas fram');
  }
}

let chain = null;
if (!queueOnly && !noRun) {
  // 2026-10-28 — krockvakt. En annan levande ingestion-kedja gör
  // mätningen värdelös: två processer skriver samma status.json, samma
  // stegloggar och samma kö. Det har hänt i verkligheten (två kedjor
  // startade samtidigt 2026-10-28), och resultatet blev omöjligt att
  // tolka. Vi vägrar köra i stället för att köra och ljuga.
  //
  // Kontrollen sker INNAN barnet startas — annars skulle kedjan själv
  // matcha mönstret (CHAIN_PATTERN = /scripts\/ingestion-cron\.ts/).
  const liveChains = liveChainPids();
  if (liveChains.length > 0) {
    fail(
      `en annan ingestion-kedja kör redan (pid ${liveChains.join(', ')}) — ` +
        'mätningen skulle krocka med den. Kör gaten när kedjan är klar.',
    );
    console.log('\n[verify-chain-live] RÖD');
    process.exit(1);
  }

  const chainArgs = [];
  if (limit) chainArgs.push('--limit', limit);
  if (only) chainArgs.push('--only', only);
  if (exercise && exercise.sourceIds.length > 0) {
    chainArgs.push('--force-import-sources', exercise.sourceIds.join(','));
  }
  console.log(`\n[verify-chain-live] kör kedjan: npx tsx scripts/ingestion-cron.ts ${chainArgs.join(' ')}`);
  chain = await runChain(chainArgs);
  console.log(`[verify-chain-live] kedjan exit=${chain.exitCode} på ${chain.durationMs}ms`);
  const tail = chain.output.split('\n').filter(Boolean).slice(-15).join('\n');
  for (const line of tail.split('\n')) console.log(`  | ${line}`);
}

const eventsAfter = await countEventsPublic();
const queueAfter = await queueDepth();
const eventsCreated = await countEventsCreatedSince(runStartIso);
const overview = overviewSince(startedAt);
const liveness = checkStatusLiveness();
const ledgerAfter = ledgerStates(LEDGER_PATH);
const ledgerFailures = chain ? ledgerFailureLines(chain.output) : [];

info(`events_public efter: ${eventsAfter === null ? 'okänt' : eventsAfter}`);
info(`kö efter: ${queueAfter === null ? 'okänt' : queueAfter}`);
info(`nya rader i events-tabellen under körningen: ${eventsCreated === null ? 'okänt' : eventsCreated}`);
info(
  `ledger efter: ${ledgerAfter.total} rader ` +
    `(persisted=${ledgerAfter.persisted} queued=${ledgerAfter.queued} ` +
    `empty=${ledgerAfter.empty} failed=${ledgerAfter.failed})`,
);

// ── Assertions ──────────────────────────────────────────────────────────────

console.log('\n── gates ──');

// L5 — status.json ljuger inte.
if (!liveness.ok) fail(`L5: ${liveness.detail}`);
else info(`L5 OK: ${liveness.detail}`);

// Kedjan ska inte ha hängt sig eller rapporterat transportfel i smyg.
if (overview.stepTimeout > 0) fail(`L3: ${overview.stepTimeout} steg timeoutade under körningen`);
if (overview.silentTransport > 0) fail(`L3: ${overview.silentTransport} tysta transportfel under körningen`);
if (overview.preflightFail > 0) fail(`L1: ${overview.preflightFail} preflight-fel under körningen`);

if (chain) {
  // Exit 69 = världen var trasig → kedjan startade inte → inget att mäta.
  if (chain.exitCode === 69) {
    fail('kedjan avbröts med exit 69 (preflight/transport) — inga events kan ha producerats');
  } else if (chain.exitCode !== 0) {
    fail(`kedjan avslutade med exit=${chain.exitCode} (förväntat 0)`);
  } else {
    info(`kedjan avslutade rent (exit=0)`);
  }
}

// L3 — kedjan producerade events OCH persisterade dem.
//
// Varför inte "events_public växer": dedup gör att varje återimporterat
// event mappar mot en befintlig rad. En korrekt kedja skriver då NOLL nya
// rader i `events_public` trots att den skrev tusentals rader till databasen.
// Rätt bevis är: importen köade N > 0, drainen slutförde M > 0 med 0 fel,
// och inga rader försvann ur `events_public`.
//
// 2026-10-28 — "slutförde" är inte "skrev en ny rad". Normalizern kan hoppa
// över ett event (förgången datum, titel-gate, bulk-skydd) eller träffa en
// befintlig rad (dedup) — jobbet slutförs ändå. Antalet faktiskt skrivna
// rader mäts separat (`eventsCreatedDuringRun`).
const enqueued = Number(/(\d+)\s+events till bullmq/.exec(chain?.output ?? '')?.[1] ?? 0);
const drainMatch = /\[drain\] avslutar \([^)]*\): completed=(\d+) failed=(\d+)/.exec(chain?.output ?? '');
const drainCompleted = drainMatch ? Number(drainMatch[1]) : null;
const drainFailed = drainMatch ? Number(drainMatch[2]) : null;

if (noRun) {
  info('L3: ingen körning gjordes (--no-run) — mätningen hoppas över');
} else if (queueOnly) {
  info('L3: ingen körning gjordes (--queue-only) — mätningen hoppas över');
} else if (enqueued <= 0) {
  fail(`L3: importen köade 0 events (enqueued=${enqueued}) — kedjan producerade ingenting`);
} else if (drainCompleted === null) {
  fail(`L3: importen köade ${enqueued} events men drainen rapporterade inget utfall — persisteringen går inte att bevisa`);
} else if (drainCompleted <= 0) {
  fail(`L3: importen köade ${enqueued} events men drainen slutförde 0 jobb — inget kom till databasen`);
} else if (drainFailed > 0) {
  fail(`L3: ${drainFailed} av ${drainCompleted + drainFailed} jobb misslyckades i drainen`);
} else {
  info(`L3 OK: ${enqueued} events köade → ${drainCompleted} jobb slutfördes av drainen (0 misslyckade)`);
  if (enqueued > drainCompleted) {
    // Skillnaden är BullMQ:s jobb-id-dedup: en rad som redan har ett
    // "completed"-jobb med samma id läggs inte in i kön igen. Inga jobb
    // försvinner — kön står tom och inget misslyckades.
    info(`  ${enqueued - drainCompleted} event läggs inte in i kön (samma jobb-id finns redan bland de klara) — inget försvinner`);
  }
  if (eventsCreated !== null && eventsCreated > 0) {
    info(`  ${eventsCreated} nya rader skapades i events-tabellen`);
  } else if (eventsCreated === 0) {
    info('  0 nya rader i events-tabellen — alla events matchade befintliga rader (dedup), vilket är korrekt beteende');
  }
  // 2026-10-28 — "completed" är INTE "nya rader i databasen". Normalizern kan
  // hoppa över ett event (förgången datum, titel-gate, bulk-skydd) eller
  // träffa en befintlig rad (dedup) — jobbet slutförs ändå. Därför redovisas
  // de två talen var för sig, och raden ovan säger "jobb slutfördes", inte
  // "rader skapades". Den ärliga siffran för skrivna rader är
  // eventsCreatedDuringRun i bevisfilen.
}

// Dataförlust får aldrig förekomma: antalet publicerade events kan inte
// minska under en körning.
if (eventsBefore !== null && eventsAfter !== null && eventsAfter < eventsBefore) {
  fail(`L3: events_public ${eventsBefore} → ${eventsAfter} — rader försvann under körningen`);
}

// L4 — kön tom efter körningen.
if (noRun) {
  info('L4: mäts bara efter en körning');
} else if (queueAfter === null) {
  fail('L4: Redis svarade inte — ködjupet kunde inte mätas');
} else if (queueAfter === 0) {
  info('L4 OK: kön är tom');
} else if (queueOnly) {
  fail(`L4: kön är inte tom (${queueAfter} jobb väntar)`);
} else if (queueAfter < (queueBefore ?? 0)) {
  fail(`L4: kön sjönk men är inte tom (${queueBefore} → ${queueAfter})`);
} else {
  fail(`L4: kön växte eller stod still (${queueBefore} → ${queueAfter})`);
}

// L7 — ledgerbeviset skrevs.
//
// Varför (2026-10-28). Under tre nätter såg kedjan GRÖN ut medan ledger
// stod kvar på 'queued'. Orsaken var ett stavnamn i drainen
// (`persistedBySource` istället för `persistedByFile`): felet kastades i en
// catch som bara loggade, och kedjans klassificering läste loggraden som
// 'logic' — alltså grönt. Ingenting skrev bevis, och nästa natt hoppade
// importen över källorna. Events försvann utan att en enda logg sa något.
//
// Två kontroller:
//   1. Kedjans logg får INTE innehålla "kunde inte uppdatera/skriva ledger".
//   2. Om dräneringen slutförde jobb får antalet 'queued'-rader inte växa —
//      jobb som kördes men inte gav bevis betyder att beviset inte skrevs.
if (noRun || queueOnly || !chain) {
  info('L7: ingen körning gjordes — ledgerbeviset mäts bara efter en körning');
} else if (ledgerFailures.length > 0) {
  fail(
    `L7: ${ledgerFailures.length} rad(er) i kedjans logg säger att ledgerbeviset inte skrevs — ` +
      'källorna stannar i "queued" och importeras om nästa natt',
  );
  for (const line of ledgerFailures.slice(0, 3)) console.error(`  | ${line}`);
} else if (queuedGrewWithoutEvidence(ledgerBefore, ledgerAfter, drainCompleted ?? 0)) {
  fail(
    `L7: dräneringen slutförde ${drainCompleted} jobb men antalet "queued"-rader växte ` +
      `(${ledgerBefore.queued} → ${ledgerAfter.queued}) — beviset skrevs inte`,
  );
} else {
  info(
    `L7 OK: ledgerbeviset skrevs (queued ${ledgerBefore.queued} → ${ledgerAfter.queued}, ` +
      `persisted ${ledgerBefore.persisted} → ${ledgerAfter.persisted})`,
  );
}

// ── Bevisfil ────────────────────────────────────────────────────────────────

fs.mkdirSync(REPORT_DIR, { recursive: true });
const report = {
  stamp,
  eventsPublicBefore: eventsBefore,
  eventsPublicAfter: eventsAfter,
  queueBefore,
  queueAfter,
  queueKey: QUEUE_KEY,
  steps: chain
    ? chain.output
        .split('\n')
        .filter((l) => /^\[ingestion-cron\]/.test(l))
        .slice(-60)
    : [],
  chainExitCode: chain ? chain.exitCode : null,
  chainDurationMs: chain ? chain.durationMs : null,
  durationMs: Date.now() - startedAt,
  overview,
  liveness,
  ledgerBefore,
  ledgerAfter,
  ledgerFailures,
  enqueued,
  drainCompleted,
  drainFailed,
  eventsCreatedDuringRun: eventsCreated,
  exercisedSources: exercise?.dropped ?? [],
  ok,
};
const reportPath = path.join(REPORT_DIR, `chain-live-${stamp}.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\n[verify-chain-live] bevisfil: ${path.relative(PROJECT_ROOT, reportPath)}`);

console.log(ok ? '\n[verify-chain-live] GRÖN' : '\n[verify-chain-live] RÖD');
process.exit(ok ? 0 : 1);
