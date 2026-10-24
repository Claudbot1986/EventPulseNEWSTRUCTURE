#!/usr/bin/env node
/**
 * verify-e4-order.mjs — negativ kontroll av e4-gaten.
 *
 * Bakgrund (2026-10-24). E4-gaten ("discovery→ingestion går igenom på EN
 * körning") mäter om P3D kördes FÖRE A-gatet i samma kedja. Gaten var FEL
 * definierad: den tog "sista körningen" i chain-overview.log, vilket numera
 * kan vara en `--only <steg>`-körning från en verifierings-gate — en
 * körning som varken har P3D eller A. Gaten mätte alltså fel sak.
 *
 * Nu väljer gaten den senaste körning som har BÅDE P3D och A. Men en gata
 * som bara kan ge grönt är inte ett bevis. Den här gaten bevisar att e4
 * FALLER på en logg där P3D kom efter A.
 *
 * Gates:
 *   e1 — negativ kontroll: en syntetisk chain-overview.log där P3D avslutas
 *        EFTER A måste få e4 att faila. Utan den vore "pass" betydningslöst.
 *
 * Anropas som `node scripts/verify-e4-order.mjs e1`.
 * Skriver ut `e1: <status> pass` på stdout vid PASS, annars `e1: FAIL …`
 * på stderr + exit 1. Utskriften matchas av GATES.md:s `EXPECT:`.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

/**
 * Bygg en syntetisk chain-overview-log med EN körning där stegen avslutas i
 * given ordning.
 * @param {string[]} stepOrder
 */
function buildSyntheticLog(stepOrder) {
  const pid = 999001;
  const rows = [{ ts: '2026-10-24T00:00:00.000Z', event: 'step-start', step: stepOrder[0], pid }];
  let t = 0;
  for (const step of stepOrder) {
    t += 1000;
    rows.push({ ts: new Date(Date.parse('2026-10-24T00:00:00.000Z') + t).toISOString(), event: 'step-end', step, pid, exitCode: 0, durationMs: 1000, eventsExtracted: null, timedOut: false });
  }
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/**
 * Kör e4-gaten mot en given loggfil och returnera exitkod + output.
 * @param {string} logFile
 */
function runE4(logFile) {
  const res = spawnSync('node', [path.join(ROOT, 'scripts/verify-fixes.mjs'), 'e4'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, E4_CHAIN_LOG: logFile },
  });
  return {
    exitCode: res.status,
    output: `${res.stdout || ''}${res.stderr || ''}`.trim(),
  };
}

// ── E1: negativ kontroll — fel ordning måste faila ─────────────────────────

if (arg === 'e1') {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ep-e4-'));
  try {
    // P3D EFTER A — det gamla läget, före splice-fixen.
    const wrong = path.join(tmp, 'wrong-order.jsonl');
    writeFileSync(wrong, buildSyntheticLog(['A-directAPI', 'P3D-source-candidate-tests']), 'utf8');
    const rWrong = runE4(wrong);

    if (rWrong.exitCode === 0) {
      fail(`e1: e4 PASSADE på en logg där P3D kom efter A — gaten mäter ingenting\n${rWrong.output}`);
    }
    if (!/ordning|P3D/.test(rWrong.output)) {
      fail(`e1: e4 failade av fel skäl på fel-ordning-loggen: ${rWrong.output}`);
    }

    // Kontroll: rätt ordning med samma syntetiska form måste gå vidare förbi
    // ordningsgranskningen (den får faila senare, på "inga nya källfiler" —
    // men INTE på ordningen). Det bevisar att skillnaden är just ordningen.
    const right = path.join(tmp, 'right-order.jsonl');
    writeFileSync(right, buildSyntheticLog(['P3D-source-candidate-tests', 'A-directAPI']), 'utf8');
    const rRight = runE4(right);

    if (/ordning=P3D|P3D avslutades EFTER A/.test(rRight.output)) {
      fail(`e1: e4 failade på ORDNINGEN även när P3D kom först — ordningskontrollen är trasig\n${rRight.output}`);
    }
    ok(`e1: e4 faller när P3D kommer efter A (exit=${rWrong.exitCode}) och passerar ordningsgranskningen när P3D kommer först — gaten kan faila pass`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (arg !== 'e1') {
  fail('usage: node scripts/verify-e4-order.mjs e1');
}
