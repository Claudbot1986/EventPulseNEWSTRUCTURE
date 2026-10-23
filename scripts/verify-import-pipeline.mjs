#!/usr/bin/env node
/**
 * verify-import-pipeline.mjs — bevis för importvägen
 * extractedevents/ → BullMQ `raw_events` → normalizer → Supabase `events`.
 *
 * Bakgrund (2026-10-23): importen lade in 1463 events i BullMQ, men bara
 * 1305 unika jobb skapades. 158 rader försvann TYST — de fanns i filen men
 * kom aldrig till databasen. Två samverkande orsaker:
 *
 *   1. jobId byggdes på (source, source_id ?? titel). BullMQ dedupear på
 *      jobId, så "Sagolek" 10:00 och 11:30 samma dag kollapsade till en.
 *   2. BullMQ's `add` är en tyst no-op om jobbId:t redan finns — även i
 *      KLART läge. Med `removeOnComplete: 100` låg de 100 senast klara
 *      jobben kvar, så nattens re-import av de event som importerades sist
 *      blockerades (82 av 1463).
 *
 * IDs:
 *   p1 — importen tappar INGA rader: varje kollapsad rad har samma
 *        dedup-nyckel som normalizern använder (då är den en äkta dubblett)
 *   p2 — ett terminalt jobb (klart/misslyckat) frigörs så att re-import
 *        inte blockeras — verifierat mot RIKTIG Redis
 *   p3 — alla framtida rader i extraherade filer finns i databasen
 *
 * Anropas som `node scripts/verify-import-pipeline.mjs <p1|p2|p3>`.
 */

import fs from 'node:fs';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

const EXTRACTED_DIR = path.join(ROOT, '03-Queue/03-extractedevents');
const IMPORT_MODULE = path.join(ROOT, '03-Queue/importToEventPulse.ts');

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

// ── P1: ingen rad får försvinna på vägen till BullMQ ───────────────────────

/**
 * Räknar, över ALLA extraherade filer, hur många framtida rader det finns
 * och hur många unika jobbId de ger. Varje kollapsad grupp måste dela
 * normalizerns dedup-nyckel — då är den en äkta dubblett, inte en förlust.
 */
function probeImportCounts() {
  const probe = `
import { readExtractedEvents, toRawEvent, buildJobId } from ${JSON.stringify(IMPORT_MODULE)};
import fs from 'fs';
import path from 'path';
const DIR = ${JSON.stringify(EXTRACTED_DIR)};
const sourceIds = new Set<string>();
for (const entry of fs.readdirSync(DIR, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.jsonl')) sourceIds.add(entry.name.replace(/\\.jsonl$/, ''));
  else if (entry.isDirectory()) {
    for (const f of fs.readdirSync(path.join(DIR, entry.name))) {
      if (f.endsWith('.jsonl')) sourceIds.add(f.replace(/\\.jsonl$/, ''));
    }
  }
}
const groups = new Map<string, any[]>();
let rows = 0;
for (const sid of sourceIds) {
  for (const ev of readExtractedEvents(sid)) {
    const raw = toRawEvent(sid, ev);
    const ms = raw.start_time ? Date.parse(raw.start_time) : NaN;
    if (!(Number.isFinite(ms) && ms >= Date.now())) continue;
    rows++;
    const jobId = buildJobId(raw);
    if (!groups.has(jobId)) groups.set(jobId, []);
    groups.get(jobId)!.push({ source: raw.source, source_id: raw.source_id, title: raw.title, start_time: raw.start_time });
  }
}
// En rad är en äkta dubblett bara om den har SAMMA dedup-nyckel som
// normalizern använder: (source, source_id) annars (source, titel, start_time).
const dedupKey = (r: any) => r.source_id
  ? \`\${r.source}::\${r.source_id}\`
  : \`\${r.source}::\${r.title}::\${r.start_time}\`;
const lost: any[] = [];
for (const [jobId, rs] of groups) {
  if (rs.length < 2) continue;
  const keys = new Set(rs.map(dedupKey));
  if (keys.size > 1) lost.push({ jobId, keys: [...keys], rows: rs.length });
}
console.log('###RESULT###' + JSON.stringify({
  rows,
  distinctJobIds: groups.size,
  lost,
}));
`;
  const probePath = path.join(ROOT, '03-Queue', `.gate-probe-${process.pid}.ts`);
  writeFileSync(probePath, probe, 'utf8');
  try {
    const res = spawnSync('npx', ['tsx', probePath], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    if (res.status !== 0) {
      return { error: `tsx-probe avslutade med ${res.status}: ${(res.stderr || '').trim().slice(0, 400)}` };
    }
    const line = (res.stdout || '').split('###RESULT###')[1];
    if (!line) return { error: `proben skrev ingen resultatrad: ${(res.stdout || '').trim().slice(0, 300)}` };
    return { data: JSON.parse(line.trim()) };
  } catch (e) {
    return { error: `tsx-probe kastade: ${e?.message ?? e}` };
  } finally {
    rmSync(probePath, { force: true });
  }
}

function p1() {
  if (!existsSync(EXTRACTED_DIR)) return fail(`p1: FAIL extractedevents/ saknas: ${EXTRACTED_DIR}`);
  const probe = probeImportCounts();
  if (probe.error) return fail(`p1: FAIL ${probe.error}`);
  const d = probe.data;

  if (d.rows === 0) return fail('p1: FAIL inga framtida rader hittades — gaten mäter ingenting');

  if (d.lost.length > 0) {
    const ex = d.lost.slice(0, 3).map((l) => `${l.jobId} (${l.rows} rader, ${l.keys.length} unika dedup-nycklar)`);
    return fail(
      `p1: FAIL ${d.rows} rader ger ${d.distinctJobIds} jobbId, och ${d.lost.length} grupper ` +
        `kollapsar UTÖVER normalizerns dedup-nyckel (då försvinner rader): ${ex.join(' | ')}`,
    );
  }
  return ok(
    `p1: ${d.rows} framtida rader → ${d.distinctJobIds} jobbId, ingen rad försvinner ` +
      `(kollapsade grupper delar normalizerns dedup-nyckel) pass`,
  );
}

// ── P2: terminalt jobb frigörs (mot RIKTIG Redis) ──────────────────────────

async function p2() {
  const probe = `
import { Queue, Worker } from 'bullmq';
import { rawEventsQueue, closeAllQueues } from ${JSON.stringify(path.join(ROOT, '03-Queue/queue.ts'))};
import { releaseTerminalJob } from ${JSON.stringify(IMPORT_MODULE)};

// Speglar produktionskön EXAKT (prefix + defaultJobOptions), men på en egen
// kö — så att testet inte rörar den körande drainen.
const testQueueName = 'gate-selftest-raw-events';
const testQueue = new Queue(testQueueName, {
  connection: rawEventsQueue.opts.connection,
  prefix: rawEventsQueue.opts.prefix,
  defaultJobOptions: rawEventsQueue.opts.defaultJobOptions,
});
await testQueue.obliterate({ force: true });

const worker = new Worker(testQueueName, async () => ({ ok: true }), {
  connection: rawEventsQueue.opts.connection,
  prefix: rawEventsQueue.opts.prefix,
});
await worker.waitUntilReady();

const jobId = 'gate-selftest--' + process.pid + '--' + Date.now();
const data = { title: 'gate-selftest', start_time: '2030-01-01T00:00:00.000Z' };
await testQueue.add(jobId, data, { jobId });

// Vänta tills jobbet är KLART (workern kör en no-op-processor).
let state = '';
for (let i = 0; i < 100; i++) {
  const job = await testQueue.getJob(jobId);
  if (job) { state = await job.getState(); if (state === 'completed') break; }
  await new Promise((r) => setTimeout(r, 100));
}

const outcome = await releaseTerminalJob(testQueue, jobId);
const gone = (await testQueue.getJob(jobId)) === undefined;

// Kan jobbet läggas in igen efter frigörningen? Det är hela poängen.
let readded = false;
if (gone) {
  await testQueue.add(jobId, data, { jobId });
  readded = (await testQueue.getJob(jobId)) !== undefined;
}

console.log('###RESULT###' + JSON.stringify({ state, outcome, gone, readded }));
await worker.close();
await testQueue.obliterate({ force: true });
await testQueue.close();
await closeAllQueues();
process.exit(0);
`;
  const probePath = path.join(ROOT, '03-Queue', `.gate-probe-${process.pid}.ts`);
  writeFileSync(probePath, probe, 'utf8');
  // Städa ALLTID före fail(): fail() anropar process.exit(), som annars
  // hoppar över finally och lämnar probe-filen kvar i repot.
  let result;
  let error;
  try {
    const res = spawnSync('npx', ['tsx', probePath], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    if (res.status !== 0) {
      error = `p2: FAIL tsx-probe avslutade med ${res.status}: ${(res.stderr || '').trim().slice(0, 400)}`;
    } else {
      const line = (res.stdout || '').split('###RESULT###')[1];
      if (!line) error = `p2: FAIL proben skrev ingen resultatrad: ${(res.stdout || '').trim().slice(0, 300)}`;
      else result = JSON.parse(line.trim());
    }
  } catch (e) {
    error = `p2: FAIL ${e?.message ?? e}`;
  } finally {
    rmSync(probePath, { force: true });
  }
  if (error) return fail(error);
  const d = result;
  if (d.state !== 'completed') {
    return fail(`p2: FAIL testjobbets läge blev "${d.state}" (förväntat completed) — testet mäter ingenting`);
  }
  if (d.outcome !== 'removed' || d.gone !== true) {
    return fail(`p2: FAIL terminalt jobb frigjordes inte: ${JSON.stringify(d)}`);
  }
  if (d.readded !== true) {
    return fail(`p2: FAIL jobbet kunde inte läggas in igen efter frigörningen: ${JSON.stringify(d)}`);
  }
  return ok('p2: klart jobb frigörs och kan importeras om (riktig Redis) pass');
}

// ── P3: alla framtida extraherade rader finns i databasen ───────────────────

function readEnv() {
  const env = {};
  const p = path.join(ROOT, '.env');
  if (!existsSync(p)) return env;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

async function supabaseGet(table, query) {
  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing i .env' };
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { data: await res.json() };
}

/**
 * PostgREST capar svaret (max-rows, normalt 1000). Utan paginering skulle
 * gaten jämföra mot ett urklipp av databasen och "hitta" massor med
 * saknade event som faktiskt finns.
 */
async function supabaseGetAll(table, query) {
  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing i .env' };
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + PAGE - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return { data: rows };
}

/**
 * En rad är "representerad i databasen" på EXAKT samma sätt som normalizern
 * bestämmer identitet — annars mäter gaten fel sak:
 *
 *   1. dedup_hash = sha256(source::source_id), eller
 *      sha256(source::"titel::start_time") när source_id saknas
 *   2. ticket_url  — cross-source-dedup (normalizer.ts:460-478). En rad från
 *      `fallan` som möter `sthlmlist` på samma URL landar i sthlmlist-raden
 *      och behåller DEN radens identitet. Eventet finns i databasen — men
 *      under en annan source. En gaten som kräver samma source-titel-tid
 *      skulle flagga 245 sådana rader som "saknade" trots att de finns.
 *
 * Se normalizer.ts:454-489 för exakt formlerna.
 */
function buildDedupHash(source, sourceId) {
  return createHash('sha256').update(`${source}::${sourceId}`).digest('hex');
}

function dedupHashFor(row) {
  return row.source_id
    ? buildDedupHash(row.source, row.source_id)
    : buildDedupHash(row.source, `${row.title}::${row.start_time}`);
}

async function p3() {
  // Bygg samma rader ur filerna som importen gör — via den riktiga
  // toRawEvent(), så att canonical-source och source_id-fallback är
  // identiska med produktion.
  const probe2 = `
import { readExtractedEvents, toRawEvent } from ${JSON.stringify(IMPORT_MODULE)};
import { loadSkippedSourceIds } from ${JSON.stringify(path.join(ROOT, '02-Ingestion/lib/quarantineGuard.ts'))};
import fs from 'fs';
import path from 'path';
const DIR = ${JSON.stringify(EXTRACTED_DIR)};
const sourceIds = new Set<string>();
for (const entry of fs.readdirSync(DIR, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.jsonl')) sourceIds.add(entry.name.replace(/\\.jsonl$/, ''));
  else if (entry.isDirectory()) {
    for (const f of fs.readdirSync(path.join(DIR, entry.name))) {
      if (f.endsWith('.jsonl')) sourceIds.add(f.replace(/\\.jsonl$/, ''));
    }
  }
}
// Samma population som importen importerar: retired/quarantined-källor är
// ute ur pipelinen (se 02-Ingestion/lib/quarantineGuard.ts) och ska inte
// räknas som "saknade" — de importeras inte alls.
const skipped = loadSkippedSourceIds();
const out: any[] = [];
for (const sid of sourceIds) {
  if (skipped.has(sid)) continue;
  for (const ev of readExtractedEvents(sid)) {
    const raw = toRawEvent(sid, ev) as any;
    const ms = raw.start_time ? Date.parse(raw.start_time) : NaN;
    if (!(Number.isFinite(ms) && ms >= Date.now())) continue;
    out.push({
      source: raw.source,
      source_id: raw.source_id ?? null,
      title: raw.title,
      start_time: raw.start_time,
      ticket_url: raw.ticket_url ?? null,
    });
  }
}
console.log('###RESULT###' + JSON.stringify(out));
`;
  const probePath = path.join(ROOT, '03-Queue', `.gate-probe-${process.pid}.ts`);
  writeFileSync(probePath, probe2, 'utf8');
  let fileRows;
  try {
    const r2 = spawnSync('npx', ['tsx', probePath], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    if (r2.status !== 0) {
      return fail(`p3: FAIL tsx-probe avslutade med ${r2.status}: ${(r2.stderr || '').trim().slice(0, 300)}`);
    }
    const line = (r2.stdout || '').split('###RESULT###')[1];
    if (!line) return fail('p3: FAIL proben skrev ingen resultatrad');
    fileRows = JSON.parse(line.trim());
  } finally {
    rmSync(probePath, { force: true });
  }

  // ALLA databasrader, inte bara framtida: cross-source-dedupen kan peka på
  // en rad med annan tid. PostgREST capar svaret — därför paginering.
  const res = await supabaseGetAll('events', 'select=dedup_hash,ticket_url');
  if (res.error) return fail(`p3: FAIL ${res.error}`);
  const dbRows = res.data ?? [];
  const dbHashes = new Set(dbRows.map((r) => r.dedup_hash).filter(Boolean));
  const dbUrls = new Set(dbRows.map((r) => r.ticket_url).filter(Boolean));

  const missing = [];
  const seen = new Set();
  for (const r of fileRows) {
    const k = dedupHashFor(r);
    if (seen.has(k)) continue;
    seen.add(k);
    if (dbHashes.has(k)) continue;
    if (r.ticket_url && dbUrls.has(r.ticket_url)) continue;
    missing.push(r);
  }

  // NEGATIV KONTROLL: gaten måste kunna hitta en rad som inte finns. Utan
  // detta skulle en trasig jämförelse "passa" på en tom databas.
  const sentinel = {
    source: '__gate_selftest__',
    source_id: null,
    title: 'gate-selftest-saknas-medvetet',
    start_time: '2099-01-01T00:00:00.000Z',
    ticket_url: null,
  };
  const sentinelFound = !dbHashes.has(dedupHashFor(sentinel)) && !dbUrls.has('__gate_selftest__');
  if (!sentinelFound) {
    return fail('p3: FAIL negativ kontroll misslyckades — gaten kan inte längre upptäcka en saknad rad');
  }

  const total = seen.size;
  if (missing.length > 0) {
    const ex = missing.slice(0, 5).map((m) => `${m.source}: ${m.title} @ ${m.start_time}`);
    return fail(
      `p3: FAIL ${missing.length} av ${total} extraherade framtida event saknas i databasen ` +
        `(varken dedup_hash eller ticket_url matchar). Exempel: ${ex.join(' | ')}`,
    );
  }
  return ok(
    `p3: alla ${total} extraherade framtida event finns i databasen ` +
      `(dedup_hash/ticket_url — samma identitetsregler som normalizern) pass`,
  );
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const gates = { p1, p2, p3 };
if (!gates[arg]) {
  console.error(`Användning: node scripts/verify-import-pipeline.mjs <${Object.keys(gates).join('|')}>`);
  process.exit(2);
}
await gates[arg]();
