#!/usr/bin/env node
/**
 * verify-preflight.mjs — GATE L1: preflight fångar nätverksfel under 30 s.
 *
 * Bevisar två saker:
 *   1. I den levande världen svarar alla hårda kontroller grönt.
 *   2. Med nätet simulerat trasigt faller preflight (exit 69) inom 30 s —
 *      dvs. kedjan skulle ha stoppats i stället för att hänga i två timmar.
 *
 * (2) görs genom att peka om REDIS_URL/SUPABASE_URL mot en död port, vilket
 * är den exakta felbilden vi sett: EADDRNOTAVAIL utan någon HTTP-status.
 *
 * Användning:
 *   node scripts/verify-preflight.mjs                     # båda delarna
 *   node scripts/verify-preflight.mjs --simulate-network-down
 *   node scripts/verify-preflight.mjs --only live
 */

import { runPreflight } from './lib/preflight.mjs';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];

const DEAD_URL = 'redis://127.0.0.1:6399';
const DEAD_SUPABASE = 'http://127.0.0.1:6399';

function printChecks(label, result) {
  console.log(`\n── ${label} ──`);
  for (const check of result.checks) {
    const mark = check.ok ? 'OK  ' : 'FAIL';
    const blocking = check.blocking ? 'hard ' : 'soft ';
    console.log(`  [${mark}] ${blocking}${check.name.padEnd(15)} ${String(check.ms).padStart(5)}ms  ${check.detail}`);
  }
  console.log(
    `  → failed=${result.failed.length ? result.failed.join(',') : 'none'} degraded=${result.degraded.length ? result.degraded.join(',') : 'none'} (${result.durationMs}ms)`,
  );
}

async function livePass() {
  console.log('[verify-preflight] LIVE — alla hårda kontroller mot den levande världen');
  const result = await runPreflight({});
  printChecks('live', result);
  if (!result.ok) {
    console.error(`\n[verify-preflight] FAIL: hårda kontroller misslyckades: ${result.failed.join(', ')}`);
    return false;
  }
  console.log('[verify-preflight] OK: världen är körbar');
  return true;
}

async function simulateNetworkDown() {
  console.log('[verify-preflight] SIMULATE — nätet pekas mot död port');
  const t0 = Date.now();
  const result = await runPreflight({
    env: {
      ...process.env,
      REDIS_URL: DEAD_URL,
      SUPABASE_URL: DEAD_SUPABASE,
    },
  });
  const elapsed = Date.now() - t0;
  printChecks('simulate', result);
  if (result.ok) {
    console.error('\n[verify-preflight] FAIL: preflight sade OK fast världen är trasig');
    return false;
  }
  if (elapsed > 30_000) {
    console.error(`\n[verify-preflight] FAIL: preflight tog ${elapsed}ms (> 30s) — kedjan skulle ha hängt`);
    return false;
  }
  console.log(`[verify-preflight] OK: trasig värld upptäckt på ${elapsed}ms, failed=${result.failed.join(', ')}`);
  return true;
}

let ok = true;
if (!only || only === 'live') ok = (await livePass()) && ok;
if (!only || only === 'simulate') ok = (await simulateNetworkDown()) && ok;

console.log(ok ? '\n[verify-preflight] GATE L1: GRÖN' : '\n[verify-preflight] GATE L1: RÖD');
process.exit(ok ? 0 : 1);
