#!/usr/bin/env node
/**
 * audit-source-coverage.mjs — mät per källa: ger den events, och var fastnar den?
 *
 * Läsverktyg. Ändrar ingenting i DB eller i filer (utom en audit-artefakt i
 * runtime/).
 *
 * Vyer per källa:
 *   dbEvents      — antal rader i Supabase.events med source=<id>
 *   extracted     — rader i 03-Queue/03-extractedevents/ (A/B/C/D + toppnivå)
 *   futureRows    — av extracted: antal rader med datum >= idag
 *   artifacts     — rader där venue/address är '[object Object]'
 *   undated       — rader med date 'unknown'/tomt
 *   status        — sista statusraden från runtime/sources_status.jsonl
 *   state         — live | retired | quarantined
 *
 * Utdata: runtime/source-coverage.json + en tabell på stdout.
 *
 * Användning:
 *   node scripts/audit-source-coverage.mjs
 *   node scripts/audit-source-coverage.mjs --only-zero      # bara källor utan events
 *   node scripts/audit-source-coverage.mjs --source globen-3
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXTRACTED_DIR = path.join(ROOT, '03-Queue/03-extractedevents');
const SOURCES_DIR = path.join(ROOT, 'sources');
const STATUS_FILE = path.join(ROOT, 'runtime/sources_status.jsonl');
const OUT_FILE = path.join(ROOT, 'runtime/source-coverage.json');

const args = process.argv.slice(2);
const ONLY_ZERO = args.includes('--only-zero');
const sourceIdx = args.indexOf('--source');
const ONLY_SOURCE = sourceIdx >= 0 ? args[sourceIdx + 1] : null;

const BAD = '[object Object]';

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonl(p) {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ── Källa: live / retired / quarantined ────────────────────────────────────

function listDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
}

const liveSources = new Map();
for (const f of listDir(SOURCES_DIR)) {
  const d = readJson(path.join(SOURCES_DIR, f));
  if (d?.id) liveSources.set(d.id, { ...d, state: 'live' });
}

function loadIndex(dir) {
  const p = path.join(dir, 'INDEX.json');
  const raw = readJson(p);
  return Array.isArray(raw) ? raw : [];
}

const retiredIndex = loadIndex(path.join(SOURCES_DIR, '_retired'));
const quarantinedIndex = loadIndex(path.join(SOURCES_DIR, '_quarantine'));
const stateById = new Map();
for (const e of retiredIndex) stateById.set(e.sourceId, 'retired');
for (const e of quarantinedIndex) stateById.set(e.sourceId, 'quarantined');

// ── Statusrad: sista per sourceId ─────────────────────────────────────────

const lastStatus = new Map();
for (const row of readJsonl(STATUS_FILE)) {
  const id = row.sourceId || row.source_id;
  if (!id) continue;
  const prev = lastStatus.get(id);
  const ts = row.timestamp || row.updatedAt || '';
  if (!prev || ts >= (prev.timestamp || prev.updatedAt || '')) lastStatus.set(id, row);
}

// ── Extraherade rader: A/B/C/D + toppnivå ─────────────────────────────────

/** Samlar rader per källa. Samma källa kan finnas i flera gate-mappar. */
function collectExtracted() {
  const bySource = new Map();
  const roots = [];
  if (existsSync(EXTRACTED_DIR)) {
    for (const name of readdirSync(EXTRACTED_DIR)) {
      const full = path.join(EXTRACTED_DIR, name);
      if (statSync(full).isDirectory()) {
        roots.push({ gate: name, dir: full });
      } else if (name.endsWith('.jsonl')) {
        roots.push({ gate: '_', dir: EXTRACTED_DIR, single: name });
      }
    }
  }

  const now = Date.now();
  for (const { gate, dir, single } of roots) {
    const files = single ? [single] : readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    for (const f of files) {
      const rows = readJsonl(path.join(dir, f));
      if (!rows.length) continue;
      const sourceId = f.replace(/\.jsonl$/, '');
      let agg = bySource.get(sourceId);
      if (!agg) {
        agg = { sourceId, rows: 0, futureRows: 0, artifacts: 0, undated: 0, gates: new Set() };
        bySource.set(sourceId, agg);
      }
      agg.gates.add(gate);
      for (const r of rows) {
        agg.rows++;
        const raw = r.raw_data || r.rawData || r;
        const venue = raw?.venue ?? raw?.venue_name ?? raw?.venueFullName ?? '';
        const addr = raw?.address ?? raw?.venue_address ?? raw?.venueFullAddress ?? '';
        if (String(venue) === BAD || String(addr) === BAD) agg.artifacts++;
        const d = raw?.date ?? raw?.start_time ?? raw?.startTime ?? r?.date;
        if (!d || d === 'unknown') {
          agg.undated++;
        } else {
          const t = new Date(d).getTime();
          if (!Number.isNaN(t) && t >= now) agg.futureRows++;
        }
      }
    }
  }
  return bySource;
}

const extracted = collectExtracted();

// ── DB: antal events per source ───────────────────────────────────────────

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

const env = readEnv();
const URL_BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error('FAIL: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing i .env');
  process.exit(2);
}
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function dbCounts() {
  const counts = new Map();
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const res = await fetch(`${URL_BASE}/rest/v1/events?select=source`, {
      headers: { ...HEADERS, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const chunk = await res.json();
    for (const row of chunk) {
      const s = row.source || '(null)';
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return counts;
}

const db = await dbCounts();

// ── Bygg raderna ───────────────────────────────────────────────────────────

const allIds = new Set([
  ...liveSources.keys(),
  ...stateById.keys(),
  ...extracted.keys(),
  ...lastStatus.keys(),
  ...db.keys(),
]);

const rows = [];
for (const id of allIds) {
  const live = liveSources.get(id);
  const ex = extracted.get(id);
  const st = lastStatus.get(id);
  const dbEvents = db.get(id) || 0;
  rows.push({
    sourceId: id,
    name: live?.name || st?.name || null,
    url: live?.url || null,
    state: live ? 'live' : stateById.get(id) || 'unknown',
    preferredPath: live?.preferredPath || null,
    dbEvents,
    extractedRows: ex?.rows || 0,
    futureRows: ex?.futureRows || 0,
    artifacts: ex?.artifacts || 0,
    undated: ex?.undated || 0,
    gates: ex ? [...ex.gates].sort() : [],
    status: st?.status || st?.state || null,
    statusAt: st?.lastRun || st?.timestamp || st?.updatedAt || null,
    lastEventsFound: st?.lastEventsFound ?? null,
    attempts: st?.attempts ?? null,
    routingReason: st?.lastRoutingReason || null,
    lastError: st?.error || st?.lastError || null,
  });
}

const selected = rows
  .filter((r) => (ONLY_SOURCE ? r.sourceId === ONLY_SOURCE : true))
  .filter((r) => (ONLY_ZERO ? r.dbEvents === 0 : true))
  .sort((a, b) => a.dbEvents - b.dbEvents || a.sourceId.localeCompare(b.sourceId));

// ── Rapport ────────────────────────────────────────────────────────────────

const liveRows = rows.filter((r) => r.state === 'live');
const liveZero = liveRows.filter((r) => r.dbEvents === 0);
const liveWithEvents = liveRows.filter((r) => r.dbEvents > 0);

console.log(`källor: ${rows.length} totalt | ${liveRows.length} live | ${retiredIndex.length} retired | ${quarantinedIndex.length} quarantined`);
console.log(`live med events i DB: ${liveWithEvents.length} | live UTAN events i DB: ${liveZero.length}`);
console.log(`DB events totalt: ${[...db.values()].reduce((a, b) => a + b, 0)}`);
console.log(`artefaktrader i extraherade filer: ${rows.reduce((s, r) => s + r.artifacts, 0)}`);
console.log(`rader utan datum i extraherade filer: ${rows.reduce((s, r) => s + r.undated, 0)}`);

console.log('\n=== LIVE UTAN EVENTS I DB ===');
console.log('sourceId\tstatus\textracted\tfuture\tundated\tartefakt\tpreferredPath\turl');
for (const r of liveZero) {
  console.log(
    [
      r.sourceId,
      r.status || '-',
      r.extractedRows,
      r.futureRows,
      r.undated,
      r.artifacts,
      r.preferredPath || '-',
      r.url || '-',
    ].join('\t'),
  );
}

if (!ONLY_ZERO) {
  console.log('\n=== ÖVERIGA LIVE KÄLLOR ===');
  console.log('sourceId\tdbEvents\tfuture\tundated\tartefakt\tgates\tstatus');
  for (const r of liveWithEvents) {
    console.log(
      [r.sourceId, r.dbEvents, r.futureRows, r.undated, r.artifacts, r.gates.join(','), r.status || '-'].join('\t'),
    );
  }
}

writeFileSync(
  OUT_FILE,
  JSON.stringify({ generatedAt: new Date().toISOString(), rows: selected }, null, 2) + '\n',
  'utf8',
);
console.log(`\nskrev ${OUT_FILE}`);
