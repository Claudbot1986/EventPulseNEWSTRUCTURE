#!/usr/bin/env node
/**
 * verify-step-timeout.mjs — bevis för per-step-timeouten i ingestion-cron.
 *
 * Bakgrund. Kedjan kan fastna i ett steg som aldrig avslutar. Historiken
 * visar tribe-events som stod kvar i 419 485 s (116 h) utan att kedjan
 * brytte. En heartbeat räcker inte — kedjan behöver en HÅRD gräns.
 *
 * Timeouten är implementerad (runStep, INGESTION_STEP_TIMEOUT_MS, default
 * 2 h, SIGTERM → SIGKILL efter 30 s). Men den har aldrig KÖRTS — i
 * chain-overview.log (16 574 rader) finns noll "step-timeout"-händelser.
 * Ett mekaniskt som aldrig avfyrats är inte bevisat.
 *
 * Gates:
 *   t1 — positiv kontroll: med en 8 s-gräns dödas B-network-api (som tar
 *        ~32 s), kedjan skriver step-timeout OCH step-end med exitCode=124,
 *        och processen avslutar (den hänger inte).
 *   t2 — negativ kontroll: samma steg med en stor gräns (600 s) dör INTE,
 *        och ger exitCode=0. Utan den skulle t1 bara mäta "steget misslyckades".
 *
 * Beviset läses ur de NYA raderna i runtime/ingestion-cron/chain-overview.log
 * (radräknaren snapshotas före körningen) — inte ur hela loggen, så en
 * tidigare timeout från en annan körning inte kan smyga igenom.
 *
 * Anropas som `node scripts/verify-step-timeout.mjs <t1|t2>`.
 * Skriver ut `tN: <status> pass` på stdout vid PASS, annars `tN: FAIL …`
 * på stderr + exit 1. Utskriften matchas av GATES.md:s `EXPECT:`.
 */

import { existsSync, readFileSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { liveChainPids } from './lib/chain-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

const CRON = path.join(ROOT, 'scripts/ingestion-cron.ts');
const CHAIN_LOG = path.join(ROOT, 'runtime/ingestion-cron/chain-overview.log');

/** Steget som beviset körs mot. direct-jsonld tog 16–31 s i 12 av 12
 *  dokumenterade körningar — alltså tydligt över en 8 s-gräns, men under en
 *  600 s-gräns. Samma steg används i BÅDA gaten, så t2 är en riktig negativ
 *  kontroll av samma mekanism: bara tröskeln ändras.
 *  Sidoreffekten är begränsad: steget upsertar riktiga events direkt i
 *  Supabase, och en avbruten körning lämnar bara en delmängd som nästa
 *  körning upsertar igen (idempotent). */
const STEP = 'direct-jsonld';

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

/** Antal rader i chain-overview.log just nu (0 om filen saknas). */
function logLines() {
  if (!existsSync(CHAIN_LOG)) return 0;
  const raw = readFileSync(CHAIN_LOG, 'utf8');
  return raw.length === 0 ? 0 : raw.trim().split('\n').length;
}

/** Raderna som tillkom sedan `from`. */
function newLines(from) {
  if (!existsSync(CHAIN_LOG)) return [];
  const raw = readFileSync(CHAIN_LOG, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').slice(from).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Vägra köra om en annan ingestion-kedja lever.
 *
 * Varför (2026-10-24). Gaten startar ett riktigt produktionssteg. Om
 * nattkörningen är igång samtidigt mäter gaten inte steget — den krockar
 * med det. Det hände faktiskt: gaten dödade nattkörningens pågående
 * discover-subpaths.mjs och ingest-direct-jsonld.mjs (båda exit=1), så
 * kedjan körde med två av sina steg dödade. En gate som krockar med
 * produktionen är inte ett mätvärde.
 */
function assertNoLiveChain(gate) {
  const chains = liveChainPids();
  if (chains.length > 0) {
    fail(
      `${gate}: en ingestion-kedja kör (pid ${chains.join(', ')}) — ` +
      'en gate som krockar med produktionen mäter ingenting. Vänta tills ' +
      'kedjan är klar, eller kör gaten med --only på ett eget steg.',
    );
  }
}

/**
 * Kör ingestion-cron med ett enda steg och en given timeout, och returnera
 * de nya chain-overview-raderna plus processens exitkod.
 */
function runCron(timeoutMs, step) {
  const before = logLines();
  const started = Date.now();
  const res = spawnSync(
    'npx',
    ['tsx', 'scripts/ingestion-cron.ts', '--only', step],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
      env: { ...process.env, INGESTION_STEP_TIMEOUT_MS: String(timeoutMs) },
    },
  );
  return {
    before,
    after: logLines(),
    lines: newLines(before),
    exitCode: res.status,
    signal: res.signal,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    wallMs: Date.now() - started,
    timedOutByHarness: res.signal === 'SIGTERM',
  };
}

// ── T1: positiv kontroll — timeouten dödar steget ─────────────────────────

if (arg === 't1') {
  assertNoLiveChain('t1');
  const r = runCron(8_000, STEP);

  if (r.timedOutByHarness) {
    fail(`t1: cron-processen dog av SIGTERM efter ${Math.round(r.wallMs / 1000)}s — timeouten hänger kedjan, den bryter den inte`);
  }
  if (r.exitCode === 0) {
    fail(`t1: cron avslutade med exit=0 trots 8 s-gräns — steget tog inte längre än gränsen, beviset mäter inget\n${r.stdout.slice(-800)}`);
  }
  const timeouts = r.lines.filter((l) => l.event === 'step-timeout' && l.step === STEP);
  if (timeouts.length === 0) {
    fail(`t1: ingen step-timeout i de nya loggraderna — timeouten avfyrdes aldrig\n${r.stdout.slice(-800)}`);
  }
  const ends = r.lines.filter((l) => l.event === 'step-end' && l.step === STEP);
  if (ends.length === 0) {
    fail('t1: ingen step-end efter timeouten — kedjan skrev inte slut på steget');
  }
  const end = ends[ends.length - 1];
  if (end.exitCode !== 124) {
    fail(`t1: step-end har exitCode=${end.exitCode}, förväntat 124 (timeout)`);
  }
  if (end.timedOut !== true) {
    fail('t1: step-end saknar timedOut=true — steget vet inte att det dog i timeout');
  }
  if (end.durationMs > 60_000) {
    fail(`t1: steget tog ${Math.round(end.durationMs / 1000)} s — SIGTERM/SIGKILL-eskaleringen fungerar inte`);
  }
  ok(`t1: ${STEP} dödad av 8 s-gränsen — step-timeout + step-end exit=124 (${Math.round(end.durationMs / 1000)} s), kedjan avslutade med exit=${r.exitCode} pass`);
}

// ── T2: negativ kontroll — med stor gräns dör inget steg ──────────────────

if (arg === 't2') {
  assertNoLiveChain('t2');
  const r = runCron(600_000, STEP);

  const timeouts = r.lines.filter((l) => l.event === 'step-timeout');
  if (timeouts.length > 0) {
    fail(`t2: ${timeouts.length} step-timeout trots 600 s-gräns — gaten mäter inte timeouten utan något annat`);
  }
  const ends = r.lines.filter((l) => l.event === 'step-end' && l.step === STEP);
  if (ends.length === 0) {
    fail('t2: ingen step-end — steget kördes inte alls');
  }
  const end = ends[ends.length - 1];
  if (end.exitCode !== 0) {
    fail(`t2: step-end exitCode=${end.exitCode} (förväntat 0) — negativ kontrollen kan inte skilja timeout från ett vanligt fel\n${r.stdout.slice(-800)}`);
  }
  if (end.timedOut === true) {
    fail('t2: step-end har timedOut=true utan timeout');
  }
  ok(`t2: ${STEP} klarade sig med 600 s-gränsen — exit=0 (${Math.round(end.durationMs / 1000)} s), noll step-timeout pass`);
}

// ── T3: concurrency-guard — gaten vägrar köra när en kedja lever ──────────
//
// Varför. Gaten startar ett riktigt produktionssteg. Om nattkörningen är
// igång samtidigt mäter gaten inte steget — den krockar med det. Det
// hände 2026-10-24: gaten startade `ingestion-cron.ts --only direct-jsonld`
// parallellt med nattkörningen, och pre-kill dödade nattkörningens
// discover-subpaths.mjs och ingest-direct-jsonld.mjs (båda exit=1).
//
// Testet startar en FALSK kedje (cmdline som matchar kedjemönstret) och
// kräver att gaten vägrar köra. Utan en riktig vägran är guarden dekoration.

if (arg === 't3') {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ep-chain-guard-'));
  const scriptsDir = path.join(tmp, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  const chainFile = path.join(scriptsDir, 'ingestion-cron.ts');
  writeFileSync(
    chainFile,
    "console.log('fake chain pid=' + process.pid);\nsetTimeout(() => process.exit(0), 600000);\n",
    'utf8',
  );

  let fakePid = null;
  try {
    const fake = spawn('node', [chainFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('falsk kedja startade inte')), 15_000);
      fake.stdout.on('data', (d) => {
        buf += d.toString();
        const m = buf.match(/pid=(\d+)/);
        if (m) { clearTimeout(timer); fakePid = parseInt(m[1], 10); resolve(); }
      });
      fake.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    // Kör gaten på riktigt som en användare skulle göra.
    const res = spawnSync('node', [path.join(ROOT, 'scripts/verify-step-timeout.mjs'), 't1'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const out = `${res.stdout || ''}${res.stderr || ''}`.trim();

    if (res.status === 0) {
      fail(`t3: gaten KÖRDE medan en ingestion-kedja levde (pid ${fakePid}) — guarden fungerar inte\n${out}`);
    }
    if (!/en ingestion-kedja kör/.test(out)) {
      fail(`t3: gaten vägrade men av fel skäl: ${out}`);
    }
    ok(`t3: gaten vägrade köra medan en ingestion-kedja levde (pid ${fakePid}) — mätvärde och inte krock pass`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (!['t1', 't2', 't3'].includes(arg)) {
  fail('usage: node scripts/verify-step-timeout.mjs <t1|t2|t3>');
}
