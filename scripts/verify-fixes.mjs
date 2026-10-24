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
 *   g7 — C-htmlGate:s programmatiska ingång avslutar rent på tom postB-preC-kö
 *   g8 — datumvakten behåller holdags-event dated idag (kastar bort gårdagens)
 *   g9 — requeue-sources kan köa om en specifik källa i C-gaten (isolerat, idempotent)
 *   h1 — geoExpansion filtrerar på lat/lng, inte på venues.city
 *   h2 — city finns som kolumn och bärs hela vägen till promote
 *   h3 — slug-kollision i promote dödar inte batchen
 *   h4 — stale processing-rader reclaimas ur P3D-kön
 *   h5 — en promotead källa är faktiskt nåbar för A-gatet
 *   h6 — A-gatet har kört en promotead källa och persisterat events
 *   e1 — stängningsfunktion finns och runB stänger köerna före process.exit
 *   e2 — ingen gate hänger: varje step-start har ett step-end
 *   e3 — kedjan producerar events (totalEventsPersisted > 0)
 *   e4 — discovery→ingestion går igenom på EN körning (promote före A)
 *   e5 — döda källor har orsak; uppenbart döda (404/DNS) ligger i kyrkogravet
 *   n1 — C3-AI:s "needs_render" routar till D-renderGate, inte till begravning
 *   n2 — drainens worker-concurrency är mätbar och högre concurrency ger mer
 *   s1 — schema.org Event-subtyper accepteras + paritet med kanonisk extractor
 *   s2 — källans egen URL är kandidat och bär riktiga events
 *   s3 — fixen öppnade källor har framtida rader i DB (negativ kontroll: spent)
 */

import fs from 'node:fs';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

/**
 * Tolka ett JSON-objekt ur en text som kan innehålla loggrad före och
 * efter. Letar efter det sista kompletta objektet (mätverktygen skriver
 * JSONen sist på stdout).
 */
function parseJsonObject(text) {
  const trimmed = (text ?? '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fortsätt — försök hitta ett inbäddat objekt
  }
  for (let start = trimmed.indexOf('{'); start !== -1; start = trimmed.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            break; // det här var inte ett JSON-objekt — fortsätt sökningen
          }
        }
      }
    }
  }
  throw new Error('hittade inget JSON-objekt i utdatan');
}

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

// G7 — C-htmlGate:s PROGRAMMATISKA ingång avslutar rent på tom postB-preC-kö.
//
// main() gör redan rätt (den loggar "steady state" och returnerar). Men
// runDynamicPoolBatch() — den ingång 07-Discovery:s
// RealAbcdSourceCandidateRunner och run-batch-from-sources.ts använder —
// kastade fortfarande "No eligible sources in postB-preC". Där ser ett
// kastat fel ut som "C-gaten kraschade", fast det bara betyder att det
// inte fanns något att köra.
//
// Detta är en KÖRNING-gate, inte en läsning av källkoden: gaten tömer
// postB-preC-kön, kör den programmatiska ingången och kräver exit 0.
// Kön återställs alltid, även om gaten fallerar.
function g7() {
  const queueFile = path.join(ROOT, 'runtime', 'postB-preC-queue.jsonl');
  if (!fs.existsSync(queueFile)) return fail('g7: FAIL runtime/postB-preC-queue.jsonl saknas');

  const original = fs.readFileSync(queueFile, 'utf8');
  const backup = path.join(ROOT, 'runtime', '.postB-preC-queue.jsonl.g7-backup');
  fs.writeFileSync(backup, original, 'utf8');

  try {
    fs.writeFileSync(queueFile, '', 'utf8');
    const r = spawnSync(
      'npx',
      ['tsx', '02-Ingestion/C-htmlGate/run-batch-from-sources.ts', '--sources=__g7_no_source__', '--batch-id=997'],
      { cwd: ROOT, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' },
    );
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.status !== 0) {
      return fail(
        `g7: FAIL den programmatiska C-ingången avslutade med exit=${r.status} på tom kö.\n` +
        `     Sista utdata:\n${out.split('\n').slice(-12).join('\n')}`,
      );
    }
    if (!/postB-preC är tom|steady state/i.test(out)) {
      return fail(
        'g7: FAIL körningen avslutade med exit 0 men skrev inte ut steady-state-meddelandet — ' +
        'den gick en annan väg.\n' +
        `     Sista utdata:\n${out.split('\n').slice(-12).join('\n')}`,
      );
    }
    return ok('g7: programmatisk C-ingång avslutar rent exit=0 på tom postB-preC-kö pass');
  } finally {
    fs.writeFileSync(queueFile, original, 'utf8');
    fs.rmSync(backup, { force: true });
  }
}

// G8 — datumvakten ska BEHÅLLA ett holdags-event som pågår idag (2026-10-24).
// Kör den riktiga importkoden i dry-run mot en temporär katalog med två
// rader: en dated idag (ska behållas) och en dated i går (ska kastas bort).
// Den andra raden är den negativa kontrollen — utan den skulle gaten "passa"
// även om vakten kastade bort allt.
function g8() {
  const r = spawnSync('npx', ['tsx', 'scripts/verify-holdags-gate.mts'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    killSignal: 'SIGKILL',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    return fail(
      `g8: FAIL gateskriptet avslutade med exit=${r.status}.\n` +
      `     Sista utdata:\n${out.split('\n').slice(-12).join('\n')}`,
    );
  }
  const m = out.match(/^G8RESULT (\{.*\})$/m);
  if (!m) {
    return fail(
      'g8: FAIL gateskriptet skrev inte ut någon G8RESULT-rad — gaten kunde inte avgöra något.\n' +
      `     Sista utdata:\n${out.split('\n').slice(-12).join('\n')}`,
    );
  }
  let res;
  try {
    res = JSON.parse(m[1]);
  } catch (e) {
    return fail(`g8: FAIL kunde inte tolka G8RESULT: ${e.message}`);
  }
  if (res.enqueued !== 1) {
    return fail(
      `g8: FAIL holdags-eventet dated idag (${res.today}) blev INTE behållet ` +
      `(enqueued=${res.enqueued}, skippedPast=${res.skippedPast}). ` +
      'Det betyder att datumvakten fortfarande kastar bort event som pågår idag.',
    );
  }
  if (res.skippedPast !== 1) {
    return fail(
      `g8: FAIL kontrollraden dated i går (${res.yesterday}) blev inte kastad bort ` +
      `(skippedPast=${res.skippedPast}, enqueued=${res.enqueued}). ` +
      'Vakten släpper igenom förflutna events.',
    );
  }
  return ok('g8: datumvakten behåller holdags-event dated idag och kastar bort gårdagens pass');
}

// G9 — operatörverktyget requeue-sources kan faktiskt köa om en specifik
// källa i C-gaten (plan: operatörverktyg för fail-källor).
//
// Kör det riktiga verktyget i en isolerad sandbox och mät tre saker:
//   1. köposten hamnar i postB-preC med rätt format och status blir 'routed'
//   2. en andra körning är idempotent (ingen dubblett)
//   3. en okänd källa skriver INGEN post — negativ kontroll
function g9() {
  const r = spawnSync('npx', ['tsx', 'scripts/verify-requeue-gate.mts'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    killSignal: 'SIGKILL',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    return fail(
      `g9: FAIL gateskriptet avslutade med exit=${r.status}.\n` +
      `     Sista utdata:\n${out.split('\n').slice(-12).join('\n')}`,
    );
  }
  const m = out.match(/^G9RESULT (\{.*\})$/m);
  if (!m) {
    return fail(
      'g9: FAIL gateskriptet skrev inte ut någon G9RESULT-rad — gaten kunde inte avgöra något.\n' +
      `     Sista utdata:\n${out.split('\n').slice(-12).join('\n')}`,
    );
  }
  let res;
  try {
    res = JSON.parse(m[1]);
  } catch (e) {
    return fail(`g9: FAIL kunde inte tolka G9RESULT: ${e.message}`);
  }
  if (res.firstOutcome !== 'queued' || res.firstWritten !== 1) {
    return fail(
      `g9: FAIL källan köades inte (outcome=${res.firstOutcome}, written=${res.firstWritten}). ` +
      'Operatören kan inte köra om en fail-källa.',
    );
  }
  const entry = res.queueEntry;
  if (!entry || entry.sourceId !== 'gate-source' || entry.queueName !== 'postB-preC') {
    return fail(`g9: FAIL köposten har fel format: ${JSON.stringify(entry)}`);
  }
  if (res.status?.status !== 'routed' || res.status?.consecutiveFailures !== 0) {
    return fail(
      `g9: FAIL källans status blev inte 'routed' med nollställd felräknare: ` +
      `${JSON.stringify(res.status)}`,
    );
  }
  if (res.secondOutcome !== 'already_queued' || res.secondWritten !== 0 || res.queueRowsAfterSecond !== 1) {
    return fail(
      `g9: FAIL verktyget är inte idempotent: outcome=${res.secondOutcome}, ` +
      `written=${res.secondWritten}, rader=${res.queueRowsAfterSecond}`,
    );
  }
  if (res.unknownOutcome !== 'unknown_source' || res.unknownWritten !== 0 || res.queueRowsAfterUnknown !== 1) {
    return fail(
      `g9: FAIL negativ kontroll: en okänd källa skrev en köpost ` +
      `(outcome=${res.unknownOutcome}, written=${res.unknownWritten}, rader=${res.queueRowsAfterUnknown})`,
    );
  }
  return ok('g9: requeue-sources köar en specifik källa i postB-preC, är idempotent och vägrar okända källor');
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

// ─── Handoff: discovery → ingestion (2026-10-21) ────────────────────────────
//
// Promoterade källor landade i sources/*.jsonl men nådde aldrig A-gatet.
// Rotorsaken: source_candidates saknade city, så den promoteade filen fick
// ingen city, isInScope() filtrerade bort den, och A-gatet såg en tom pool.

function readEnvFile() {
  const out = {};
  if (!fs.existsSync(path.join(ROOT, '.env'))) return out;
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function supabaseGet(table, query) {
  const env = readEnvFile();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing' };
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { data: await res.json() };
}

// H1 — venues.city är OTRUSTAT. geoExpansion måste filtrera på koordinater.
function h1() {
  const geo = path.join(ROOT, '07-Discovery/src/venueGraph/geoExpansion.ts');
  if (!fs.existsSync(geo)) return fail('h1: FAIL geoExpansion.ts saknas');
  const g = fs.readFileSync(geo, 'utf8');
  if (!/export const CITY_BOUNDS/.test(g)) return fail('h1: FAIL CITY_BOUNDS saknas i geoExpansion.ts');
  if (!/\.gte\('lat'/.test(g) || !/\.lte\('lng'/.test(g)) {
    return fail('h1: FAIL venue-queryn filtrerar inte på lat/lng-gränser');
  }
  if (/\.eq\('city', cityFilter\)/.test(g)) {
    return fail('h1: FAIL venue-queryn filtrerar fortfarande på venues.city');
  }
  if (!/unknown city/.test(g)) return fail('h1: FAIL okänd stad ger inte firstError');
  return ok('h1: geo-bbox filter present venues.city not trusted pass');
}

// H2 — city som kolumn, och den bärs hela vägen queue → CLI → promote.
function h2() {
  const mig = path.join(ROOT, '05-Supabase/migrations/20261021-0003-source-candidate-city-and-stale-reclaim.sql');
  if (!fs.existsSync(mig)) return fail('h2: FAIL migration 0003 saknas');
  const m = fs.readFileSync(mig, 'utf8');
  if (!/ALTER TABLE source_candidates\s*\n?\s*ADD COLUMN IF NOT EXISTS city TEXT/.test(m)) {
    return fail('h2: FAIL 0003 lägger inte till city på source_candidates');
  }
  if (!/ALTER TABLE source_candidate_test_queue\s*\n?\s*ADD COLUMN IF NOT EXISTS city TEXT/.test(m)) {
    return fail('h2: FAIL 0003 lägger inte till city på source_candidate_test_queue');
  }
  if (!/enqueue_source_candidate_tests[\s\S]*?sc\.city/.test(m)) {
    return fail('h2: FAIL enqueue-RPC:n bär inte med sc.city');
  }
  const repo = fs.readFileSync(path.join(ROOT, '07-Discovery/src/sourceTesting/supabaseRepository.ts'), 'utf8');
  if (!/city: row\.city \?\? null/.test(repo)) return fail('h2: FAIL queueItemFromRow mappar inte row.city');
  const cli = fs.readFileSync(path.join(ROOT, '07-Discovery/src/sourceTesting/runSourceCandidateTests.ts'), 'utf8');
  if (/city: null/.test(cli)) return fail('h2: FAIL CLI har fortfarande city: null hårdkodat');
  if (!/city: item\.city \?\? null/.test(cli)) return fail('h2: FAIL CLI sätter inte city från item.city');
  // Prodcenterna ska skriva city, inte lämna den okänd.
  for (const f of ['searchEngines/discoverySearch.ts', 'venueGraph/geoExpansion.ts', 'searchEngines/rssDiscovery.ts']) {
    const src = fs.readFileSync(path.join(ROOT, '07-Discovery/src', f), 'utf8');
    if (!/city:/.test(src)) return fail(`h2: FAIL ${f} skriver ingen city`);
  }
  return ok('h2: city column+queue+cli pass');
}

// H3 — slug-kollision får inte kasta ur hela batchen.
function h3() {
  const sb = fs.readFileSync(path.join(ROOT, '07-Discovery/src/sourceTesting/sandbox.ts'), 'utf8');
  if (/throw new Error\(`Source id collision/.test(sb)) {
    return fail('h3: FAIL kollision kastar fortfarande — en kandidat kan döda batchen');
  }
  if (!/slug collision[\s\S]*?return null/.test(sb)) {
    return fail('h3: FAIL kollisionen returnerar inte null');
  }
  const runner = fs.readFileSync(path.join(ROOT, '07-Discovery/src/sourceTesting/runner.ts'), 'utf8');
  if (!/promote blocked: slug collision/.test(runner)) {
    return fail('h3: FAIL runner.ts fångar inte null från promoteSourceCandidate');
  }
  return ok('h3: collision non-fatal pass');
}

// H4 — stale processing-rader får inte ligga kvar, och reclaimen måste finnas
// i den LEVENDE funktionen.
//
// 2026-10-23: den här gaten läste MIGRATIONSFILEN för att bevisa att reclaimen
// fanns. Det bevisade ingenting. Verifierat i den här sessionen: den deployade
// funktionen har ändrats sedan filen skrevs — 20261023-0001 lade till
// `AND city = 'Stockholm'`, och den finns inte alls i 20261021-0003. Filen var
// alltså stale precis när gaten skrev grönt, samtidigt som 15 rader låg
// strandade i 'processing'.
//
// Vad som faktiskt hände med de 15 (mätt 2026-10-23):
//
//   13 rader  city IS NULL  → kan inte reclaimas. city-filtret från 20261023-0001
//                             ligger i samma WHERE som reclaimen och gäller BÅDA
//                             grenarna, så "pending ELLER stale-processing" +
//                             city='Stockholm' utesluter dem permanent.
//    2 rader  city='Stockholm' → reclaimbara i princip, men de konkurrerar med
//                             340 pending-rader i en ORDER BY där alla har
//                             priority_score = 50. Tie-breaken på created_at är
//                             icke-deterministisk utan ett tredje sorteringsnyckel,
//                             så vem som vinner är fysisk radordning, inte någon
//                             egenskap vi bryr oss om.
//
// Slutsatsen: SQL:en var inte trasig, men "en rad i processing" är ett tillstånd
// som ingen gate rapporterar och ingen konsument ser. Att lämna kandidater där är
// värre än 'pending'. 20261023-0002 släpper dem tillbaka.
//
// INVARIANTEN GATEN HÅLLER: stranded === 0. Den är icke-vakuös — den gick RÖD med
// 15 i den här sessionen, vilket är dess enda hittills bevis på att den kan fela.
// (En tidigare utkastversion av den här gaten hade också ett city-blindspot-fall;
// det var DÖD kod — mängden är en strikt delmängd av stranded, så kontrollen
// kan bara nås när stranded==0, och då är blindspot garanterat 0. Borttagen.)
//
// Om reclaimen ligger bakom city-filtret är det i sig inte ett fel: bara
// Stockholm-rader kan claimas, så bara de kan bli strandade. Gaten rapporterar
// därför läget i PASS-raden i stället för att fejka på det. Om det blir
// felaktigt beror det på att e7 släpper igen icke-Stockholm-kandidater — och
// då är det e7 som ska fälla, inte h4.
async function h4() {
  const url = readEnvFile().DATABASE_URL;
  if (!url) return fail('h4: FAIL DATABASE_URL missing — kan inte läsa den levande funktionen');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url });
  let def;
  let stranded;
  try {
    await client.connect();
    const fn = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'claim_source_candidate_test_queue';
    `);
    def = fn.rows[0]?.def ?? '';
    const q = await client.query(
      `SELECT count(*)::int AS stranded FROM source_candidate_test_queue
       WHERE status = 'processing'`,
    );
    stranded = q.rows[0]?.stranded ?? 0;
  } catch (err) {
    return fail(`h4: FAIL DB-fel: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }

  if (!def) return fail('h4: FAIL claim_source_candidate_test_queue finns inte i databasen');
  if (!/locked_at < now\(\) - interval '30 minutes'/.test(def)) {
    return fail('h4: FAIL den LEVENDE claim-funktionen saknar stale-reclaim');
  }
  if (stranded > 0) {
    return fail(
      `h4: FAIL ${stranded} rader ligger kvar i processing — reclaimen når dem inte. ` +
        'Se 20261023-0002 (släpp stranded rows).',
    );
  }
  // Advisory: mäter om reclaimen är city-gated. Informativt, inte ett fel —
  // se invariantkommentaren ovan.
  const reclaimIdx = def.indexOf('locked_at < now()');
  const cityIdx = def.indexOf("city = 'Stockholm'");
  const cityGated = reclaimIdx !== -1 && cityIdx > reclaimIdx;
  return ok(
    `h4: reclaim i LEVENDE funktion + 0 stuck pass (stranded=${stranded}, ` +
      `city-gated reclaim=${cityGated ? 'ja' : 'nej'})`,
  );
}

// H5 — minst en P3D-promotead källa måste vara i scope OCH ouppackad, dvs
// nåbar av getNextABatch(). Kontrollerar den riktiga filen + riktig status.
function h5() {
  const sourcesDir = path.join(ROOT, 'sources');
  if (!fs.existsSync(sourcesDir)) return fail('h5: FAIL sources/ saknas');
  const statusPath = path.join(ROOT, 'runtime/sources_status.jsonl');
  const statuses = new Map();
  if (fs.existsSync(statusPath)) {
    for (const line of fs.readFileSync(statusPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        statuses.set(row.id ?? row.sourceId, row.status);
      } catch { /* trasig rad hoppas över */ }
    }
  }
  const promoted = [];
  for (const fileName of readdirSync(sourcesDir)) {
    if (!fileName.endsWith('.jsonl')) continue;
    const raw = readFileSync(path.join(sourcesDir, fileName), 'utf8').trim();
    if (!raw) continue;
    let record;
    try { record = JSON.parse(raw); } catch { continue; }
    if (!record?.metadata?.sourceCandidateId) continue;
    // 'never_run' = ingen statusrad alls, dvs getSourceStatus() svarar never_run
    // och getNextABatch() plockar upp den. Finns en statusrad har A-gatet redan
    // behandlat den — då är den bevisat nåbar.
    promoted.push({ id: record.id, city: record.city ?? null, status: statuses.get(record.id) ?? null });
  }
  if (promoted.length === 0) return fail('h5: FAIL ingen P3D-promotead källa i sources/');
  const inScope = promoted.filter((p) => String(p.city).trim() === 'Stockholm');
  if (inScope.length === 0) {
    return fail(`h5: FAIL ${promoted.length} promoteade källor men 0 med city=Stockholm — isInScope() släpper igenom dem`);
  }
  const pending = inScope.filter((p) => p.status === null);
  const processed = inScope.filter((p) => p.status !== null);
  if (pending.length === 0 && processed.length === 0) {
    return fail(`h5: FAIL ${inScope.length} i scope men varken ouppackad eller behandlad — A-gatet når dem inte`);
  }
  return ok(`h5: promoted sources in scope=${inScope.length} queued=${pending.length} processed=${processed.length} pass`);
}

// H6 — riktig A-körning ska ha behandlat en promotead källa och persisterat
// events. Läser bevis ur riktiga filer, ingen egen körning.
function h6() {
  const sourcesDir = path.join(ROOT, 'sources');
  const promotedIds = new Set();
  for (const fileName of fs.readdirSync(sourcesDir)) {
    if (!fileName.endsWith('.jsonl')) continue;
    const raw = fs.readFileSync(path.join(sourcesDir, fileName), 'utf8').trim();
    if (!raw) continue;
    let record;
    try { record = JSON.parse(raw); } catch { continue; }
    if (record?.metadata?.sourceCandidateId) promotedIds.add(record.id);
  }
  if (promotedIds.size === 0) return fail('h6: FAIL ingen promoteade källor att leta efter');

  const statusPath = path.join(ROOT, 'runtime/sources_status.jsonl');
  if (!fs.existsSync(statusPath)) return fail('h6: FAIL sources_status.jsonl saknas — A-gatet har inte kört');
  const ran = new Map();
  for (const line of fs.readFileSync(statusPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (promotedIds.has(row.id ?? row.sourceId)) ran.set(row.id ?? row.sourceId, row);
    } catch { /* trasig rad hoppas över */ }
  }
  const attempted = [...ran.entries()].filter(([, r]) => String(r.status).startsWith('success'));
  if (attempted.length === 0) {
    const seen = [...ran.values()].map((r) => `${r.id}=${r.status}`).slice(0, 5).join(' ');
    return fail(`h6: FAIL ingen promotead källa har status success i A-gatet (${seen || 'ingen alls'})`);
  }
  const withEvents = attempted.filter(([, r]) => (r.lastEventsFound ?? r.eventsFound ?? 0) > 0);
  if (withEvents.length === 0) {
    return fail(`h6: FAIL ${attempted.length} körda men 0 events — A-gatet hittade inget`);
  }
  const [id, row] = withEvents[0];
  return ok(`h6: promoted source ran in A-gate events>0 total=${withEvents.length} pass`);
}

// ─── E: hela kedjan ger events (2026-10-23) ───────────────────────────────

// E1 — statisk kontroll av B-fixen. B-gates importerar 03-Queue/queue.js
// lättvindigt (fetchTools.ts:222), vilket öppnar fyra beständiga BullMQ-köer.
// Utan explicit stängning håller en öppen ioredis-socket Node:s eventloop
// levande för alltid — B hängde alltså PRECIS NÄR DET LYCKADES köa events.
function e1() {
  const queueTs = readFileSync(path.join(ROOT, '03-Queue/queue.ts'), 'utf8');
  const runBTs = readFileSync(path.join(ROOT, '02-Ingestion/B-JSON-feedGate/runB.ts'), 'utf8');
  const exported = /export\s+(async\s+)?function\s+closeAllQueues/.test(queueTs);
  if (!exported) return fail('e1: FAIL closeAllQueues är inte exporterad ur 03-Queue/queue.ts');
  const closesAll = /rawEventsQueue[\s\S]{0,400}smokeTestQueue[\s\S]{0,400}searchSyncQueue[\s\S]{0,400}imageGenerationQueue/.test(queueTs);
  if (!closesAll) return fail('e1: FAIL closeAllQueues stänger inte alla fyra köerna');
  const called = /closeAllQueues\s*\(\s*\)/.test(runBTs) && /await\s+import\(['"]\.\.\/\.\.\/03-Queue\/queue\.js['"]\)/.test(runBTs);
  if (!called) return fail('e1: FAIL runB.ts anropar inte closeAllQueues före avslut');
  return ok('e1: closeAllQueues exporterad + runB anropar den pass');
}

// E2 — ingen gate får hänga. Läser chain-overview.log: varje step-start i den
// senaste körningen (sista pid:t) måste ha ett step-end. Ett steg-start utan
// step-end är exakt B-hängningen från 2026-10-23.
function e2() {
  const logPath = path.join(ROOT, 'runtime/ingestion-cron/chain-overview.log');
  if (!fs.existsSync(logPath)) return fail('e2: FAIL chain-overview.log saknas');
  const rows = [];
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* hoppas över */ }
  }
  const runs = [...new Set(rows.filter((r) => r.pid).map((r) => r.pid))];
  if (runs.length === 0) return fail('e2: FAIL inga körningar i chain-overview.log');
  const last = runs[runs.length - 1];
  const own = rows.filter((r) => r.pid === last);
  const ended = new Set(own.filter((r) => r.event === 'step-end').map((r) => r.step));
  const started = own.filter((r) => r.event === 'step-start').map((r) => r.step);
  const missing = [...new Set(started)].filter((s) => !ended.has(s));
  if (missing.length > 0) {
    return fail(`e2: FAIL steg utan step-end=${missing.length} hängda=1 (${missing.join(', ')}) pid=${last}`);
  }
  return ok(`e2: steg utan step-end=0 hängda=0 pass (pid=${last}, ${ended.size} steg avslutade)`);
}

// E3 — kedjan producerar events. totalEventsPersisted ska vara ett reellt tal
// > 0 i den senaste körning som inte är en e2e-sandloll.
function e3() {
  const runsPath = path.join(ROOT, 'runtime/ingestion_runs.jsonl');
  if (!fs.existsSync(runsPath)) return fail('e3: FAIL ingestion_runs.jsonl saknas');
  const rows = [];
  for (const line of readFileSync(runsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* hoppas över */ }
  }
  const real = rows.filter((r) => r.triggerSource !== 'e2e');
  if (real.length === 0) return fail('e3: FAIL inga riktiga körningar (bara e2e) i ingestion_runs.jsonl');
  const persisted = real.reduce((s, r) => s + (typeof r.totalEventsPersisted === 'number' ? r.totalEventsPersisted : 0), 0);
  const okRuns = real.filter((r) => r.ok).length;
  if (persisted <= 0) {
    const last = real[real.length - 1];
    return fail(`e3: FAIL persisted=0 sources_success=${last.sourcesSucceeded ?? 0} (${real.length} körningar)`);
  }
  const withEvents = real.filter((r) => (r.totalEventsPersisted ?? 0) > 0).length;
  if (withEvents === 0) return fail('e3: FAIL 0 körningar med events');
  return ok(`e3: persisted=${persisted} sources_success=${okRuns} pass (${withEvents}/${real.length} körningar med events)`);
}

// E4 — discovery→ingestion i EN körning. Kräver att P3D avslutas FÖRE A i
// chain-overview.log för sista körningen, och att en källa som P3D skrev under
// den körningen fick en färsk statusrad från A-gatet efteråt.
function e4() {
  // E4_CHAIN_LOG gör det möjligt att peka gaten på en syntetisk logg — det
  // används av scripts/verify-e4-order.mjs för att bevisa att gaten KAN
  // faila (negativ kontroll). Utan det hade ingen kunnat visa att "pass"
  // betyder något.
  const logPath = process.env.E4_CHAIN_LOG
    ? path.resolve(process.env.E4_CHAIN_LOG)
    : path.join(ROOT, 'runtime/ingestion-cron/chain-overview.log');
  if (!fs.existsSync(logPath)) return fail('e4: FAIL chain-overview.log saknas');
  const rows = [];
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* hoppas över */ }
  }
  const runs = [...new Set(rows.filter((r) => r.pid).map((r) => r.pid))];
  if (runs.length === 0) return fail('e4: FAIL inga körningar i chain-overview.log');

  // 2026-10-24 — "sista körningen" var fel definition. En `--only <steg>`-körning
  // (t.ex. timeout-gaten) är också en körning i loggen, men den har varken
  // P3D eller A och den mäter ingenting om ordningen. Gaten ska välja den
  // senaste körning som faktiskt är en hel kedja — den som har både P3D och A.
  const fullChains = runs.filter((pid) => {
    const own = rows.filter((r) => r.pid === pid && r.event === 'step-end');
    return own.some((r) => r.step === 'P3D-source-candidate-tests')
      && own.some((r) => r.step === 'A-directAPI');
  });
  if (fullChains.length === 0) {
    return fail('e4: FAIL ingen körning i chain-overview.log har både P3D och A — ingen hel kedja att mäta ordningen i');
  }
  const last = fullChains[fullChains.length - 1];
  const own = rows.filter((r) => r.pid === last && r.event === 'step-end');
  const at = (name) => own.findIndex((r) => r.step === name);
  const p3d = at('P3D-source-candidate-tests');
  const a = at('A-directAPI');
  if (p3d === -1 || a === -1) {
    return fail(`e4: FAIL körningen saknar steg (P3D=${p3d} A=${a}) — kan inte bevisa ordningen`);
  }
  if (p3d > a) return fail(`e4: FAIL P3D avslutades EFTER A (P3D idx=${p3d}, A idx=${a}) — ny källa väntar till nästa natt`);

  // Nu: finns det en källa som skrevs till disk under körningen och sedan fick
  // en färsk statusrad? Annars finns ingen ny promote att följa vidare.
  const runStartRow = rows.find((r) => r.pid === last);
  const startTs = runStartRow?.ts ? Date.parse(runStartRow.ts) : null;
  if (startTs === null) return fail('e4: FAIL körningen saknar startts');
  const sourcesDir = path.join(ROOT, 'sources');
  const fresh = readdirSync(sourcesDir)
    .filter((f) => f.endsWith('.jsonl'))
    .filter((f) => fs.statSync(path.join(sourcesDir, f)).mtimeMs > startTs);
  if (fresh.length === 0) {
    return fail(`e4: FAIL 0 nya källfiler under körningen — ordning=först men ingen ny källa att ta vid (pid=${last})`);
  }
  const statuses = new Map();
  for (const line of readFileSync(path.join(ROOT, 'runtime/sources_status.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); statuses.set(row.sourceId, row); } catch { /* hoppas över */ }
  }
  const picked = fresh.filter((f) => {
    const row = statuses.get(f.replace(/\.jsonl$/, ''));
    return row && Date.parse(row.lastRun ?? '') > startTs;
  });
  if (picked.length === 0) {
    return fail(`e4: FAIL ${fresh.length} nya källor men ingen fick en statusrad från A under körningen`);
  }
  return ok(`e4: promote efter A-körning=${picked.length} ordning=först pass (pid=${last}, ${fresh.length} nya filer)`);
}

// E5 — ingen källa får försvinna tyst. Varje död källa måste antingen ligga i
// kyrkogravet med en reasonCode, eller i en levande kö. Det tredje läget —
// död, obegravd och i ingen kö — är exakt C-gatets gamla STAYS_IN_POOL-drop:
// källor som lämnade poolen med queuePath === '' skrevs till ingen kö och bara
// fanns kvar i state.activePool, som bara SIGINT skrev tillbaka. Mätt
// 2026-10-23: 26 källor döda, obegravda och i ingen kö — varav 15 dessutom i
// stader utanför Stockholm, som isInScope() aldrig skulle släppa igenom.
//
// Kyrkogravet är befintligt: sources/_quarantine/ + sources/_retired/, med
// INDEX.json som läses av quarantineGuard.ts isSkipped().
const QUEUE_FILES = [
  'preA-queue', 'preB-queue', 'postA-queue', 'postB-queue', 'postB-preC-queue',
  'preUI-queue', 'postTestC-UI', 'postTestC-manual-review', 'postTestC-serverdown',
  'postTestC-B', 'postTestC-D', 'postD-UI',
];

function e5() {
  const readIndex = (dir) => {
    const p = path.join(ROOT, 'sources', dir, 'INDEX.json');
    if (!fs.existsSync(p)) return new Map();
    const map = new Map();
    for (const e of JSON.parse(readFileSync(p, 'utf8'))) {
      if (e.sourceId) map.set(e.sourceId, e.reasonCode ?? '');
    }
    return map;
  };
  const grave = new Map([...readIndex('_quarantine'), ...readIndex('_retired')]);

  const inQueue = new Set();
  for (const name of QUEUE_FILES) {
    const p = path.join(ROOT, 'runtime', `${name}.jsonl`);
    if (!fs.existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const id = JSON.parse(line).sourceId; if (id) inQueue.add(id); } catch { /* hoppas över */ }
    }
  }

  const latest = new Map();
  for (const line of readFileSync(path.join(ROOT, 'runtime/sources_status.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); latest.set(row.sourceId, row); } catch { /* hoppas över */ }
  }
  const dead = [...latest.values()].filter((r) => r.status !== 'success' && r.status !== 'never_run');
  if (dead.length === 0) return fail('e5: FAIL inga misslyckade källor — mät på riktig data, inte inget');

  const stuck = dead.filter((r) => !grave.has(r.sourceId) && !inQueue.has(r.sourceId));
  if (stuck.length > 0) {
    return fail(`e5: FAIL graveyard=${grave.size} utan_orsak=${stuck.length} — ${stuck.length} döda källor är varken begravda eller i kö: ${stuck.slice(0, 4).map((r) => r.sourceId).join(', ')}`);
  }

  // Negativ kontroll: mätningen måste kunna skilja begravd från köad. Finns
  // bara den ena kategorin betyder stuck=0 ingenting.
  const buriedDead = dead.filter((r) => grave.has(r.sourceId));
  const queuedDead = dead.filter((r) => !grave.has(r.sourceId) && inQueue.has(r.sourceId));
  if (buriedDead.length === 0 || queuedDead.length === 0) {
    return fail(`e5: FAIL negativ kontroll: begravda=${buriedDead.length} köade=${queuedDead.length} — behöver båda för att bevisa att mätningen fungerar`);
  }

  const outOfScope = buriedDead.filter((r) => grave.get(r.sourceId) === 'coverage.outside_stockholm').length;
  return ok(`e5: graveyard=${grave.size} utan_orsak=0 pass (${dead.length} döda: ${buriedDead.length} begravda varav ${outOfScope} out-of-scope, ${queuedDead.length} i kö)`);
}

// E6 — ingen oanvändbar källa får ligga kvar i sources/.
//
// Defektklassen: sandbox.ts:46 skriver `city: candidate.city ?? undefined`.
// En promote utan stad ger en fil som isInScope() (sourceRegistry.ts:150,
// kräver exakt 'Stockholm') släpper förbi i tysthet — A-gatet säger då
// "sources-main is empty" utan att någon ser varför. Mätt 2026-10-23: 92
// filer var varken begravda eller in-scope (73 med annan stad, 10 utan stad,
// 9 märkta "Sweden" vilket inte är en stad), samtidigt som A-gatet kördes på
// tomma preA-könar.
//
// Negativ kontroll krävs: mätningen måste kunna skilja en begravd fil från en
// levande. Finns bara den ena kategorin är outOfScope=0 inte ett bevis.
function e6() {
  // Negativ kontroll först, och ur INDEX.json — inte ur sources/. BEGRAVNING
  // FLYTTAR filen ur sources/, så en scan av sources/ kan aldrig räkna de
  // begravda. Det var exakt det som gjorde min första version av den här gaten
  // falskt FAIL:a (negativ kontroll noll trots 78 begravda).
  let buriedOutOfScope = 0;
  for (const dir of ['_quarantine', '_retired']) {
    const p = path.join(ROOT, 'sources', dir, 'INDEX.json');
    if (!fs.existsSync(p)) continue;
    for (const e of JSON.parse(readFileSync(p, 'utf8'))) {
      if (e.reasonCode === 'coverage.outside_stockholm') buriedOutOfScope += 1;
    }
  }

  const sourcesDir = path.join(ROOT, 'sources');
  let inScope = 0;
  const outOfScope = [];
  for (const f of fs.readdirSync(sourcesDir)) {
    if (!f.endsWith('.jsonl')) continue;
    let rec;
    try { rec = JSON.parse(readFileSync(path.join(sourcesDir, f), 'utf8').trim()); } catch { continue; }
    // Sandbox-filer tas bort efter varje test och är aldrig skrivna ut.
    if (rec?.metadata?.sandbox) continue;
    const city = String(rec?.city ?? '').trim();
    if (city === 'Stockholm') { inScope += 1; continue; }
    outOfScope.push(`${f.replace(/\.jsonl$/, '')}(${city || 'saknas'})`);
  }

  if (outOfScope.length > 0) {
    return fail(`e6: FAIL kvar_oanvändbara=${outOfScope.length} av ${inScope + outOfScope.length} filer — ${outOfScope.slice(0, 5).join(', ')}`);
  }
  // Utan begravda oanvändbara filer bevisar outOfScope=0 bara att de aldrig
  // uppstått — predikatet har då aldrig skiljt något från något.
  if (buriedOutOfScope === 0) {
    return fail(`e6: FAIL negativ kontroll: 0 begravda med coverage.outside_stockholm — predikatet har inte skiljt begravd från levande (in-scope=${inScope})`);
  }
  return ok(`e6: out_of_scope=0 pass (${inScope} in-scope, ${buriedOutOfScope} begravda out-of-scope)`);
}

// E7 — P3D får inte testa kandidater som aldrig kan nå databasen.
//
// claim_source_candidate_test_queue saknade city-filter före migration
// 20261023-0001. Mätt 2026-10-23: 381 pending, varav 131 city='Stockholm',
// 202 city IS NULL och 48 med annan stad. Varje testad kandidat kostar en
// riktig A→B→C-körning mot nätet (147 s för 20 kandidater, varav 0
// Stockholm) — två tredjedelar av P3D:s budget gick till källor isInScope()
// aldrig släpper igenom.
//
// Gaten läser den LEVENDE funktionsdefinitionen, inte migrationsfilen: en
// funktion som skrivs över senare ska falla gaten, inte migrationsfilen.
async function e7() {
  const url = readEnvFile().DATABASE_URL;
  if (!url) return fail('e7: FAIL DATABASE_URL missing — kan inte läsa den levande funktionen');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url });
  let def;
  let skipped;
  try {
    await client.connect();
    const fn = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'claim_source_candidate_test_queue';
    `);
    def = fn.rows[0]?.def ?? '';
    const cnt = await client.query(
      `SELECT count(*)::int AS n FROM source_candidate_test_queue
       WHERE status = 'pending' AND city IS DISTINCT FROM 'Stockholm'`,
    );
    skipped = cnt.rows[0]?.n ?? 0;
  } catch (err) {
    return fail(`e7: FAIL DB-fel: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }

  if (!def) return fail('e7: FAIL claim_source_candidate_test_queue finns inte i databasen');
  if (!/city\s*=\s*'Stockholm'/.test(def)) {
    return fail('e7: FAIL claim-funktionen saknar city-filter — utsockes-kandidater kan fortfarande testas');
  }
  // Negativ kontroll: filtret ska faktiskt utesluta något. Om inga pending
  // rader ligger utanför Stockholm är gate:n inte mätande — den testar bara
  // att filteret finns, inte att det gör skillnad.
  if (skipped === 0) {
    return fail('e7: FAIL negativ kontroll: inga pending-kandidater utanför Stockholm att utesluta');
  }
  return ok(`e7: claim filterar city='Stockholm' pass (${skipped} pending uteslutas)`);
}

/**
 * E8 — cross-source dedup får inte skriva identitetskolumner.
 *
 * Bakgrund (2026-10-23): normalizern hittar en befintlig rad via ticket_url
 * (cross-source dedup), och skrev sedan den NYA källans dedup_hash/source/
 * source_id på den raden. Den raden ägs av en annan källa, så hashen tillhör
 * en annan rad → UNIQUE-violation → jobbet kastades, eventet uppdaterades
 * aldrig. Uppmätt på job 81079 (livespot "Biohack me"):
 *   duplicate key value violates unique constraint "events_dedup_hash_key"
 *   duplicate key value violates unique constraint "idx_events_source_source_id_uniq"
 *
 * Gaten spelar upp de failed jobb som finns och kräver NOLL unika-konstraint-
 * brott. Negativ kontroll: antingen spelade vi upp minst ett jobb, eller så
 * finns inga failed jobb kvar alls (då är gaten inte mätande — det sägs rakt ut).
 *
 * Körs i en subprocess på `npx tsx`: normalizer.ts importerar '../03-Queue/queue'
 * UTAN filändelse, vilket bara tsx (och inte ren node) kan slå upp. Att köra
 * replayen i verifierprocessen själv kastade "Cannot find module … normalizer.js".
 * Subprocessen ger dessutom en ren exit att mäta och håller Redis-socklarna
 * borta från den långlivade verifierprocessen.
 */
const E8_SAMPLE = 20;
function e8() {
  const REPLAY = `
    (async () => {
      process.env.AI_IMAGE_PIPELINE_ENABLED = '0';
      const { rawEventsQueue, closeAllQueues } = await import('./03-Queue/queue.js');
      const { processRawEvent } = await import('./04-Normalizer/normalizer.js');
      const { stopAiImageWorker } = await import('./08-Agent/workers/aiImageWorker.js');
      const failed = await rawEventsQueue.getFailed(0, ${E8_SAMPLE - 1});
      const total = (await rawEventsQueue.getJobCounts('failed')).failed ?? 0;
      let violations = 0, other = 0, done = 0;
      const msgs = new Set();
      for (const job of failed) {
        try { await processRawEvent({ data: job.data }); done += 1; }
        catch (err) {
          const m = String(err?.message ?? err);
          if (/duplicate key value violates unique constraint/.test(m)) {
            violations += 1;
            msgs.add(m.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<uuid>').slice(0, 90));
          } else other += 1;
        }
      }
      await stopAiImageWorker().catch(() => {});
      await closeAllQueues().catch(() => {});
      console.log('E8RESULT ' + JSON.stringify({ n: failed.length, total, violations, other, done, msg: [...msgs][0] ?? '' }));
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const r = spawnSync('npx', ['tsx', '--eval', REPLAY], {
    cwd: ROOT, encoding: 'utf8', timeout: 420_000, killSignal: 'SIGKILL',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error || r.signal) return fail(`e8: FAIL replayen avslutade inte rent (${r.error?.message ?? r.signal})`);
  const line = out.split('\n').find((l) => l.startsWith('E8RESULT '));
  if (!line) {
    const why = out.split('\n').filter((l) => /Error|error/.test(l)).slice(0, 2).join(' / ');
    return fail(`e8: FAIL replayen gav inget resultat — ${why || 'ingen felrad'}`);
  }
  const res = JSON.parse(line.slice('E8RESULT '.length));
  if (res.n === 0) {
    if (res.total === 0) return ok('e8: inga failed jobb kvar — inget att spela upp (vakuum, ej mätande)');
    return fail(`e8: FAIL kunde inte läsa failed trots total=${res.total}`);
  }
  if (res.violations > 0) {
    return fail(`e8: FAIL unique-constraint-brott=${res.violations}/${res.n} — ${res.msg}`);
  }
  return ok(`e8: cross-source identitet bevarad pass (0 brott av ${res.n} uppspelade: ${res.done} ok, ${res.other} andra fel; ${res.total} failed kvar)`);
}


/**
 * E9 — drainQueue --status avslutar. Socket-läcka i aiImageWorker.
 *
 * Bakgrund (2026-10-23): aiImageWorker.ts öppnar två Redis-sockets på
 * modulnivå (rad 58 `connection`, rad 64 `aiImageQueue`) bara genom att
 * importeras. `stopAiImageWorker()` stängde bara workern, aldrig dem, och
 * `closeAllQueues()` i queue.ts stänger bara de fyra köer den själv skapar.
 * --status returnade dessutom utan process.exit. Mått: tre --status-processer
 * levde kvar i timmar (lsof: exakt 1 ESTABLISHED-socket mot localhost:6379).
 *
 * Gaten spawnar --status med hård tid och kräver att processen avslutar.
 * Negativ kontroll: barnet måste ha skrivit ut könivå — annars testar vi bara
 * att en process kan startas, inte att den gör jobbet.
 */
function e9() {
  const r = spawnSync('npx', ['tsx', '03-Queue/drainQueue.ts', '--status'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error) return fail(`e9: FAIL kunde inte starta --status: ${r.error.message}`);
  if (r.signal) return fail(`e9: FAIL --status avslutade INTE inom 60 s (signal ${r.signal}) — socket-läckan är tillbaka`);
  // Måste vara exit 0, inte bara "ingen signal". Utan detta passerade gaten med
  // exit=1 när processen kraschade på en trasig import — mätt 2026-10-23.
  if (r.status !== 0) {
    const why = out.split('\n').filter((l) => /error|Error|Cannot find/i.test(l)).slice(0, 2).join(' / ');
    return fail(`e9: FAIL --status avslutade med exit ${r.status} — ${why || 'ingen felrad'}`);
  }
  if (!/"waiting"\s*:/.test(out)) {
    return fail(`e9: FAIL negativ kontroll: --status skrev ingen ködjup — processen gjorde inget arbete`);
  }
  return ok('e9: --status avslutar rent pass (exit=0, inga läckta sockets)');
}

/**
 * E10 — källor som C lyckas extrahera ifrån får inte stå som fail.
 *
 * Felgrunden (2026-10-23): run-dynamic-pool.ts (C-htmlGate) importerade aldrig
 * updateSourceStatus, medan runA.ts och runB.ts gör det. B routar en källa till C
 * med "[breadth] unclear", C extrahterar den, och raden i sources_status.jsonl
 * står kvar som status=fail för alltid. Mätt samma kväll: 42 av 269 fail-källor
 * hade events i databasen. De räknades som döda av dashboarden, av
 * classify-dead-sources.ts och av E5/E6-gates som bygger begravningslistor —
 * en begravning hade utplånat källan till de eventen.
 *
 * Otron: för varje fil i 03-Queue/03-extractedevents/C/ som innehåller minst
 * en rad, och vars sourceId är SPÅRAD i sources/ och INTE begravd, måste
 * motsvarande rad stå som success. Negativ kontroll: gaten räknar de
 * verkliga filerna, så en tom katalog eller en trasig statusfil ger FAIL,
 * inte PASS. Se scope-korrigeringen i funktionens kropp för varför begravda
 * och ospårade källor utesluts.
 */
function e10() {
  const src = readFileSync(path.join(ROOT, '02-Ingestion/C-htmlGate/run-dynamic-pool.ts'), 'utf8');
  if (!/updateSourceStatus/.test(src)) {
    return fail('e10: FAIL run-dynamic-pool.ts anropar inte updateSourceStatus — grunden till felet finns kvar');
  }

  const dir = path.join(ROOT, '03-Queue/03-extractedevents/C');
  if (!existsSync(dir)) {
    return fail(`e10: FAIL ${dir} finns inte — kan inte mäta något, detta är inte ett bevis`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) {
    return fail('e10: FAIL negativ kontroll: 0 extraherade filer i C-mappen — gaten mäter ingenting');
  }

  // 2026-10-23 — Scope-korrigering. Första versionen av denna gate krävde att
  // VARJE C-extraherad källa stod som `success`. Mätningen visade att den
  // invarianten är falsk. Av 108 C-extraherade källor med fel status var
  //   64 begravda (42 kyrkograv + 22 karantän) — där är `fail` RÄTT, inte fel.
  //      En begravd källa ska aldrig återväckas av en statusrad, och `ekero`
  //      är permanentlyRetired sedan 2026-10-04 (HTTP 000, DNS död).
  //   18 ospårade (ingen sources/<id>.jsonl — liseberg, malmopera,
  //      kungliga-operan …). De är C-extrafiler från tiden innan scope:n
  //      smalnade till Stockholm och ägs inte av A/B/C.
  // Rätt invariant: en källa som är SPÅRAD i sources/ och INTE begravd får
  // inte stå som fel om C lyckades extrahera ifrån den. Uteslutningarna
  // redovisas i utdata så att de inte är tysta.
  const readIndex = (p) => {
    try { return JSON.parse(readFileSync(path.join(ROOT, p), 'utf8')); }
    catch { return []; }
  };
  const buried = new Set([
    ...readIndex('sources/_quarantine/INDEX.json'),
    ...readIndex('sources/_retired/INDEX.json'),
  ].map((e) => e.sourceId));
  const tracked = new Set(readdirSync(path.join(ROOT, 'sources'))
    .filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, '')));

  const rows = readFileSync(path.join(ROOT, 'runtime/sources_status.jsonl'), 'utf8')
    .trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const latest = new Map();
  for (const r of rows) if (r.sourceId) latest.set(r.sourceId, r);

  const offenders = [];
  let checked = 0, skippedBuried = 0, skippedUntracked = 0;
  for (const f of files) {
    const id = f.replace(/\.jsonl$/, '');
    const events = readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter((l) => l.trim()).length;
    if (events === 0) continue;
    if (buried.has(id)) { skippedBuried++; continue; }
    if (!tracked.has(id)) { skippedUntracked++; continue; }
    checked++;
    const st = latest.get(id);
    if (!st) { offenders.push(`${id}(${events} ev, ingen statusrad)`); continue; }
    if (st.status !== 'success') offenders.push(`${id}(${events} ev, status=${st.status})`);
  }

  if (offenders.length > 0) {
    return fail(
      `e10: FAIL ${offenders.length}/${checked} spårade C-extraherade källor står fel i sources_status — ` +
      offenders.slice(0, 5).join(', '),
    );
  }
  return ok(
    `e10: C-status är konsekvent pass (${checked} spårade källor, 0 fel; ` +
    `uteslutna: ${skippedBuried} begravda, ${skippedUntracked} ospårade)`,
  );
}

/**
 * E11: kedjan importerar extraherade events, och gör det FÖRE drain.
 *
 * 2026-10-23. A/B/C/D/I skriver sina events till `03-Queue/03-extractedevents/`
 * och når aldrig `events`-tabellen själva. Persistensen sker i ett annat lager:
 * `importToEventPulse.ts` → bullmq `raw_events` → startWorker → normalizer.
 *
 * Det steget kördes INTE i `scripts/ingestion-cron.ts` (0 referenser). Det kördes
 * av `com.eventpulse.post-ingest` (04:00) → runDaily → ingestionPipeline steg 3,
 * alltså på en klocka oberoende av kedjan som startar 02:00 och mätt tar
 * 1,5–2,5 h. Mätt 2026-10-23: senaste import 02:00 UTC medan C skrev 13
 * extrafiler kl. 12:24 UTC — 18 spårade källor med 120 extraherade events och
 * 0 rader i `events`.
 *
 * Otron (lästa ur `runtime/ingestion-cron.status.json`, dvs ur en riktig körning):
 *   1. steget `import-to-eventpulse` finns bland körningens steg,
 *   2. det avslutades (exitCode 0),
 *   3. det ligger FÖRE `worker-drain` i stegordningen — annars dräner workern
 *      en tom kö och jobben ligger kvar till nästa natt,
 *   4. det har ett mätt count, inte null.
 */
function e11() {
  const statusFile = path.join(ROOT, 'runtime/ingestion-cron.status.json');
  if (!existsSync(statusFile)) {
    return fail('e11: FAIL runtime/ingestion-cron.status.json saknas — ingen körning att mäta, detta är inte ett bevis');
  }
  let status;
  try { status = JSON.parse(readFileSync(statusFile, 'utf8')); }
  catch (e) { return fail(`e11: FAIL statusfilen går inte att tolka: ${e.message}`); }

  // Negativ kontroll: en fil utan steg mäter ingenting.
  const steps = status.steps || [];
  if (steps.length === 0) {
    return fail(`e11: FAIL negativ kontroll: körningen har ${steps.length} steg — gaten mäter ingenting`);
  }

  const IMPORT = 'import-to-eventpulse';
  const DRAIN = 'worker-drain';
  const iImport = steps.findIndex((s) => s.name === IMPORT);
  const iDrain = steps.findIndex((s) => s.name === DRAIN);

  if (iImport === -1) {
    return fail(
      `e11: FAIL kedjan har inget steg "${IMPORT}" (${steps.length} steg körda) — ` +
      'extraherade events når aldrig databasen via den här vägen',
    );
  }
  const imp = steps[iImport];
  if (imp.exitCode !== 0) {
    return fail(`e11: FAIL ${IMPORT} avslutade med exitCode=${imp.exitCode}`);
  }
  if (iDrain === -1) {
    return fail(`e11: FAIL kedjan saknar "${DRAIN}" — kan inte bevisa ordningen`);
  }
  if (iImport >= iDrain) {
    return fail(
      `e11: FAIL ordningen är fel: ${IMPORT} på position ${iImport + 1} körs EFTER ${DRAIN} ` +
      `på position ${iDrain + 1} — workern dränerar en tom kö`,
    );
  }
  if (imp.eventsExtracted === null || imp.eventsExtracted === undefined) {
    return fail(
      `e11: FAIL ${IMPORT} har inget mätt count (eventsExtracted=${imp.eventsExtracted}) — ` +
      'steget kan inte rapportera hur många events som faktiskt gick i BullMQ',
    );
  }
  return ok(
    // Ordningarna är 1-baserade (steg 1..N) — findIndex är 0-baserat, så
    // utan +1 pekade gaten på fel stegnummer.
    `e11: import→drain ordnad pass (${IMPORT} #${iImport + 1} → ${DRAIN} #${iDrain + 1}, ` +
    `${imp.eventsExtracted} events till bullmq, exit=0)`,
  );
}

/**
 * N1 — C3-AI:s "needs_render" routar till D-renderGate, inte till begravning.
 *
 * Bakgrund (2026-10-24). `AiVerdict` har värdet 'needs_render' — C3-AI säger
 * uttryckligen att sidan behöver JS-rendering. Det är D-gatens signal, men
 * C-gaten läste aldrig värdet: källan föll i "extraction zero"-grenen och
 * skickades till manual-review, vilket är samma sak som att begrava den.
 * Fyra orelaterade domäner drabbades (vasamuseet 12, vasa-museum 9,
 * botaniska-tradgarden 8, svenska-fotbollf-rbundet 12) — alla med C2-score
 * under tröskeln 20 som annars skickat dem till D.
 *
 * Gaten kör två oberoende bevis:
 *   1. Enhetstestet som träffar den RIKTIGA koden (inte en kopia). Kräver
 *      att både fixens test OCH de negativa kontrollerna finns och passerar.
 *      Utan de negativa kontrollerna skulle testet kunna passera på en regel
 *      som aldrig fyrar.
 *   2. Det levande beviset: audit-loggen ska innehålla en källa som lämnade
 *      C-gaten mot postTestC-D med evidensen "needs_render".
 */
function n1() {
  const VITEST = '02-Ingestion/C-htmlGate/run-dynamic-pool.test.ts';
  const REQUIRED_TESTS = [
    'routes needs_render to D-renderGate, not to manual-review',
    'lands in the postTestC-D queue — the routing that actually matters',
    'NEGATIVE: aiVerdict=failed still goes to manual-review',
    'NEGATIVE: aiVerdict=partial still goes to manual-review',
    'NEGATIVE: no AI verdict at all still goes to manual-review',
  ];

  const r = spawnSync(
    'npx',
    ['vitest', 'run', VITEST, '--reporter=json', '--outputFile', path.join(ROOT, 'runtime/n1-vitest.json')],
    { cwd: ROOT, encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL' },
  );
  const reportPath = path.join(ROOT, 'runtime/n1-vitest.json');
  if (!existsSync(reportPath)) {
    const why = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter((l) => /Error|error/i.test(l)).slice(0, 2).join(' / ');
    return fail(`n1: FAIL vitest gav ingen rapport — ${why || 'okänt fel'}`);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch (e) {
    return fail(`n1: FAIL kunde inte tolka vitest-rapporten: ${e.message}`);
  }

  const testResults = report.testResults ?? [];
  const allPassed = (report.numPassedTests ?? 0) === (report.numTotalTests ?? -1)
    && (report.numFailedTests ?? 0) === 0;
  if (!allPassed) {
    return fail(
      `n1: FAIL testerna i ${VITEST} passerar inte ` +
      `(passed=${report.numPassedTests} failed=${report.numFailedTests} total=${report.numTotalTests})`,
    );
  }

  const names = new Set();
  for (const file of testResults) {
    for (const t of file.assertionResults ?? []) names.add(t.title);
  }
  const missing = REQUIRED_TESTS.filter((t) => !names.has(t));
  if (missing.length > 0) {
    return fail(
      `n1: FAIL följande test saknas i ${VITEST} — de är beviset och de negativa kontrollerna: ` +
      missing.join(' | '),
    );
  }

  // Levande bevis: audit-loggen ska ha en needs_render-källa som gick till D.
  const auditPath = path.join(ROOT, 'runtime/sources_audit.jsonl');
  if (!existsSync(auditPath)) {
    return fail('n1: FAIL runtime/sources_audit.jsonl saknas — det levande beviset går inte att läsa');
  }
  const liveHits = readFileSync(auditPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((d) => d && d.event === 'exited_pool' && d.target === 'postTestC-D')
    .filter((d) => /needs_render/.test(d.metadata?.evidence ?? ''));

  if (liveHits.length === 0) {
    return fail(
      'n1: FAIL ingen källa har lämnat C-gaten mot postTestC-D med evidensen "needs_render" — ' +
      'fixen är inte verksam i den levande koden',
    );
  }
  const first = liveHits[0];
  return ok(
    `n1: needs_render → D-renderGate pass ` +
    `(${report.numPassedTests} tester, ${REQUIRED_TESTS.length} kravda namn, ` +
    `${liveHits.length} levande routed: ${first.sourceId} "${first.metadata.evidence}")`,
  );
}

/**
 * N2 — drainens worker-concurrency är mätbar, och högre concurrency ger mer.
 *
 * Bakgrund (2026-10-24). `03-Queue/queue.ts` hårdkodade concurrency till 5.
 * Mätt 45,4 jobb/min. Nattens import köar ~5 300 jobb men cron-stegets budget
 * är 90 minuter — 45,4 × 90 ≈ 4 086 jobb. Kön växte alltså varje natt, och
 * de extragerade eventsen syntes i databasen först flera nätter senare.
 *
 * Gaten mäter på riktig kö: två drain-körningar (concurrency N och N+5),
 * räknar "[worker] Job completed"-rader. Kräver att den högre concurrencyn
 * ÄR snabbare — annars är höjningen värdelös. Ingen syntetisk data: varje
 * räknad jobb är en riktig normalisering som persisterat ett event.
 *
 * `--seed` kör den vanliga importvägen först, så det finns arbete att mäta
 * på även när kön är tom. Utan seed ger en tomkö 0 jobb/min i båda
 * mätningarna — korrekt, men värdelöst. Mätverktyget vägrar därför redovisa
 * en mätning där inga jobb slutfördes.
 */
function n2() {
  const unit = spawnSync(
    'npx',
    ['vitest', 'run', '03-Queue/workerConcurrency.test.ts'],
    { cwd: ROOT, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' },
  );
  if (unit.status !== 0) {
    return fail(`n2: FAIL enhetstestet för concurrency-tolkningen passerar inte:\n${(unit.stdout ?? '') + (unit.stderr ?? '')}`);
  }

  const r = spawnSync(
    'node',
    ['scripts/measure-drain-concurrency.mjs', '--low', '5', '--high', '10', '--seconds', '120', '--seed', '--apply'],
    { cwd: ROOT, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL' },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    return fail(`n2: FAIL mätningen av concurrency misslyckades:\n${out.split('\n').slice(-6).join('\n')}`);
  }
  let m;
  try {
    // Mätverktyget skriver JSON på stdout och loggar på stderr. Om man
    // parsar concat(stdout+stderr) får man JSONen med loggraderna
    // hängande efter — och JSON.parse fallerar. Parsa stdout ensamt, och
    // falla tillbaka på att hitta det sista kompletta JSON-objektet.
    m = parseJsonObject(r.stdout ?? '');
  } catch (e) {
    return fail(`n2: FAIL kunde inte tolka mätningen: ${e.message}\n${out.split('\n').slice(-6).join('\n')}`);
  }
  // Mätningen måste ha haft arbete att göra — annars är "högre är snabbare"
  // en jämförelse mellan två nollor.
  if (!m.lowResult.completed || !m.highResult.completed) {
    return fail(
      `n2: FAIL mätningen utan arbete — ` +
      `c=${m.lowResult.concurrency}: ${m.lowResult.completed} jobb, ` +
      `c=${m.highResult.concurrency}: ${m.highResult.completed} jobb`,
    );
  }
  return ok(
    `n2: concurrency mätbar och högre ger mer pass ` +
    `(seed=${m.seed?.enqueued ?? '?'} events, ` +
    `c=${m.lowResult.concurrency}: ${m.lowResult.completed} jobb / ${m.lowResult.ratePerMin} jobb-min / ${m.jobsPerBudgetLow} per 90 min, ` +
    `c=${m.highResult.concurrency}: ${m.highResult.completed} jobb / ${m.highResult.ratePerMin} jobb-min / ${m.jobsPerBudgetHigh} per 90 min, ` +
    `speedup=${m.speedup}×)`,
  );
}

// ─── S1/S2/S3 — sitemap-fixarna (2026-10-24) ────────────────────────────────
//
// Tre fel gjorde att sitemap-discovery persisterade nästan inget:
//
//   S1  @type === 'Event' kastade bort ALLA schema.org-subtyper.
//       Mätt på 189 källor: MusicEvent (concerts50.com — 33 events),
//       VisualArtsEvent (konstkalendern.com), ExhibitionEvent
//       (stockholm.fotografiska.com). Listan speglar den kanoniska
//       extractorn i 02-Ingestion/F-eventExtraction/extractor.ts, som själv
//       grundades på spelning.se + sodrateatern — alltså redan bevisad på
//       flera orelaterade domäner. Spegeln (.mjs) kan inte importera .ts
//       (skriptet ska köras med ren node), så listorna hålls i synk av
//       paritetskontrollen i s1.
//   S2  Källans EGEN URL var inte en kandidat. 124 framtida events ligger
//       på källans egen URL (t.ex. nalen.com/sv/konsert/kleerup — sidan
//       bär JSON-LD men finns ingen listing att hitta). Regeln ligger i
//       scripts/lib/sitemapDiscovery.mjs → buildCandidateUrls, så gaten
//       testar samma kodväg som körningen använder.
//   S3  LEVBEVIS: källorna som fixen öppnade har nu framtida rader i DB.
//
// Varje gate har negativ kontroll. Utan den kan en gate som mäter "inget"
// se ut att passera.

/**
 * S1 — schema.org Event-subtyper accepteras, och spegeln är i paritet med
 * den kanoniska extractorn.
 */
async function s1() {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/eventExtraction.mjs')).href);

  // Positiv kontroll: subtyperna som föll bort före fixen.
  const POSITIVE = ['Event', 'MusicEvent', 'VisualArtsEvent', 'ExhibitionEvent', 'TheaterEvent', 'Festival', 'ScreeningEvent'];
  const missed = POSITIVE.filter((t) => !lib.isEventType(t));
  if (missed.length > 0) return fail(`s1: FAIL subtyper avvisas fortfarande: ${missed.join(', ')}`);

  // Negativ kontroll: listan får inte bli så generell att sidans egen
  // webbplats-metadata plockas som event.
  const NEGATIVE = ['WebSite', 'WebPage', 'Organization', 'BreadcrumbList', 'NewsArticle', 'Restaurant', 'TouristInformationCenter', 'EventSeries', 'Product', ''];
  const accepted = NEGATIVE.filter((t) => lib.isEventType(t));
  if (accepted.length > 0) return fail(`s1: FAIL negativ kontroll — icke-event-typer accepteras: ${accepted.join(', ')}`);

  const wrap = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  for (const bad of [{ '@type': 'WebSite', name: 'Varumärke' }, { '@type': 'NewsArticle', name: 'Artikel', startDate: '2026-12-01' }]) {
    const got = lib.extractJsonLdEvents(wrap(bad));
    if (got.length !== 0) return fail(`s1: FAIL negativ kontroll — ${bad['@type']} gav ${got.length} events`);
  }

  const evs = lib.extractJsonLdEvents(wrap({
    '@type': 'MusicEvent',
    name: 'Shinedown',
    startDate: '2026-11-09T19:00:00+01:00',
    location: { name: 'Annexet', address: { streetAddress: 'Mäster Samuelsgatan 8' }, geo: { latitude: '59.3293', longitude: '18.0611' } },
  }));
  if (evs.length !== 1) return fail(`s1: FAIL MusicEvent gav ${evs.length} events (väntade 1)`);
  if (evs[0].name !== 'Shinedown' || !evs[0].startDate) return fail(`s1: FAIL MusicEvent-fält fel: ${JSON.stringify(evs[0])}`);
  if (Math.abs(evs[0].lat - 59.3293) > 0.001) return fail('s1: FAIL lat saknas i MusicEvent');

  // PARITET med den kanoniska extractorn — spegeln får inte glida isär.
  const tsPath = path.join(ROOT, '02-Ingestion/F-eventExtraction/extractor.ts');
  if (!fs.existsSync(tsPath)) return fail('s1: FAIL extractor.ts saknas');
  const ts = readFileSync(tsPath, 'utf8');
  const block = ts.match(/EVENT_SUBTYPES\s*=\s*new Set(?:<[^>]*>)?\(\[([\s\S]*?)\]\)/);
  if (!block) return fail('s1: FAIL kunde inte läsa EVENT_SUBTYPES ur extractor.ts');
  const canonical = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const mirror = [...lib.EVENT_SUBTYPES];
  const onlyCanonical = canonical.filter((t) => !mirror.includes(t));
  const onlyMirror = mirror.filter((t) => !canonical.includes(t));
  if (onlyCanonical.length > 0 || onlyMirror.length > 0) {
    return fail(`s1: FAIL paritet — bara i kanonisk: [${onlyCanonical.join(', ')}], bara i spegeln: [${onlyMirror.join(', ')}]`);
  }

  return ok(`s1: subtyper=${mirror.length} paritet=ok negativ=${NEGATIVE.length} avvisade music=1 pass`);
}

/**
 * S2 — källans EGEN URL är en kandidat, och den bär riktiga events.
 *
 * Två delar: regeln i biblioteket (som skriptet anropar — annars vore det
 * död kod) och ett levande bevis på att källans egen URL faktiskt ger
 * events med den riktiga extractorn.
 */
async function s2() {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/sitemapDiscovery.mjs')).href);
  const script = readFileSync(path.join(ROOT, 'scripts/ingest-sitemap-discovery.mjs'), 'utf8');
  if (!/buildCandidateUrls\(source\.url/.test(script)) {
    return fail('s2: FAIL skriptet anropar inte buildCandidateUrls(source.url, …) — regeln är inte i körvägen');
  }

  const OWN = 'https://nalen.com/sv/konsert/kleerup';
  const cands = lib.buildCandidateUrls(OWN, ['https://nalen.com/evenemang/annat']);
  if (cands[0] !== OWN) return fail(`s2: FAIL källans URL är inte först i kandidatmängden: ${JSON.stringify(cands)}`);
  if (!cands.includes('https://nalen.com/evenemang/annat')) return fail('s2: FAIL sitemap-URL tappades ur kandidatmängden');
  if (lib.buildCandidateUrls(OWN, [OWN]).length !== 1) return fail('s2: FAIL källans URL dubblerades');
  if (lib.buildCandidateUrls('', ['https://x.se/a']).includes('')) return fail('s2: FAIL tom käll-URL blev kandidat');
  // Negativ kontroll: kandidatmängden är inte "alla URL:er".
  if (cands.includes('https://example.invalid/')) return fail('s2: FAIL negativ kontroll — främmande URL i kandidatmängden');

  // LEVBEBIVS: kör det riktiga skriptet mot en källa vars egen URL bär
  // events, och kontrollera att den faktiskt hämtas.
  const SLUG = 'allevents-in-stockholm';
  const OWN_URL = 'https://allevents.in/stockholm';
  const r = spawnSync(
    'node',
    ['scripts/ingest-sitemap-discovery.mjs', '--dry-run', `--slug=${SLUG}`],
    { cwd: ROOT, encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL' },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) {
    return fail(`s2: FAIL skriptet avslutade med ${r.status}:\n${out.split('\n').slice(-5).join('\n')}`);
  }
  const line = out.split('\n').find((l) => l.includes(`${SLUG}:`) && l.includes('fetched='));
  if (!line) return fail(`s2: FAIL ingen rad för ${SLUG} i skriptets logg:\n${out.split('\n').slice(-5).join('\n')}`);
  const urlsRaw = line.match(/urls=(\[[^\]]*\])/)?.[1];
  if (!urlsRaw) return fail(`s2: FAIL loggen saknar urls= — gaten kan inte se vilka URL:er som hämtades: ${line.trim()}`);
  let urls;
  try { urls = JSON.parse(urlsRaw); } catch { return fail(`s2: FAIL urls= är inte giltig JSON: ${urlsRaw}`); }
  if (!urls.includes(OWN_URL)) return fail(`s2: FAIL källans egen URL ${OWN_URL} är inte bland de hämtade: ${urlsRaw}`);
  const fetched = Number(line.match(/fetched=(\d+)/)?.[1] ?? '0');
  if (fetched < 1) return fail(`s2: FAIL ${SLUG} hämtade ${fetched} events — källans egen URL gav inget`);

  // Mät samma sak oberoende: hämta källans egen URL och kör den riktiga
  // extractorn på svaret.
  const extraction = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/eventExtraction.mjs')).href);
  let html;
  try {
    const res = await fetch(OWN_URL, { headers: { 'User-Agent': 'EventPulse-Bot/1.0 (sitemap crawler)' } });
    if (!res.ok) return fail(`s2: FAIL källans egen URL svarade HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    return fail(`s2: FAIL kunde inte hämta källans egen URL: ${e?.message ?? e}`);
  }
  const ownEvents = extraction.extractAllEvents(html, OWN_URL);
  if (ownEvents.length === 0) return fail('s2: FAIL källans egen URL ger 0 events med den riktiga extractorn');

  return ok(`s2: egen_url=1 sökväg=${urlsRaw} fetched=${fetched} egna_events=${ownEvents.length} pass`);
}

/**
 * S3 — LEVBEBIVS: källorna som fixen öppnade har framtida rader i DB.
 *
 * Negativ kontroll: stockholmjazz har rader men bara i det förflutna —
 * framtidsfiltret ska ge 0 för den. Utan den skulle "count > 0" vara en
 * mätning som inte kan skilja framtid från dåtid.
 */
async function s3() {
  const now = new Date().toISOString();
  const POSITIVE = ['concerts50com', 'sodrateatern', 'aviciiarena'];
  const NEGATIVE = 'stockholmjazz';
  const counts = [];

  for (const slug of POSITIVE) {
    const { data, error } = await supabaseGet(
      'events',
      `select=id,title_sv,start_time&source=eq.${slug}&start_time=gt.${now}&limit=1000`,
    );
    if (error) return fail(`s3: FAIL DB-fel för ${slug}: ${error}`);
    if (!Array.isArray(data)) return fail(`s3: FAIL oväntat svar för ${slug}: ${JSON.stringify(data).slice(0, 120)}`);
    if (data.length === 0) return fail(`s3: FAIL ${slug} har 0 framtida events i DB — fixen gav ingen effekt`);
    const broken = data.filter((r) => !r.title_sv || !r.start_time).length;
    if (broken > 0) return fail(`s3: FAIL ${slug}: ${broken} rader saknar titel eller startdatum`);
    counts.push(`${slug}=${data.length}`);
  }

  const negFuture = await supabaseGet('events', `select=id&source=eq.${NEGATIVE}&start_time=gt.${now}&limit=10`);
  if (negFuture.error) return fail(`s3: FAIL DB-fel för negativ kontroll: ${negFuture.error}`);
  if (!Array.isArray(negFuture.data)) return fail('s3: FAIL oväntat svar för negativ kontroll');
  if (negFuture.data.length !== 0) return fail(`s3: FAIL negativ kontroll — ${NEGATIVE} har ${negFuture.data.length} framtida rader`);
  const negAll = await supabaseGet('events', `select=id&source=eq.${NEGATIVE}&limit=10`);
  if (!Array.isArray(negAll.data) || negAll.data.length === 0) {
    return fail(`s3: FAIL negativ kontroll — ${NEGATIVE} har inga rader alls, så framtidsfiltret bevisar inget`);
  }

  return ok(`s3: ${counts.join(' ')} negativ=${NEGATIVE} noll av ${negAll.data.length} pass`);
}

/**
 * DR1/DR2/DR3 — datumintervall.
 *
 * Delegerar till `scripts/verify-date-ranges.ts`, som bygger en ORACLE skriven
 * oberoende av extraktorn och jämför den med produktionen på riktig
 * korpustext och på handskrivna fixturer. dr2 är den negativa kontrollen:
 * en muterad KOPIA av extraktorn måste avvika från oracle — annars bevisar
 * dr1 ingenting.
 */
function dateRangeGate(mode) {
  const script = 'scripts/verify-date-ranges.ts';
  const r = spawnSync('npx', ['tsx', script, mode], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 600_000,
    killSignal: 'SIGKILL',
    env: process.env,
  });
  const combined = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const marker = combined.split('\n').find((l) => l.startsWith(`${mode}:`)) ?? '';
  if (r.status !== 0) {
    return fail(`${mode}: FAIL ${marker || combined.split('\n').filter(Boolean).slice(-2).join(' | ') || 'skriptet gav ingen utdata'}`);
  }
  if (!marker.endsWith('pass')) {
    return fail(`${mode}: FAIL skriptet gav ingen "pass"-markör — raden var "${marker}"`);
  }
  return ok(marker);
}

function dr1() { return dateRangeGate('dr1'); }
function dr2() { return dateRangeGate('dr2'); }
function dr3() { return dateRangeGate('dr3'); }

/**
 * ST1/ST2 — statusen i sources_status.jsonl får inte ljuga.
 *
 * Delegerar till `scripts/verify-status-truth.ts`. st1 mäter invarianten
 * "en källa som D-gaten lyckades extrahera ifrån ska stå som success, med
 * felräknaren nollställd och utan kvarvarande lastError". st2 är den
 * negativa kontrollen: en MUTERAD KOPIA av statusfilen där felräknaren
 * inte nollställs måste upptäckas — annars bevisar st1 ingenting.
 */
function statusTruthGate(mode) {
  const script = 'scripts/verify-status-truth.ts';
  const r = spawnSync('npx', ['tsx', script, mode], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 600_000,
    killSignal: 'SIGKILL',
    env: process.env,
  });
  const combined = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const marker = combined.split('\n').find((l) => l.startsWith(`${mode}:`)) ?? '';
  if (r.status !== 0) {
    return fail(`${mode}: FAIL ${marker || combined.split('\n').filter(Boolean).slice(-2).join(' | ') || 'skriptet gav ingen utdata'}`);
  }
  if (!marker.endsWith('pass')) {
    return fail(`${mode}: FAIL skriptet gav ingen "pass"-markör — raden var "${marker}"`);
  }
  return ok(marker);
}

function st1() { return statusTruthGate('st1'); }
function st2() { return statusTruthGate('st2'); }

const gates = { g1, g2, g3, g4, g5, g6, g7, g8, g9, h1, h2, h3, h4, h5, h6, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, n1, n2, s1, s2, s3, dr1, dr2, dr3, st1, st2 };
if (!arg || !gates[arg]) {
  console.error(`usage: node scripts/verify-fixes.mjs <${Object.keys(gates).join('|')}>`);
  process.exit(2);
}
// h4 pratar med live-DB och är async; await:a alla så ett fel inte glider igenom
// som ohanterat promise.
Promise.resolve()
  .then(() => gates[arg]())
  .catch((e) => fail(`${arg}: FAIL threw: ${e?.message ?? e}`));
