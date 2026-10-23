#!/usr/bin/env node
/**
 * verify-confetti-chain.mjs — bevis för Confetti-kedjan:
 *
 *   Confetti-CMS-API → source-adapter → extractedevents/ → BullMQ → worker → Supabase
 *
 * Kedjan går genom fyra lager som tidigare varit åtskilda. Varje gate
 * mäter ETT lager och har en negativ kontroll — en kontroll som bara
 * kan passera är ingen kontroll.
 *
 * IDs:
 *   t1 — adaptern är registrerad och hittas explicit + automatiskt
 *   t2 — A-gatet körde adaptern (inte HTML-spåret) och fick events
 *   t3 — extractedevents/ innehåller rader som finns i Confetti-APIt
 *        (och inga upphittade titlar, och den uteslutna testeventet ute)
 *   t4 — raderna finns i Supabase `events` (och inga upphittade rader)
 *
 * Anropas som `node scripts/verify-confetti-chain.mjs <t1|t2|t3|t4>`.
 * Skriver ut `tN: <status> pass` på stdout vid PASS, annars `tN: FAIL …`
 * på stderr + exit 1. Utskriften matchas av GATES.md:s `EXPECT:`.
 */

import fs from 'node:fs';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

/** De två Confetti-källor som kopplats på. */
const CONFETTI_SOURCES = (process.env.CONFETTI_GATE_SOURCE_IDS ?? 'kungliga-musikhogskolan,founders-alliance')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Källa som medvetet INTE har någon adapter — negativ kontroll för t1/t2. */
const CONTROL_SOURCE = 'sthlmlist';

/**
 * Katalogerna gaten läser. Selftestet pekar om dem mot en tempkatalog så att
 * en trasig kopia kan provas UTAN att röra produktionsfilerna.
 */
const DIRS = {
  extracted: process.env.CONFETTI_GATE_EXTRACTED_DIR ?? path.join(ROOT, '03-Queue/03-extractedevents'),
  sources: process.env.CONFETTI_GATE_SOURCES_DIR ?? path.join(ROOT, 'sources'),
  status: process.env.CONFETTI_GATE_STATUS_FILE ?? path.join(ROOT, 'runtime/sources_status.jsonl'),
  adapterIndex:
    process.env.CONFETTI_GATE_ADAPTER_INDEX ??
    path.join(ROOT, '02-Ingestion/A-directAPI-networkGate/adapters/index.ts'),
  normalizer:
    process.env.CONFETTI_GATE_NORMALIZER ?? path.join(ROOT, '04-Normalizer/normalizer.ts'),
};

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

// ── Hjälpare ────────────────────────────────────────────────────────────────

function readEnvFile() {
  const out = {};
  if (!fs.existsSync(path.join(ROOT, '.env'))) return out;
  for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
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

/** Läs source-filen (sources/<id>.jsonl) — sanning om hur källan är konfigurerad. */
function readSourceFile(sourceId) {
  const p = path.join(DIRS.sources, `${sourceId}.jsonl`);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf8').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Sista statusraden per källa ur runtime/sources_status.jsonl. */
function readSourceStatuses() {
  const p = DIRS.status;
  if (!existsSync(p)) return new Map();
  const byId = new Map();
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row?.sourceId) byId.set(row.sourceId, row);
    } catch { /* trasig rad ska inte fälla gaten */ }
  }
  return byId;
}

/** Raderna i 03-Queue/03-extractedevents/<sourceId>.jsonl. */
function readExtractedRows(sourceId) {
  const p = path.join(DIRS.extracted, `${sourceId}.jsonl`);
  if (!existsSync(p)) return null;
  const rows = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* hoppa över trasiga rader */ }
  }
  return rows;
}

/** Live-Confetti-API för en källa — används för att bevisa att inget upphittats. */
async function fetchConfettiApi(host) {
  const url = `https://${host}/common/api/events?locale=sv`;
  const res = await fetch(url);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const body = await res.json();
  const events = Array.isArray(body?.events) ? body.events : [];
  return { events, total: events.length };
}

/** Kör ett tsx-eval mot den riktiga adapter-registret. */
function probeAdapterRegistry() {
  const dir = mkdtempSync(path.join(tmpdir(), 'eventpulse-adapter-probe-'));
  const probePath = path.join(dir, 'probe.ts');
  const adapterIndex = DIRS.adapterIndex;
  writeFileSync(probePath, `
import { findAdapterForSource, listApiAdapters } from ${JSON.stringify(adapterIndex)};
const probes = {
  explicit: { url: 'https://www.kmh.se', metadata: { sourceAdapter: 'confetti' } },
  auto: { url: 'https://kmh.confetti.events', metadata: {} },
  unknownAdapter: { url: 'https://www.kmh.se', metadata: { sourceAdapter: 'no-such-adapter' } },
  nonConfettiHost: { url: 'https://www.example.com/events', metadata: {} },
};
const out: Record<string, unknown> = { adapters: listApiAdapters() };
for (const [k, v] of Object.entries(probes)) {
  const m = findAdapterForSource(v as any);
  out[k] = m ? { adapter: m.adapter.name, mode: m.mode } : null;
}
console.log(JSON.stringify(out));
`, 'utf8');
  try {
    const res = spawnSync('npx', ['tsx', probePath], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    if (res.status !== 0) {
      return { error: `tsx-probe avslutade med ${res.status}: ${(res.stderr || '').trim().slice(0, 300)}` };
    }
    const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
    return { data: JSON.parse(line) };
  } catch (e) {
    return { error: `tsx-probe kastade: ${e?.message ?? e}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── T1: adapter-registret ───────────────────────────────────────────────────

function t1() {
  const probe = probeAdapterRegistry();
  if (probe.error) return fail(`t1: FAIL ${probe.error}`);
  const d = probe.data;

  if (!Array.isArray(d.adapters) || !d.adapters.includes('confetti')) {
    return fail(`t1: FAIL 'confetti' finns inte i registret (${JSON.stringify(d.adapters)})`);
  }
  if (d.explicit?.adapter !== 'confetti' || d.explicit?.mode !== 'explicit') {
    return fail(`t1: FAIL explicit-adapter inte hittad: ${JSON.stringify(d.explicit)}`);
  }
  if (d.auto?.adapter !== 'confetti' || d.auto?.mode !== 'auto') {
    return fail(`t1: FAIL auto-adapter (värdmatchning) inte hittad: ${JSON.stringify(d.auto)}`);
  }
  // Negativ kontroll 1: en adapter som inte finns → ingen matchning (HTML-fallback).
  if (d.unknownAdapter !== null) {
    return fail(`t1: FAIL negativ kontroll: okänd adapter matchade (${JSON.stringify(d.unknownAdapter)})`);
  }
  // Negativ kontroll 2: en icke-Confetti-värd ska inte matcha.
  if (d.nonConfettiHost !== null) {
    return fail(`t1: FAIL negativ kontroll: icke-Confetti-värd matchade (${JSON.stringify(d.nonConfettiHost)})`);
  }
  return ok(
    `t1: adapter 'confetti' registrerad, värdmatchning: explicit+auto pass ` +
    `(negativ kontroll: okänd adapter och icke-Confetti-värd matchade inte)`,
  );
}

// ── T2: A-gatet körde adaptern ──────────────────────────────────────────────

function t2() {
  const statuses = readSourceStatuses();
  if (statuses.size === 0) {
    return fail('t2: FAIL runtime/sources_status.jsonl saknas eller är tom — ingen A-körning att mäta');
  }

  for (const id of CONFETTI_SOURCES) {
    const s = statuses.get(id);
    if (!s) return fail(`t2: FAIL källan "${id}" finns inte i sources_status — A-gatet körde den aldrig`);
    if (s.lastPathUsed !== 'api' || s.preferredPath !== 'api') {
      return fail(
        `t2: FAIL "${id}" körde inte API-spået ` +
        `(lastPathUsed=${s.lastPathUsed}, preferredPath=${s.preferredPath})`,
      );
    }
    if (s.status !== 'success') {
      return fail(`t2: FAIL "${id}" har status=${s.status} (consecutiveFailures=${s.consecutiveFailures})`);
    }
    if (!Number.isFinite(s.lastEventsFound) || s.lastEventsFound <= 0) {
      return fail(`t2: FAIL "${id}" rapporterar lastEventsFound=${s.lastEventsFound} — adaptern gav inga events`);
    }
  }

  // Negativ kontroll: i samma fil ska det FINNAS källor som INTE körde API-spået.
  // Annars kan fältet 'api' vara värdet för alla rader och gaten mäter ingenting.
  const nonApi = [...statuses.values()].filter((s) => s.lastPathUsed !== 'api');
  if (nonApi.length === 0) {
    return fail('t2: FAIL negativ kontroll: ingen källa i sources_status har lastPathUsed != "api" — gaten kan inte skilja');
  }
  const control = statuses.get(CONTROL_SOURCE);
  if (control && control.lastPathUsed === 'api') {
    return fail(`t2: FAIL negativ kontroll: kontrollkällan "${CONTROL_SOURCE}" körde api-spået`);
  }
  return ok(
    `t2: A-gatet körde API-adaptern för ${CONFETTI_SOURCES.length} Confetti-källor ` +
    `(${CONFETTI_SOURCES.map((id) => `${id}:${statuses.get(id).lastEventsFound}`).join(', ')} events) pass ` +
    `(negativ kontroll: ${nonApi.length} andra källor körde INTE api-spået)`,
  );
}

// ── T3: extractedevents/ — inga upphittade event, filtren gör faktiskt arbete ─

/**
 * Replikerar stadsmatchningen i confetti-adaptern (name/venue/any).
 * Speglar `matchesCity` i adapters/confetti.ts — filterlogiken ska vara
 * densamma i adaptern och i kontrollen, annars mäter gaten något annat.
 */
function matchesCity(ev, city, mode) {
  const needle = city.toLowerCase();
  const name = typeof ev?.name === 'string' ? ev.name.toLowerCase() : '';
  const venue = typeof ev?.copy?.locationName === 'string' ? ev.copy.locationName.toLowerCase() : '';
  if (mode === 'name') return name.includes(needle);
  if (mode === 'venue') return venue.includes(needle);
  return name.includes(needle) || venue.includes(needle);
}

async function t3() {
  const now = Date.now();
  let sourcesWithExclusion = 0;
  let sourcesWithCityFilter = 0;
  const summary = [];

  for (const id of CONFETTI_SOURCES) {
    const rows = readExtractedRows(id);
    if (rows === null) return fail(`t3: FAIL extractedevents/${id}.jsonl saknas — A-gatet skrev inga rader`);
    if (rows.length === 0) return fail(`t3: FAIL extractedevents/${id}.jsonl är tom`);

    for (const r of rows) {
      if (!r.title || typeof r.title !== 'string') {
        return fail(`t3: FAIL "${id}" har en rad utan titel — ${JSON.stringify(r).slice(0, 160)}`);
      }
      if (!r.start_time || Number.isNaN(Date.parse(r.start_time))) {
        return fail(`t3: FAIL "${id}" har en rad med ogiltig start_time: ${JSON.stringify(r.start_time)}`);
      }
      if (Date.parse(r.start_time) < now) {
        return fail(`t3: FAIL "${id}" har ett event i det förflutna: ${r.title} ${r.start_time}`);
      }
      if (!r.source_id) {
        return fail(`t3: FAIL "${id}" har en rad utan source_id — kan inte matcha raden mot Confetti-APIt`);
      }
    }

    const source = readSourceFile(id);
    const cfg = source?.metadata?.confetti;
    const host = cfg?.host;
    if (!host) {
      return fail(`t3: FAIL "${id}" saknar metadata.confetti.host — gaten vet inte vad som ska jämföras`);
    }
    const api = await fetchConfettiApi(host);
    if (api.error) return fail(`t3: FAIL Confetti-API för ${host} svarade med ${api.error}`);

    const apiById = new Map();
    for (const ev of api.events) {
      const key = String(ev?.id ?? ev?.slug ?? '').trim();
      if (key) apiById.set(key, ev);
    }

    // 1. Ingen uppfinning: varje rad i filen måste finnas i API:et.
    for (const r of rows) {
      if (!apiById.has(String(r.source_id))) {
        return fail(
          `t3: FAIL "${id}" har en rad som INTE finns i Confetti-APIt ` +
          `(source_id=${r.source_id}, titel="${r.title}") — något har uppfunnits`,
        );
      }
    }

    // 2. Framtidsfilter + uteslutning + stadsmatchning → vilka slugs som BÖR finnas.
    const excludedTitles = new Set((cfg.excludeTitles ?? []).map((t) => String(t).trim().toLowerCase()));
    const future = api.events.filter((ev) => {
      const sd = ev?.startDate;
      return typeof sd === 'string' && !Number.isNaN(Date.parse(sd)) && Date.parse(sd) >= now;
    });
    const notExcluded = future.filter((ev) => !excludedTitles.has(String(ev?.name ?? '').trim().toLowerCase()));
    const cityFiltered = cfg.city
      ? notExcluded.filter((ev) => matchesCity(ev, cfg.city, cfg.cityMatch ?? 'any'))
      : notExcluded;

    // 3. Fullständighet: filen ska ha exakt de slugs som adapterns filter ger.
    const expectedIds = new Set(cityFiltered.map((ev) => String(ev?.id ?? ev?.slug ?? '')));
    const fileIds = new Set(rows.map((r) => String(r.source_id)));
    for (const id2 of fileIds) {
      if (!expectedIds.has(id2)) {
        return fail(
          `t3: FAIL "${id}" har raden "${id2}" som adapterns filter INTE ger — ` +
          'filen innehåller något som inte borde vara med',
        );
      }
    }
    for (const missing of expectedIds) {
      if (!fileIds.has(missing)) {
        const ev = apiById.get(missing);
        return fail(
          `t3: FAIL "${id}" saknar eventet "${ev?.name ?? missing}" (source_id=${missing}) — ` +
          'adaptern tappade ett event som Confetti-APIt har (A-gaten behöver köras om)',
        );
      }
    }

    // 4. Negativ kontroll för uteslutningen: den uteslutna titeln FANNS i API:et.
    if (excludedTitles.size > 0) {
      sourcesWithExclusion++;
      for (const ex of excludedTitles) {
        const inApi = api.events.some((ev) => String(ev?.name ?? '').trim().toLowerCase() === ex);
        if (!inApi) {
          return fail(
            `t3: FAIL negativ kontroll: "${ex}" finns inte i Confetti-APIt — uteslutningen är tom, gaten mäter ingenting`,
          );
        }
        const inFile = rows.some((r) => String(r.title).trim().toLowerCase() === ex);
        if (inFile) {
          return fail(`t3: FAIL "${id}" innehåller den uteslutna titeln "${ex}"`);
        }
      }
    }

    // 5. Negativ kontroll för stadfiltret: filteret måste utesluta något.
    if (cfg.city) {
      sourcesWithCityFilter++;
      const dropped = notExcluded.length - cityFiltered.length;
      if (dropped <= 0) {
        return fail(
          `t3: FAIL negativ kontroll: stadfiltret "${cfg.city}" (${cfg.cityMatch ?? 'any'}) utesluter 0 events ` +
          'i Confetti-APIt — filtret mäter ingenting',
        );
      }
    }

    summary.push(`${id}:${rows.length}`);
  }

  if (sourcesWithExclusion === 0) {
    return fail('t3: FAIL negativ kontroll: ingen källa har excludeTitles — uteslutningskontrollen är tom');
  }
  if (sourcesWithCityFilter === 0) {
    return fail('t3: FAIL negativ kontroll: ingen källa har ett stadfilter — filterkontrollen är tom');
  }
  return ok(
    `t3: extractedevents matchar Confetti-APIt rad för rad (${summary.join(', ')} rader) pass ` +
    `(negativ kontroll: uteslutet testevent fanns i API:et, stadfiltret utesluter events)`,
  );
}

// ── T4: Supabase events ─────────────────────────────────────────────────────

async function t4() {
  // Negativ kontroll först: en källa som inte finns ska ge 0 rader.
  const control = await supabaseGet('events', 'select=id&source=eq.__confetti_gate_control__');
  if (control.error) return fail(`t4: FAIL kontrollfrågan mot Supabase misslyckades: ${control.error}`);
  if ((control.data ?? []).length !== 0) {
    return fail('t4: FAIL negativ kontroll: kontrollkällan gav rader — frågan mäter ingenting');
  }

  const counts = [];
  for (const id of CONFETTI_SOURCES) {
    const rows = readExtractedRows(id);
    if (rows === null) return fail(`t4: FAIL extractedevents/${id}.jsonl saknas — kan inte jämföra med databasen`);

    const res = await supabaseGet('events', `select=id,title_sv,start_time&source=eq.${encodeURIComponent(id)}`);
    if (res.error) return fail(`t4: FAIL Supabase-fråga för "${id}" misslyckades: ${res.error}`);
    const dbRows = res.data ?? [];
    if (dbRows.length === 0) {
      return fail(`t4: FAIL "${id}" har 0 rader i events — kedjan når inte databasen`);
    }
    const fileTitles = new Set(rows.map((r) => String(r.title).trim()));
    for (const row of dbRows) {
      const title = String(row.title_sv ?? '').trim();
      if (!title) return fail(`t4: FAIL "${id}" har en rad i databasen utan titel`);
      if (!fileTitles.has(title)) {
        return fail(`t4: FAIL "${id}" har en databasrad som INTE finns i extractedevents: "${title}"`);
      }
    }
    // Databasen får inte ha fler rader än filen (datumvakten kan ta bort, inte lägga till).
    if (dbRows.length > rows.length) {
      return fail(`t4: FAIL "${id}" har ${dbRows.length} rader i databasen men ${rows.length} i extractedevents`);
    }
    counts.push(`${id}:${dbRows.length}`);
  }
  return ok(
    `t4: events finns i Supabase (${counts.join(', ')} rader) pass ` +
    `(negativ kontroll: okänd källa gav 0 rader)`,
  );
}

// ── T6: normalizer skriver venue_full_* på event-raden ─────────────────────
//
// 2026-10-23 — Upptäckt medan Confetti-kedjan verifierades: normalizer
// skrev ALDRIG venue_full_name/address/city på events-raden. HomeScreen läser
// venue_full_name direkt från events (ingen join mot venues), så allt som
// gått via BullMQ-kön visades UTAN plats i appen. Mätt: 464 events hade
// venue_id men venue_full_name = NULL.
//
// Gaten mäter två saker:
//   1. Struktur: normalizer.ts skriver venue_full_* från den resolvade
//      venue-raden (och vägrar "[object Object]" som platsnamn).
//   2. Läge: varje rad med venue_id har också ett venue_full_name.

/** Finns venue_full_-skrivningarna i normalizer-källan? */
function normalizerWritesVenueFields(source) {
  return (
    /venue_full_name:\s*venueFullName/.test(source) &&
    /venue_full_address:\s*venueFullAddress/.test(source) &&
    /venue_city:\s*venueFullCity/.test(source) &&
    /isValidVenueName\(raw\.venue_name\)/.test(source)
  );
}

async function t6() {
  const normalizerPath = DIRS.normalizer;
  if (!existsSync(normalizerPath)) return fail('t6: FAIL 04-Normalizer/normalizer.ts saknas');
  const source = readFileSync(normalizerPath, 'utf8');
  if (!normalizerWritesVenueFields(source)) {
    return fail('t6: FAIL normalizer skriver inte venue_full_name/address/city från venue-raden');
  }

  // Negativ kontroll: samma kontroll mot en kopia UTAN venue_full_-raderna
  // MÅSTE underkännas — annars mäter strukturchecken ingenting.
  const stripped = source.replace(/^\s*venue_full_(name|address|city):.*$/gm, '');
  if (normalizerWritesVenueFields(stripped)) {
    return fail('t6: FAIL negativ kontroll: kontrollen godkänner en normalizer utan venue_full_-rader');
  }

  // Läge i databasen: varje rad med venue_id ska ha ett venue_full_name.
  const counts = [];
  for (const id of CONFETTI_SOURCES) {
    const res = await supabaseGet(
      'events',
      `select=id,venue_id,venue_full_name&source=eq.${encodeURIComponent(id)}`,
    );
    if (res.error) return fail(`t6: FAIL Supabase-fråga för "${id}" misslyckades: ${res.error}`);
    const rows = res.data ?? [];
    if (rows.length === 0) return fail(`t6: FAIL "${id}" har 0 rader i events`);
    const linked = rows.filter((r) => r.venue_id);
    const named = linked.filter((r) => String(r.venue_full_name ?? '').trim().length > 0);
    if (linked.length === 0) {
      return fail(`t6: FAIL "${id}" har 0 events med venue_id — gaten mäter ingenting`);
    }
    if (named.length !== linked.length) {
      return fail(
        `t6: FAIL "${id}": ${named.length}/${linked.length} events med venue_id saknar venue_full_name`,
      );
    }
    counts.push(`${id}:${named.length}/${linked.length}`);
  }
  return ok(
    `t6: normalizer skriver venue_full_* och raderna har plats (${counts.join(', ')}) pass ` +
    `(negativ kontroll: kopia utan venue_full_-rader underkändes)`,
  );
}

const gates = { t1, t2, t3, t4, t6 };

// ── Selftest: bevisa att gaten kan FAIL:a ───────────────────────────────────
//
// "En gata som inte kan falla bevisar ingenting." Selftestet kör de riktiga
// gaterna mot en medvetet trasig kopia i en tempkatalog och kräver att de
// fallerar. Productionfiler rörs inte.

/** Kör en gate i en child-process med givna env-Overrides. */
function runGate(gateId, env) {
  const res = spawnSync('node', [fileURLToPath(import.meta.url), gateId], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, ...env },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function selftest() {
  const dir = mkdtempSync(path.join(tmpdir(), 'eventpulse-confetti-selftest-'));
  try {
    const extractedDir = path.join(dir, 'extracted');
    const sourcesDir = path.join(dir, 'sources');
    fs.mkdirSync(extractedDir, { recursive: true });
    fs.mkdirSync(sourcesDir, { recursive: true });

    // Kopiera de två källorna — filer som en A-körning faktiskt skrev.
    for (const id of CONFETTI_SOURCES) {
      const src = path.join(DIRS.extracted, `${id}.jsonl`);
      if (!existsSync(src)) return fail('selftest: FAIL ingen extractedevents att kopiera — kan inte bevisa något');
      writeFileSync(path.join(extractedDir, `${id}.jsonl`), readFileSync(src, 'utf8'), 'utf8');
      const srcFile = path.join(DIRS.sources, `${id}.jsonl`);
      if (existsSync(srcFile)) {
        writeFileSync(path.join(sourcesDir, `${id}.jsonl`), readFileSync(srcFile, 'utf8'), 'utf8');
      }
    }

    // Korruptera EN rad: byt source_id mot en slug som inte finns i Confetti-APIt.
    const victim = path.join(extractedDir, `${CONFETTI_SOURCES[0]}.jsonl`);
    const rows = readFileSync(victim, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    rows[0].source_id = 'fake-slug-som-finns-i-inget-api';
    writeFileSync(victim, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const env = {
      CONFETTI_GATE_EXTRACTED_DIR: extractedDir,
      CONFETTI_GATE_SOURCES_DIR: sourcesDir,
    };

    // 1. t3 mot den korrupterade kopian MÅSTE fallera.
    const t3run = runGate('t3', env);
    if (t3run.status === 0) {
      return fail('selftest: FAIL t3 PASSADE mot en fil med en uppfunnen rad — gaten har ingen tänder');
    }
    if (!/uppfunnits|INTE finns i Confetti-APIt/.test(t3run.stderr + t3run.stdout)) {
      return fail(`selftest: FAIL t3 fallerade av fel skäl: ${(t3run.stderr || '').trim().slice(0, 200)}`);
    }

    // 2. t3 mot en källa som INTE finns MÅSTE fallera (fil saknas).
    const missing = runGate('t3', { ...env, CONFETTI_GATE_SOURCE_IDS: 'kungliga-musikhogskolan,no-such-source' });
    if (missing.status === 0) {
      return fail('selftest: FAIL t3 PASSADE för en källa utan extractedevents-fil — gaten mäter ingenting');
    }

    // 3. t1 mot en adapter-index som inte finns MÅSTE fallera.
    const brokenIndex = runGate('t1', { CONFETTI_GATE_ADAPTER_INDEX: path.join(dir, 'no-such-index.ts') });
    if (brokenIndex.status === 0) {
      return fail('selftest: FAIL t1 PASSADE utan adapter-registret — gaten mäter ingenting');
    }

    // 4. t4 mot en källa som inte finns i databasen MÅSTE fallera.
    const noRows = runGate('t4', { CONFETTI_GATE_SOURCE_IDS: 'kungliga-musikhogskolan,no-such-source' });
    if (noRows.status === 0) {
      return fail('selftest: FAIL t4 PASSADE för en källa som inte finns i databasen — gaten mäter ingenting');
    }

    // 5. t6 mot en normalizer KOPiad utan venue_full_-raderna MÅSTE fallera.
    const realNormalizer = path.join(DIRS.normalizer);
    if (!existsSync(realNormalizer)) {
      return fail('selftest: FAIL normalizer-källan saknas — kan inte bevisa att t6 kan faila');
    }
    const strippedNormalizer = path.join(dir, 'normalizer-stripped.ts');
    writeFileSync(
      strippedNormalizer,
      readFileSync(realNormalizer, 'utf8').replace(/^\s*venue_full_(name|address|city):.*$/gm, ''),
      'utf8',
    );
    const noVenue = runGate('t6', { CONFETTI_GATE_NORMALIZER: strippedNormalizer });
    if (noVenue.status === 0) {
      return fail('selftest: FAIL t6 PASSADE mot en normalizer utan venue_full_-rader — gaten mäter ingenting');
    }

    return ok(
      'selftest: gaterna kan faila pass ' +
      '(t3 upphittad rad, t3 saknad fil, t1 saknat register, t4 källa utan rader, t6 normalizer utan venue-fält — alla föll som de ska)',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

gates.selftest = selftest;

if (!arg || !gates[arg]) {
  console.error(`usage: node scripts/verify-confetti-chain.mjs <${Object.keys(gates).join('|')}>`);
  process.exit(2);
}
Promise.resolve()
  .then(() => gates[arg]())
  .catch((e) => fail(`${arg}: FAIL threw: ${e?.message ?? e}`));
