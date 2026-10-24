#!/usr/bin/env node
/**
 * verify-prekill.mjs — bevis för att pre-kill inte längre dödar en LEVANDE
 * kedjas arbete.
 *
 * Bakgrund (2026-10-24). `ingestion-cron.ts` städar bort discovery/ingest-
 * processer från en tidigare hängd körning (tribe-events hängde 76 h). Den
 * gamla logiken matchade bara cmdline-mönstret och dödade ALLT som matchade.
 * Den kunde inte se skillnaden mellan en zombie och ett barn av den kedja
 * som kör just nu.
 *
 * Felet slog till i verklighet, på nattkörningen:
 *   00:21:43  pre-kill-sigterm pid 28221 "node scripts/discover-subpaths.mjs"
 *             → nattkörningens subpath-discovery dog med exit=1, UTAN FATAL
 *               i stderr. Ingen kunde se varför: processen var SIGTERM:ad,
 *               inte trasig.
 *   00:21:57  pre-kill-sigterm pid 29799 "node scripts/ingest-direct-jsonld.mjs"
 *             → nattkörningens direct-jsonld dog med exit=1.
 * Båda signalerna kom från en verifierings-gate som startade
 * `ingestion-cron.ts --only direct-jsonld` parallellt med nattkörningen.
 *
 * Fixen (scripts/lib/chain-guard.mjs): innan något döds kontrolleras
 * processens ANCESTOR. Har den en levande ingestion-kedja som förfader är den
 * levande arbete och lämnas i fred. Zombies från en död kedja har ingen
 * levande förfader och döds fortfarande.
 *
 * Gates:
 *   pk1 — negativ kontroll: en process UTAN levande kedje-förfader döds
 *         fortfarande. Utan den skulle pk2 bara mäta "inget hände".
 *   pk2 — positiv kontroll: ett barn till en LEVANDE kedja överlever.
 *
 * Testet kör mot RIKTIGA processer och RIKTIGA signaler — ingen mock. En
 * falsk kedja byggs i en temp-mapp: dess cmdline matchar kedjemönstret, den
 * startar ett "ingest"-barn som matchar discovery-mönstret.
 *
 * Anropas som `node scripts/verify-prekill.mjs <pk1|pk2>`.
 * Skriver ut `pkN: <status> pass` på stdout vid PASS, annars `pkN: FAIL …`
 * på stderr + exit 1. Utskriften matchas av GATES.md:s `EXPECT:`.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  killLivingDiscoveryProcesses,
  liveChainPids,
  ancestorPids,
  listProcesses,
} from './lib/chain-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

const SLEEP_MS = 600_000; // 10 min — långt nog attprocessen inte dör av sig själv
const TMP = mkdtempSync(path.join(os.tmpdir(), 'ep-prekill-'));

/** Skriv en fil som sover länge. */
function writeSleeper(file, label) {
  writeFileSync(
    file,
    `console.log(${JSON.stringify(label)} + ' pid=' + process.pid);\n` +
    `setTimeout(() => process.exit(0), ${SLEEP_MS});\n`,
    'utf8',
  );
}

/** Starta en process och vänta tills den skrivit sin pid på stdout. */
function startSleeper(file, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`${label} startade inte`)), 15_000);
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/pid=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, pid: parseInt(m[1], 10) });
      }
    });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Lever processen? */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bygg en falsk kedja i temp-mappen: en "kedja" vars cmdline matchar
 * kedjemönstret, som startar ett "ingest"-barn som matchar discovery-mönstret.
 * Returnerar {chainPid, childPid, tmpDir}.
 */
async function buildFakeChain() {
  const dir = path.join(TMP, 'chain');
  const scriptsDir = path.join(dir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  const chainFile = path.join(scriptsDir, 'ingestion-cron.ts');
  const childFile = path.join(scriptsDir, 'ingest-fakechild.mjs');

  writeSleeper(childFile, 'child');

  // Kedjan startar barnet och skriver ut bådas pid.
  writeFileSync(
    chainFile,
    `import { spawn } from 'node:child_process';\n` +
    `const child = spawn('node', ${JSON.stringify(childFile)}, { stdio: ['ignore', 'pipe', 'pipe'] });\n` +
    `child.stdout.on('data', (d) => process.stdout.write(d));\n` +
    `console.log('chain pid=' + process.pid);\n` +
    `setTimeout(() => process.exit(0), ${SLEEP_MS});\n`,
    'utf8',
  );

  const chain = await startSleeper(chainFile, 'chain');
  return { chainPid: chain.pid, childPid: null, dir };
}

/** Hitta barnet till kedjan: den enda processen vars cmdline är ingest-fakechild. */
function findFakeChild() {
  const row = listProcesses().find((p) => p.cmdline.includes('ingest-fakechild.mjs'));
  return row ? row.pid : null;
}

/** Städa bort temp-mappen och alla processer i den. */
function cleanup(pids) {
  for (const pid of pids) {
    if (!pid) continue;
    try { process.kill(pid, 'SIGKILL'); } catch { /* redan död */ }
  }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignoreras */ }
}

/**
 * Kör pre-kill-funktionen mot en uppsättning processer och returnera
 * vad som dödes respektive skippades.
 */
async function runPrekill() {
  const events = [];
  const res = await killLivingDiscoveryProcesses({
    selfPid: process.pid,
    graceMs: 1500,
    onEvent: (e) => events.push(e),
  });
  return { ...res, events };
}

// ── PK0: negativ kontroll — cmdline-parsningen får inte klippa ───────────
//
// Varför (2026-10-24). `listProcesses()` använde `split(/\s+/, 12)`. Med en
// regex som separator behåller `split` INTE resten av strängen — den ger
// bara de 12 första fälten. Varje cmdline klipptes till två ord
// ("…/node --require"), så `scripts/ingestion-cron.ts` fanns aldrig i
// texten och CHAIN_PATTERN matchade aldrig.
//
// Följden var värre än ett trasigt parses:
//   • liveChainPids() returnerade ALLTID [] → varje verifierings-gate
//     startade sitt steg parallellt med nattkörningen,
//   • chainPids var tomt → pre-kill dödade kedjans egna barn.
// Båda var exakt de fel som skadade nattkörningen 2026-10-24.
//
// Gaten startar en falsk kedje med en MARKÖR långt inne i cmdlinen och
// kräver att både den fulla cmdlinen och kedjepid:n syns. Med den gamla
// parsningen faller den — av sig själv, utan mock.

if (arg === 'pk0') {
  const dir = path.join(TMP, 'parser');
  const scriptsDir = path.join(dir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  const chainFile = path.join(scriptsDir, 'ingestion-cron.ts');
  const MARKER = 'EP_MARKER_9f3a7c';
  writeSleeper(chainFile, 'parser-chain');

  const fake = await startSleeper(chainFile, 'parser-chain');
  try {
    const row = listProcesses().find((p) => p.pid === fake.pid);
    if (!row) {
      fail(`pk0: den falska kedjan (pid ${fake.pid}) syns inte i listProcesses() — parsningen hittar inte processen`);
    }
    if (!row.cmdline.includes(chainFile)) {
      fail(
        `pk0: cmdlinen är avklippt — den innehåller inte sökvägen "${chainFile}".\n` +
        `     Fick: ${row.cmdline}\n` +
        '     Detta är felet som gjorde liveChainPids() alltid tom.',
      );
    }
    if (!row.cmdline.trim().endsWith(chainFile)) {
      fail(
        `pk0: cmdlinen slutar inte med hela sökvägen — den är avklippt.\n` +
        `     Förväntade slut: ${chainFile}\n` +
        `     Fick: ${row.cmdline}`,
      );
    }
    if (row.cmdline.split(' ').length < 2) {
      fail(`pk0: cmdlinen har bara ett ord — den är avklippt: ${row.cmdline}`);
    }
    const chains = liveChainPids();
    if (!chains.includes(fake.pid)) {
      fail(
        `pk0: liveChainPids() hittade inte den falska kedjan (pid ${fake.pid}) — ` +
        `den hittade ${JSON.stringify(chains)}. Kedjemönstret matchar aldrig en avklippt cmdline.`,
      );
    }
    ok(`pk0: full cmdline läst (${row.cmdline.length} tecken) och den falska kedjan hittades av liveChainPids() — parsningen klipper inte pass`);
  } finally {
    cleanup([fake.pid]);
  }
}

// ── PK1: negativ kontroll — en orphan döds fortfarande ──────────────────────

if (arg === 'pk1') {
  const chains = liveChainPids();
  if (chains.length > 0) {
    fail(`pk1: en ingestion-kedja kör (pid ${chains.join(', ')}) — kör gaten när ingen produktionskörning är igång`);
  }

  const orphanFile = path.join(TMP, 'orphan', 'scripts', 'ingest-orphan.mjs');
  mkdirSync(path.dirname(orphanFile), { recursive: true });
  writeSleeper(orphanFile, 'orphan');
  const orphan = await startSleeper(orphanFile, 'orphan');

  try {
    // Vakuumkontroll: orphanen får INTE ha en levande kedje som förfader,
    // annars mäter gaten ingenting.
    const ancestors = ancestorPids(orphan.pid);
    const owner = ancestors.find((a) => chains.includes(a));
    if (owner !== undefined) {
      fail(`pk1: orphanen har kedje-förfader ${owner} — testet är vakuum`);
    }

    const r = await runPrekill();

    if (!r.killed.includes(orphan.pid)) {
      fail(
        `pk1: orphanen (pid ${orphan.pid}) dödades inte — pre-kill har slutat ` +
        `städa zombies. Dödade: ${JSON.stringify(r.killed)}`,
      );
    }
    if (isAlive(orphan.pid)) {
      fail(`pk1: orphanen (pid ${orphan.pid}) lever kvar efter SIGTERM+SIGKILL`);
    }
    ok(`pk1: orphan utan levande kedje-förfader dödades (pid ${orphan.pid}) — städningen fungerar fortfarande pass`);
  } finally {
    cleanup([orphan.pid]);
  }
}

// ── PK2: positiv kontroll — ett barn till en levande kedja överlever ──────

if (arg === 'pk2') {
  const chains = liveChainPids();
  if (chains.length > 0) {
    fail(`pk2: en ingestion-kedja kör (pid ${chains.join(', ')}) — kör gaten när ingen produktionskörning är igång`);
  }

  const fake = await buildFakeChain();
  let childPid = null;
  try {
    // Vänta tills barnet syns.
    for (let i = 0; i < 40 && childPid === null; i++) {
      childPid = findFakeChild();
      if (childPid === null) await new Promise((r) => setTimeout(r, 250));
    }
    if (childPid === null) fail('pk2: det falska barnet startade aldrig');

    // Vakuumkontroll: barnet MÅSTE ha den falska kedjan som förfader.
    const ancestors = ancestorPids(childPid);
    if (!ancestors.includes(fake.chainPid)) {
      fail(`pk2: barnets förfader ${JSON.stringify(ancestors)} innehåller inte kedjan ${fake.chainPid} — testet är vakuum`);
    }

    const r = await runPrekill();

    if (r.skipped.includes(childPid)) {
      ok(`pk2: barn till levande kedja (pid ${childPid}) skippades av pre-kill — kedjans pågående steg lever vidare pass`);
    } else {
      fail(
        `pk2: barnet (pid ${childPid}) dödades trots att dess förfader ${fake.chainPid} är en levande kedja — ` +
        `dödade: ${JSON.stringify(r.killed)}. Det är exakt felet som dödade nattkörningens subpath-discovery.`,
      );
    }
    if (!isAlive(childPid)) {
      fail(`pk2: barnet (pid ${childPid}) lever inte — pre-kill rörde det ändå`);
    }
    // Kedjan själv ska också ha fått stå kvar.
    if (!isAlive(fake.chainPid)) {
      fail(`pk2: den falska kedjan (pid ${fake.chainPid}) dödades — pre-kill ska inte röda kedjor`);
    }
  } finally {
    cleanup([childPid, fake.chainPid]);
  }
}

if (!['pk0', 'pk1', 'pk2'].includes(arg)) {
  fail('usage: node scripts/verify-prekill.mjs <pk0|pk1|pk2>');
}
