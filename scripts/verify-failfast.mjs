#!/usr/bin/env node
/**
 * verify-failfast.mjs — GATE L2: importen fäller snabbt, och säger ifrån.
 *
 * Bakgrund (2026-10-28). Nattköningen 2026-10-26 hängde i två timmar
 * (exit=124) med 583 KB identiska felrader och 0 events köade. Två lager
 * gjorde det möjligt:
 *
 *   1. BullMQ ignorerade REDIS_URL (kopplingsfabriken `{ getConnection }`
 *      behandlades som vanliga RedisOptions) → anslutningen gick mot
 *      127.0.0.1:6379 i alla lägen.
 *   2. ioredis default `enableOfflineQueue: true` → kommandon som skickades
 *      medan Redis var dött LIGGER i offline-kön i stället för att rejecta.
 *
 * Gaten verifierar att lager 2 är borta: med en död Redis ska importen
 * avsluta inom 60 s med exit 69 (EX_UNAVAILABLE) och en logg på under
 * 50 KB — inte hänga i två timmar.
 *
 * Negativ kontroll: samma kommando mot den LEVANDE Redis ska lyckas. Utan
 * den skulle gaten bara bevisa att "allt är rött".
 *
 * VARFÖR gaten pekar på EN källa (2026-10-28). Import-ledgern gör importen
 * idempotent: en källa med oförändrat innehåll hoppas över. Utan ledgern
 * importerades de tre första källorna; med ledgern importeras ingenting, och
 * gaten kan inte skilja "Redis svarar" från "det fanns inget att köa".
 * Därför väljs en källa som har events kvar att köa, och dess ledgerpost tas
 * bort före körningen. Ledgern skrivs om av importen i samma körning.
 *
 * Användning:
 *   node scripts/verify-failfast.mjs
 *   node scripts/verify-failfast.mjs --only=dead
 *   node scripts/verify-failfast.mjs --only=live
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { pickProducableSources } from './lib/extracted-events.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];

/** Död port — inget lyssnar där. */
const DEAD_REDIS_URL = 'redis://127.0.0.1:6399';

/** Gränser för gaten. */
const MAX_DURATION_MS = 60_000;
const MAX_LOG_BYTES = 50 * 1024;

/**
 * Kör importen och mät tid, exitkod och loggstorlek.
 *
 * @param {Record<string, string>} extraEnv
 * @param {string[]} extraArgs
 */
function runImport(extraEnv, extraArgs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(
      'npx',
      ['tsx', '03-Queue/importToEventPulse.ts', ...extraArgs],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (c) => { output += c.toString('utf8'); process.stdout.write(c); });
    child.stderr.on('data', (c) => { output += c.toString('utf8'); process.stderr.write(c); });
    child.on('exit', (code) => {
      resolve({
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        output,
        bytes: Buffer.byteLength(output, 'utf8'),
      });
    });
  });
}

/**
 * Välj en källa som gaten kan importera.
 *
 * Utan detta importerar gaten ingenting (ledgern hoppar över oförändrade
 * källor), och "exit 0" betyder bara "det fanns inget att köa" — inte
 * "Redis svarade". Importen körs med `--force --source <id>`, vilket
 * tvingar fram importen UTAN att röra ledgern.
 *
 * @returns {string | null}
 */
function prepareSource() {
  const candidates = pickProducableSources(Date.now());
  if (candidates.length === 0) return null;
  console.log(`  källa som importeras: ${candidates[0].sourceId} (${candidates[0].future} framtida events)`);
  return candidates[0].sourceId;
}

/** Del A — död Redis. Ska fälla snabbt, tydligt och med exit 69. */
async function deadRedisPass() {
  console.log('[verify-failfast] DEAD — importen pekas mot en död Redis');
  const sourceId = prepareSource();
  if (!sourceId) {
    console.error('  FAIL: ingen källa med framtida events hittades — gaten kan inte bevisa något');
    return false;
  }
  const r = await runImport({ REDIS_URL: DEAD_REDIS_URL }, ['--force', '--source', sourceId]);
  console.log(`\n  exit=${r.exitCode}  duration=${r.durationMs}ms  log=${(r.bytes / 1024).toFixed(1)} KB`);

  let ok = true;
  if (r.durationMs > MAX_DURATION_MS) {
    console.error(`  FAIL: tog ${r.durationMs}ms (> ${MAX_DURATION_MS}ms) — importen hänger igen`);
    ok = false;
  }
  if (r.bytes > MAX_LOG_BYTES) {
    console.error(`  FAIL: loggen är ${(r.bytes / 1024).toFixed(1)} KB (> ${MAX_LOG_BYTES / 1024} KB) — samma symtom som 2026-10-26`);
    ok = false;
  }
  if (r.exitCode !== 69) {
    console.error(`  FAIL: exit=${r.exitCode} (förväntat 69 = EX_UNAVAILABLE)`);
    ok = false;
  }
  if (!/transport/i.test(r.output)) {
    console.error('  FAIL: loggen innehåller inte "transport" — felet klassades inte som transportfel');
    ok = false;
  }
  if (ok) console.log('  OK: fel fälls snabbt, klassas och ger exit 69');
  return ok;
}

/** Del B — levande Redis. Samma kod ska fungera. */
async function liveRedisPass() {
  console.log('\n[verify-failfast] LIVE — importen mot den levande Redis');
  const sourceId = prepareSource();
  if (!sourceId) {
    console.error('  FAIL: ingen källa med framtida events hittades — gaten kan inte bevisa något');
    return false;
  }
  const r = await runImport({}, ['--force', '--source', sourceId]);
  console.log(`\n  exit=${r.exitCode}  duration=${r.durationMs}ms  log=${(r.bytes / 1024).toFixed(1)} KB`);

  let ok = true;
  if (r.exitCode === 69) {
    console.error('  FAIL: exit=69 mot en levande Redis — fail-fast kastar på falskt larm');
    ok = false;
  }
  const enqueued = Number(/(\d+)\s+events till bullmq/.exec(r.output)?.[1] ?? 0);
  if (enqueued === 0) {
    console.error('  FAIL: inga events köades — den levande vägen fungerar inte');
    ok = false;
  }
  if (ok) console.log(`  OK: ${enqueued} events köade utan fel`);
  return ok;
}

let ok = true;
if (!only || only === 'dead') ok = (await deadRedisPass()) && ok;
if (!only || only === 'live') ok = (await liveRedisPass()) && ok;

console.log(ok ? '\n[verify-failfast] GATE L2: GRÖN' : '\n[verify-failfast] GATE L2: RÖD');
process.exit(ok ? 0 : 1);
