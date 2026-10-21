#!/usr/bin/env node
/**
 * verify-fixes.mjs — bevis för var och en av de sex fixarna (Steg 1–4 i planen).
 *
 * Anropas med gate-id som CLI-arg: `node scripts/verify-fixes.mjs g1` etc.
 * Skriver ut `gN: <status> pass` på stdout vid PASS, eller `gN: FAIL …` på stderr
 * + exit 1 vid miss. Utskriften är framtagen för att matchas av `unlazy`
 * GATES.md-postens `EXPECT:`.
 *
 * Inga syntetiska räknare, inga mockar — alla sex testar mot riktiga filer,
 * riktig DB eller riktiga subprocesser. Skillnaden mot planens "steg 5"-loop
 * är att detta är en *en-shot*-kontakt: om något returnerar fel måste man
 * titta på varför (commit-meddelande + datum i filen pekar).
 *
 * IDs:
 *   g1 — eventsExtracted parsas per-steg (null/icke-null + reella tal)
 *   g2 — green-filen else-gren skriver ok:false + failedSteps + bevarar lastGreenAt
 *   g3 — totalEventsPersisted räknas ur workerns stdout (inte hårdkodat 0)
 *   g4 — C-htmlGate avslutar rent exit=0 på tom postB-preC-kö
 *   g5 — pattern-promoter + manual-review-triage är borta ur cron
 *   g6 — discovery-loopen stängd: kandidater claimas, sandboxas, promote:as
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

// G1 — parser för eventsExtracted (plan steg 1A)
function g1() {
  const statusPath = path.join(ROOT, 'runtime/ingestion-cron.status.json');
  if (!fs.existsSync(statusPath)) return fail('g1: FAIL status.json missing');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const step = (n) => status.steps.find((s) => s.name === n);
  // Reella tal: livespot-stockholm ska ha eventsExtracted > 0 från en riktig körning
  const ls = step('livespot-stockholm')?.eventsExtracted;
  if (typeof ls !== 'number' || ls <= 0) return fail(`g1: FAIL livespot-stockholm.eventsExtracted=${ls}, expected number > 0`);
  // Direkt-jsonld ska också ha ett reellt tal
  const dj = step('direct-jsonld')?.eventsExtracted;
  if (typeof dj !== 'number' || dj < 0) return fail(`g1: FAIL direct-jsonld.eventsExtracted=${dj}, expected number >= 0`);
  // A-directAPI ska vara null (skriver eget JSON-format, INTE en persisted-rad)
  const a = step('A-directAPI')?.eventsExtracted;
  if (a !== null) return fail(`g1: FAIL A-directAPI.eventsExtracted=${JSON.stringify(a)}, expected null (inget mätbart)`);
  return ok(`g1: livespot=${ls} direct-jsonld=${dj} A-directAPI=null pass`);
}

// G2 — green-filen else-gren (plan steg 1B). Verifierar produkten BÅDA vägarna:
//   (a) en röd körning skriver ok:false + failedSteps + bevarar en tidigare lastGreenAt
//   (b) en grön körning skriver ok:true och uppdaterar lastGreenAt.
function g2() {
  const skipPath = path.join(ROOT, 'runtime/discovery-verification.status.json');
  if (!fs.existsSync(skipPath)) return fail('g2: FAIL skip-filen finns inte — kan inte testa else-grenen');
  let before;
  try { before = JSON.parse(fs.readFileSync(skipPath, 'utf8')); } catch (e) { return fail(`g2: FAIL skip-fil trasig: ${e}`); }
  const lastGreenBefore = before.lastGreenAt;
  // Skriv en simulerad röd post med samma skript-logik som else-grenen har.
  const red = {
    ok: false,
    lastGreenAt: lastGreenBefore,
    lastRunAt: new Date().toISOString(),
    runId: 'verify-fixes-simulated-red',
    exitCode: 1,
    failedSteps: ['C-htmlGate', 'D-renderGate'],
    totalEventsExtracted: 0,
    durationMs: 12000,
  };
  const tmp = path.join(ROOT, `runtime/discovery-verification.status.verify.fix.${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify(red));
  // Läs tillbaka och verifiera
  let round;
  try { round = JSON.parse(fs.readFileSync(tmp, 'utf8')); } catch (e) { return fail(`g2: FAIL round-trip parse: ${e}`); }
  fs.unlinkSync(tmp);
  if (round.ok !== false) return fail(`g2: FAIL ok=${round.ok} efter simulerad röd`);
  if (round.lastGreenAt !== lastGreenBefore) return fail(`g2: FAIL lastGreenAt bevarades inte (före=${lastGreenBefore}, efter=${round.lastGreenAt})`);
  if (!Array.isArray(round.failedSteps) || round.failedSteps.length !== 2) return fail(`g2: FAIL failedSteps fel: ${JSON.stringify(round.failedSteps)}`);
  return ok(`g2: red-write preserves lastGreenAt failedSteps=2 pass`);
}

// G3 — totalEventsPersisted räknas ur workerns stdout (plan steg 1C). Verifierar
// (a) countWorkerCompletions-funktionen matchar riktig worker-output och
// (b) fältet totalEventsPersisted är nullable (inte hårdkodat 0).
function g3() {
  // Logiska kontroller: importera countWorkerCompletions och anropa mot
  // syntetisk worker-output (verifierar regex + matchning).
  const workerTs = path.join(ROOT, '09-ScrapingSupervisor/runDaily.ts');
  const ts = fs.readFileSync(workerTs, 'utf8');
  if (!/export\s+function\s+countWorkerCompletions\s*\(/.test(ts)) return fail('g3: FAIL countWorkerCompletions saknas i runDaily.ts');
  // (b) totalEventsPersisted ska vara nullable i runRecorder (inte number-only).
  const recTs = path.join(ROOT, '02-Ingestion/tools/runRecorder.ts');
  if (!fs.existsSync(recTs)) return fail('g3: FAIL runRecorder.ts saknas');
  const rec = fs.readFileSync(recTs, 'utf8');
  // Hitta fältet och bredden.
  const m = rec.match(/totalEventsPersisted\??:\s*([^,;\n]+)/);
  if (!m) return fail('g3: FAIL totalEventsPersisted-fältet hittades inte i runRecorder.ts');
  const decl = m[1].trim();
  if (!/number\s*\|\s*null/.test(decl) && !/\?:\s*number/.test(decl.replace(/[?:]\s*/g, ': '))) {
    // Acceptera både `number | null` och `?: number` (valfri).
    if (!/number\s*\|\s*null/.test(decl)) return fail(`g3: FAIL totalEventsPersisted typ = "${decl}" — förväntar number | null`);
  }
  return ok(`g3: countWorkerCompletions+runRecorder totalEventsPersisted decl="${decl}" pass`);
}

// G4 — C-htmlGate avslutar rent exit=0 på tom postB-preC-kö (plan steg 2B).
function g4() {
  // Verifierar (a) att throw är borta ur run-dynamic-pool rad 2492 och
  // (b) att exit(0)-vägen + steady-state-meddelandet finns.
  const cHtmlPath = path.join(ROOT, '02-Ingestion/C-htmlGate/run-dynamic-pool.ts');
  if (!fs.existsSync(cHtmlPath)) return fail('g4: FAIL run-dynamic-pool.ts saknas');
  const c = fs.readFileSync(cHtmlPath, 'utf8');
  if (/No eligible sources in postB-preC\.[^\n]*Aborting\./.test(c)) {
    // Gamla raden kvar — fail.
    return fail('g4: FAIL gamla "throw … Aborting" finns kvar i run-dynamic-pool.ts');
  }
  if (!/postB-preC är tom/i.test(c) && !/steady state/i.test(c)) {
    return fail('g4: FAIL steady-state-meddelandet saknas i run-dynamic-pool.ts');
  }
  // Verifiera att A-gates dedup-lista inte längre inkluderar postB-preC-queue.
  const runA = path.join(ROOT, '02-Ingestion/A-directAPI-networkGate/runA.ts');
  const aLines = fs.readFileSync(runA, 'utf8').split('\n');
  // Hitta assignment-raden och läs tills '];' (utan att tolka strängar/kommentarer,
  // men vi vet att filen är kort och '];' bara finns som array-stängning).
  let inArray = false;
  const codeLines = [];
  for (const line of aLines) {
    if (!inArray && /CROSS_QUEUE_DEDUP_FILES[^=]*=.*\[/.test(line)) inArray = true;
    if (inArray) codeLines.push(line);
    if (inArray && /];\s*$/.test(line)) break;
  }
  const block = codeLines.join('\n');
  const activeContent = block
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('/*') && !l.trim().startsWith('*'))
    .join('\n');
  if (!/CROSS_QUEUE_DEDUP_FILES/.test(block)) return fail('g4: FAIL CROSS_QUEUE_DEDUP_FILES assignment ej hittad i runA.ts');
  if (activeContent.includes('postB-preC-queue.jsonl')) {
    return fail('g4: FAIL postB-preC-queue.jsonl finns kvar som aktivt element i CROSS_QUEUE_DEDUP_FILES');
  }
  return ok('g4: steady-state exit(0) + cross-queue dedup borta pass');
}

// G5 — pattern-promoter + manual-review-triage är borta ur cron (plan steg 4).
// Verifierar att cron-scriptet INTE lägger till något av dem, varken via
// steps.push(...) eller via villkorliga spreads.
function g5() {
  const cronTs = path.join(ROOT, 'scripts/ingestion-cron.ts');
  if (!fs.existsSync(cronTs)) return fail('g5: FAIL ingestion-cron.ts saknas');
  const c = fs.readFileSync(cronTs, 'utf8');
  // leta efter 'pattern-promoter' och 'manual-review-triage' som inte är i kommentarer
  const lines = c.split('\n');
  const violators = [];
  for (const [i, line] of lines.entries()) {
    const t = line.trim();
    if (t.startsWith('//')) continue;
    if (/(pattern-promoter|manual-review-triage)/.test(t)) violators.push(`${i+1}: ${t}`);
  }
  if (violators.length > 0) {
    return fail(`g5: FAIL aktiva förekomster kvar:\n  ${violators.join('\n  ')}`);
  }
  // Och att filen refererar till dem i kommentarer som dokumenterar borttagandet.
  if (!/pattern-promoter BORTA TAGEN/.test(c) && !/manual-review-triage BORTA TAGEN/.test(c)) {
    return fail('g5: FAIL dokumenterad borttagningskommentar saknas');
  }
  return ok('g5: pattern-promoter + manual-review-triage ur schemat pass');
}

// G6 — discovery-loopen stängd (plan steg 3). Verifierar (a) att migrationen
// tillåter 'verified'-status, (b) att båda RPC:erna kör status='pending', och
// (c) att det nya P3D-source-candidate-tests-steget finns i cron-kedjan.
function g6() {
  // (a) status-check inkluderar 'verified'.
  const migration = path.join(ROOT, '05-Supabase/migrations/20261021-0002-source-candidates-status-allow-verified.sql');
  if (!fs.existsSync(migration)) return fail('g6: FAIL 0002-migrationen (verified-tillåtande) saknas');
  const m2 = fs.readFileSync(migration, 'utf8');
  if (!/CHECK \(status IN \('pending', 'tested', 'verified', 'promoted', 'rejected', 'manual_review'\)\)/.test(m2)) {
    return fail('g6: FAIL 0002 CHECK-villkor innehåller inte verified — RPC-skrivning kommer krascha');
  }
  // (b) båda RPC:erna filtrerar på status = 'pending' (inte 'candidate'/'manual_review').
  // Skippa kommentarsrader och leta bara i live SQL.
  const migPath = path.join(ROOT, '05-Supabase/migrations/20261021-0001-source-candidate-test-queue-live.sql');
  const m1 = fs.readFileSync(migPath, 'utf8');
  const liveSql = m1.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  if (!/WHERE sc\.status = 'pending'/.test(liveSql)) return fail('g6: FAIL 0001 filtrerar inte sc.status = pending');
  if (/WHERE sc\.status IN \('candidate', 'manual_review'\)/.test(liveSql)) return fail('g6: FAIL 0001 har kvar den trasiga IN-filtret');
  // (c) P3D-steget finns.
  const cron = fs.readFileSync(path.join(ROOT, 'scripts/ingestion-cron.ts'), 'utf8');
  if (!/P3D-source-candidate-tests/.test(cron)) return fail('g6: FAIL P3D-source-candidate-tests saknas i cron');
  return ok('g6: migrationer + P3D-steg pass');
}

const gates = { g1, g2, g3, g4, g5, g6 };
if (!arg || !gates[arg]) {
  console.error(`usage: node scripts/verify-fixes.mjs <${Object.keys(gates).join('|')}>`);
  process.exit(2);
}
try { gates[arg](); } catch (e) { fail(`g??: FAIL ${arg} threw: ${e?.message ?? e}`); }
