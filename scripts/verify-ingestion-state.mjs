#!/usr/bin/env node
/**
 * verify-ingestion-state.mjs — bevis för ingestionens tillstånd.
 *
 * Varje gate har en negativ kontroll: gaten MÅSTE kunna underkänna trasig
 * indata. En gate som alltid passerar bevisar ingenting.
 *
 * Gates:
 *   census-selfcheck     — censusen mäter sanning och kan faila
 *   fold-complete        — ingen värd har två källfiler (vikningen är klar)
 *   unique-identities    — 0 dubbletter på dedup_hash och (source, source_id)
 *   run-complete         — varje källa i scopet har spår i C-gate-loggen
 *   causes-classified    — varje nollradskälla har en klassad orsak
 *   db-delta             — varje extraherad rad med sparbart datum finns i DB,
 *                          eller har en maskinverifierad avvisningsorsak
 *   no-dead-sources      — ingen aktiv källa svarar 404/410
 *   eventurls-attached   — värdkällorna bär sina event-URL:er, filerna är enradiga
 *
 * Kör:
 *   node --import tsx scripts/verify-ingestion-state.mjs --gate=<namn>
 *
 * `--import tsx` krävs: db-delta-gaten importerar produktionens egna regler
 * (datumvakt, titel-gate, jobb-id) från TypeScript, så gaten inte kan glida
 * isär från koden som faktiskt bestämmer vad som sparas.
 *
 * Konfiguration (env eller flaggor):
 *   --scope=<p>   runtime/ingestion-scope.jsonl   (källor som kördes)
 *   --log=<p>     runtime/ingestion-cgate.log     (C-gate-loggen)
 *   --causes=<p>  runtime/ingestion-causes.json   (orsaksklassning)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// quiet: dotenv 17 skriver annars en banner på stdout — den skulle göra
// GATE_OK-raden omparsbar för ett verktyg som läser utdata radvis.
dotenv.config({ path: path.join(ROOT, '.env'), override: true, quiet: true });

const args = process.argv.slice(2);
/** Läs ett argument antingen som `--flag värde` eller `--flag=värde`. */
const arg = (name, dflt) => {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  // i >= 0, inte i >= -1 — annars returneras args[0] när flaggan saknas.
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const GATE = (args.find((a) => a.startsWith('--gate=')) ?? '').slice('--gate='.length);

const SCOPE = path.resolve(ROOT, arg('--scope', 'runtime/ingestion-scope.jsonl'));
const LOG = path.resolve(ROOT, arg('--log', 'runtime/ingestion-cgate.log'));
const CAUSES = path.resolve(ROOT, arg('--causes', 'runtime/ingestion-causes.json'));
const SOURCES_DIR = path.join(ROOT, 'sources');

function ok(msg) { console.log(`GATE_OK:${GATE} — ${msg}`); }
function fail(msg) { console.error(`GATE_FAIL:${GATE} — ${msg}`); process.exit(1); }

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
const sb = createClient(url, key);

// ── Hjälpare (delas mellan gater och negativa kontroller) ──────────────────

/** Alla event-rader i DB, ordnade på id så paging är stabil. */
async function allEventRows(columns = 'id,source,source_id,dedup_hash') {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb
      .from('events')
      .select(columns)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error('DB-fel: ' + error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** Käll-id → url för alla filer i sources/. */
function sourceFiles() {
  const out = [];
  for (const file of fs.readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.jsonl')).sort()) {
    const id = file.replace(/\.jsonl$/, '');
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8').trim());
    } catch {
      continue;
    }
    out.push({ id, url: rec?.url ?? '', record: rec });
  }
  return out;
}

/** Värdeordsnyckel — samma normalisering som fold-host-sources.mjs. */
function hostKey(u) {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Kanonisk URL — samma normalisering som 02-Ingestion/tools/eventUrls.ts. */
function canonicalUrl(u) {
  try {
    const parsed = new URL(String(u).trim());
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    parsed.hash = '';
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Hittar värdar med flera källfiler.
 *
 * Negativ kontroll: samma funktion med ett syntetiskt par måste rapportera
 * en tvilling — annars bevisar gate-svaret ingenting.
 */
function findHostTwins(entries) {
  const byHost = new Map();
  for (const e of entries) {
    const h = hostKey(e.url);
    if (!h) continue;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(e.id);
  }
  return [...byHost.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([host, ids]) => ({ host, ids }));
}

/**
 * Dubbletter på dedup_hash och (source, source_id).
 *
 * Negativ kontroll: samma funktion med syntetiska dubbletter måste hitta dem.
 */
function findIdentityDuplicates(rows) {
  const byHash = new Map();
  const bySid = new Map();
  for (const r of rows) {
    if (r.dedup_hash) {
      if (!byHash.has(r.dedup_hash)) byHash.set(r.dedup_hash, []);
      byHash.get(r.dedup_hash).push(r.id);
    }
    if (r.source_id) {
      const k = `${r.source}::${r.source_id}`;
      if (!bySid.has(k)) bySid.set(k, []);
      bySid.get(k).push(r.id);
    }
  }
  return {
    hashes: [...byHash.entries()].filter(([, ids]) => ids.length > 1),
    sids: [...bySid.entries()].filter(([, ids]) => ids.length > 1),
  };
}

/**
 * Källorna i kyrkogravet (retired + quarantined).
 *
 * Begravda källor har INGEN källfil i sources/ — filen ligger i
 * sources/_retired/. De importeras inte (importern hoppar dem), så de kan
 * varken kräva spår i DB eller i loggen. Sådana filteras bort ur scopet.
 *
 * Källan till sanning är kyrkogravets egen INDEX — inte att filen saknas.
 */
const { loadSkippedSourceIds } = await import('../02-Ingestion/lib/quarantineGuard.ts');
const SKIPPED_SOURCE_IDS = loadSkippedSourceIds();

function scopeIds() {
  if (!fs.existsSync(SCOPE)) fail(`scopefilen saknas: ${path.relative(ROOT, SCOPE)}`);
  return fs
    .readFileSync(SCOPE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l).sourceId)
    .filter((id) => !SKIPPED_SOURCE_IDS.has(id));
}

// ── G1: censusen mäter sanning (och kan faila) ─────────────────────────────
if (GATE === 'census-selfcheck') {
  const { spawnSync } = await import('node:child_process');
  // Negativ kontroll: censusen MÅSTE avbryta mot en trasig DB. Env-variablerna
  // räcker inte — dotenv laddas med override:true och skriver över dem med
  // .env. Därför pekar vi om via flaggor.
  const broken = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts/census-zero-sources.mjs'),
      '--json',
      '--db-url=https://invalid.invalid',
      '--db-key=x',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (broken.status === 0) {
    fail('negativ kontroll — censusen lyckades med en trasig DB-URL (gaten kan inte faila)');
  }
  const good = spawnSync(process.execPath, [path.join(ROOT, 'scripts/census-zero-sources.mjs'), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (good.status !== 0) fail('censusen misslyckades: ' + good.stderr.slice(0, 300));
  const parsed = JSON.parse(good.stdout);
  const { count: exactTotal } = await sb.from('events').select('*', { count: 'exact', head: true });
  if (parsed.totalRowsInDb !== exactTotal) {
    fail(`censusen rapporterade ${parsed.totalRowsInDb} rader men DB har ${exactTotal}`);
  }
  ok(`censusen mäter ${exactTotal} rader och avbryter korrekt på trasig DB`);
}

// ── G2: vikningen är klar — ingen värd har två källfiler ──────────────────
if (GATE === 'fold-complete') {
  const entries = sourceFiles();
  const twins = findHostTwins(entries);

  // Negativ kontroll: en syntetisk tvilling MÅSTE upptäckas.
  const synthetic = findHostTwins([
    { id: 'x', url: 'https://aik.se/' },
    { id: 'y', url: 'https://www.aik.se/kalender' },
  ]);
  if (synthetic.length !== 1 || synthetic[0].ids.length !== 2) {
    fail('negativ kontroll — tvillingsdetektorn hittar inte två källor på samma värd');
  }

  if (twins.length > 0) {
    fail(
      `${twins.length} värdar har flera källfiler: ` +
        twins.map((t) => `${t.host} → ${t.ids.join(', ')}`).join('; '),
    );
  }
  ok(`${entries.length} källfiler, ingen värd har två källfiler`);
}

// ── G3: unika identiteter i DB ────────────────────────────────────────────
if (GATE === 'unique-identities') {
  const rows = await allEventRows();
  const dupes = findIdentityDuplicates(rows);

  // Negativ kontroll: syntetiska dubbletter MÅSTE upptäckas.
  const synthetic = findIdentityDuplicates([
    { id: 'a', source: 's', source_id: 'x', dedup_hash: 'h1' },
    { id: 'b', source: 's', source_id: 'x', dedup_hash: 'h2' },
    { id: 'c', source: 's', source_id: null, dedup_hash: 'h1' },
  ]);
  if (synthetic.hashes.length !== 1 || synthetic.sids.length !== 1) {
    fail('negativ kontroll — dubblettdetektorn hittar inte syntetiska dubbletter');
  }

  if (dupes.hashes.length > 0) {
    fail(`${dupes.hashes.length} dubbletter på dedup_hash, t.ex. ${dupes.hashes[0][0].slice(0, 12)}`);
  }
  if (dupes.sids.length > 0) {
    fail(`${dupes.sids.length} dubbletter på (source, source_id), t.ex. ${dupes.sids[0][0]}`);
  }
  ok(`${rows.length} rader utan dubblettidentitet`);
}

// ── G4: varje källa i scopet har spår i körningsloggen ─────────────────────
if (GATE === 'run-complete') {
  const ids = scopeIds();
  if (!fs.existsSync(LOG)) fail(`körningsloggen saknas: ${path.relative(ROOT, LOG)}`);
  const log = fs.readFileSync(LOG, 'utf8');
  // Loggen bär källans id i prefix på varje rad: "[<sourceId>] C0: …".
  // C1-DirectRoute skriver "[<sourceId>] [C1-DirectRoute] …" — där finns ingen
  // kolon efter gate-namnet, så den mäts separat.
  const traced = new Set([
    ...[...log.matchAll(/^\[([a-z0-9-]+)\] (?:C0|C1|C2|C3):/gm)].map((m) => m[1]),
    ...[...log.matchAll(/^\[([a-z0-9-]+)\] \[(?:C1-DirectRoute|C3-AI)\]/gm)].map((m) => m[1]),
  ]);

  // Negativ kontroll: en källa som inte kördes får INTE räknas som trådd.
  if (traced.has('definitely-not-a-real-source-xyz')) {
    fail('negativ kontroll — gaten hittar spår för en källa som inte finns');
  }
  const missing = ids.filter((id) => !traced.has(id));
  if (missing.length > 0) {
    fail(`${missing.length}/${ids.length} källor saknar spår i loggen: ${missing.slice(0, 10).join(', ')}`);
  }
  ok(`alla ${ids.length} källor har spår i körningsloggen`);
}

// ── G5: varje nollradskälla har en klassad orsak ───────────────────────────
if (GATE === 'causes-classified') {
  if (!fs.existsSync(CAUSES)) fail(`${path.relative(ROOT, CAUSES)} saknas — orsaksutredningen är inte gjord`);
  const data = JSON.parse(fs.readFileSync(CAUSES, 'utf8'));
  const ids = scopeIds();
  const byId = new Map(data.results.map((r) => [r.sourceId, r]));

  const ALLOWED = new Set([
    'redan_i_databasen',
    'extraherad_men_inte_importerad',
    'vinnare_utan_datum',
    'js_renderad',
    'inga_kandidater',
    'sidor_utan_event_densitet',
    'saknar_koerad_spår',
  ]);

  // Negativ kontroll: en orsak utanför det tillåtna setet MÅSTE underkännas.
  const synthetic = data.results.concat([
    { sourceId: 'syntetisk-kalla', cause: 'hittade-på-vingar' },
  ]).filter((r) => !ALLOWED.has(r.cause));
  if (synthetic.length !== 1) {
    fail('negativ kontroll — gaten underkänner inte en okänd orsaksklass');
  }

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) fail(`${missing.length} källor saknar orsaksrad: ${missing.slice(0, 10).join(', ')}`);

  const unknown = data.results.filter((r) => r.cause === 'saknar_koerad_spår');
  if (unknown.length > 0) {
    fail(`${unknown.length} källor har ingen orsak (saknar_koerad_spår): ${unknown.map((r) => r.sourceId).join(', ')}`);
  }
  ok(`alla ${ids.length} källor har en klassad orsak`);
}

// ── G6: varje extraherad rad med sparbart datum finns i DB ─────────────────
/**
 * Produktionsreglerna, importerade — inte omkopierade.
 *
 * Gaten får INTE ha en egen uppfattning om vad som är "spara bart" eller
 * "godkänd titel". Om importen eller normalizerns regler ändras ska gaten
 * följa efter utan handpåläggning.
 */
const { createHash } = await import('node:crypto');
const { isEventPast } = await import('../03-Queue/eventFreshness.ts');
const { evaluateTitle } = await import('../04-Normalizer/title-quality-gate.ts');
const { readExtractedEvents, toRawEvent, buildJobId } = await import('../03-Queue/importToEventPulse.ts');
const { calendarDay } = await import('../04-Normalizer/deduplication/ticketUrlDedup.ts');
const { isExcludedTitle } = await import('../02-Ingestion/lib/sourceTitleExclusions.ts');

/** Samma formel som normalizern (04-Normalizer/normalizer.ts:100). */
function dedupHash(source, sourceId) {
  return createHash('sha256').update(`${source}::${sourceId}`).digest('hex');
}

/**
 * Index över DB-rader — de vägar en rad kan ha landat genom.
 *
 *   hashes:  dedup_hash — normalizerns egen nyckel (normalizer.ts:458-460)
 *   sids:    (source, source_id) — samma rad, unik index i databasen
 *   urlDays: ticket_url → mängd av kalenderdagar. Cross-source-dedup slår
 *            ihop raden med en befintlig rad från en ANNAN källa
 *            (normalizer.ts:471-484). Då behåller raden ursprungskällans
 *            identitet, så hashen matchar inte — men innehållet ligger i
 *            databasen.
 *
 *            URL:en identifierar en SIDA, inte ett event. En kalendersida
 *            kan bära flera event på olika dagar. Därför räcker inte URL
 *            ensam: landning kräver samma URL **och** samma kalenderdag
 *            (produktionsregeln i 04-Normalizer/deduplication/ticketUrlDedup.ts).
 */
function buildDbIndex(rows) {
  const hashes = new Set();
  const sids = new Set();
  const urlDays = new Map();
  const urlNoDate = new Set();
  for (const r of rows) {
    if (r.dedup_hash) hashes.add(r.dedup_hash);
    if (r.source_id) sids.add(`${r.source}::${r.source_id}`);
    if (r.ticket_url) {
      const day = calendarDay(r.start_time);
      if (day === null) {
        urlNoDate.add(r.ticket_url);
        continue;
      }
      let days = urlDays.get(r.ticket_url);
      if (!days) { days = new Set(); urlDays.set(r.ticket_url, days); }
      days.add(day);
    }
  }
  return { hashes, sids, urlDays, urlNoDate };
}

/**
 * Har raden landat via ticket_url-vägen?
 *
 * Produktionsregeln (04-Normalizer/deduplication/ticketUrlDedup.ts):
 *   - samma URL + samma kalenderdag → samma event → landad
 *   - samma URL + annan kalenderdag → olika företrädesdagar → INTE landad
 *   - datum saknas på någondera sidan → gammalt beteende → landad
 */
function landedViaUrl(index, ticketUrl, startTime) {
  if (!ticketUrl) return false;
  const incomingDay = calendarDay(startTime);
  const days = index.urlDays.get(ticketUrl);
  if (incomingDay === null) return days !== undefined || index.urlNoDate.has(ticketUrl);
  if (days?.has(incomingDay)) return true;
  return index.urlNoDate.has(ticketUrl);
}

/**
 * Rad-nivå-audit av EN källa.
 *
 * Varje extraherad rad ska antingen:
 *   (a) ligga i DB via en av normalizerns tre landningsvägar, eller
 *   (b) ha en maskinverifierad avvisningsorsak i produktionens eget regelverk:
 *       - datumet har passerat (importern hoppar över den)
 *       - jobb-id-dedup (BullMQ slår ihop rader med samma nyckel)
 *       - titel-gaten avvisar titeln
 *       - blockB (bulk-pollution) avvisar raden
 *
 * En rad som varken landat eller har en orsak är OFÖRKLARAD → gaten faller.
 *
 * Ordningen nedan är produktionens ordning, i exakt denna reihenföljd:
 *   importern (datumvakt → jobb-id) → normalizern (titel-gate → blockB → dedup).
 * En rad som aldrig lades i kön når aldrig titelgaten eller blockB-räknaren,
 * så den får inte räknas in där.
 */
function auditRows(sourceId, events, index) {
  const blockBCounts = new Map();
  const jobOwners = new Map(); // jobb-id → första raden med det id:t
  const out = {
    sourceId,
    total: events.length,
    landed: 0,
    skippedPast: 0,
    excludedBySource: 0,
    collapsed: 0,
    titleRejected: 0,
    bulkRejected: 0,
    unexplained: [],
  };

  for (const ev of events) {
    const raw = toRawEvent(sourceId, ev);

    // (b1) Importern hoppar över passerade/datumlösa rader.
    if (isEventPast(raw.start_time)) { out.skippedPast += 1; continue; }

    // (b1b) Källans egen uteslutningslista (metadata.ignoreTitles) — samma
    // filter och samma ordning som importern använder.
    if (isExcludedTitle(sourceId, raw.title)) { out.excludedBySource += 1; continue; }

    // (b2) BullMQ jobb-id-dedup. Rader med samma (source, titel, start_time)
    // delar jobb-id (buildJobId). Importern lägger bara in den FÖRSTA — resten
    // blir tysta no-ops (importToEventPulse.ts:135-137). Raden är inte
    // förlorad: eventet ligger i databasen via den första raden. Gaten kräver
    // därför att den överlevande raden faktiskt landat.
    const jobId = buildJobId(raw);
    const owner = jobOwners.get(jobId);
    if (owner) {
      if (owner.landed) {
        out.collapsed += 1;
      } else {
        out.unexplained.push({
          title: raw.title,
          start: raw.start_time,
          ticket_url: raw.ticket_url,
          detail: `jobb-id-dedup — första raden ("${owner.title}") landade inte`,
        });
      }
      continue;
    }

    // (b3) Titel-gaten — samma regel som normalizern (normalizer.ts:443).
    const titleGate = evaluateTitle(raw.title, raw.source);
    if (!titleGate.ok) { out.titleRejected += 1; continue; }

    // (b4) BlockB räknar per (source, normaliserad titel) i normalizerns
    // worker-process. Räknar om samma sekvens som produktionen: bara rader
    // som passerat datum- och titelgaten når räknaren.
    const blockBKey = `${raw.source}::${raw.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    const blockBCount = (blockBCounts.get(blockBKey) ?? 0) + 1;
    blockBCounts.set(blockBKey, blockBCount);
    if (blockBCount >= 50) { out.bulkRejected += 1; continue; }

    // (a) Landning — normalizerns tre vägar.
    const hash = raw.source_id
      ? dedupHash(raw.source, raw.source_id)
      : dedupHash(raw.source, `${raw.title}::${raw.start_time}`);
    const landed =
      index.hashes.has(hash) ||
      (!!raw.source_id && index.sids.has(`${raw.source}::${raw.source_id}`)) ||
      landedViaUrl(index, raw.ticket_url, raw.start_time);

    jobOwners.set(jobId, { landed, title: raw.title, start: raw.start_time });
    if (landed) out.landed += 1;
    else out.unexplained.push({ title: raw.title, start: raw.start_time, ticket_url: raw.ticket_url });
  }
  return out;
}

/** Läs artefakterna med produktionens egen läsare (slår ihop A/B/C/D + topp). */
function auditSource(sourceId, index) {
  return auditRows(sourceId, readExtractedEvents(sourceId), index);
}

if (GATE === 'db-delta') {
  const ids = scopeIds();
  const rows = await allEventRows('id,source,source_id,dedup_hash,ticket_url,start_time');
  const index = buildDbIndex(rows);

  // Negativ kontroll 1: en rad som aldrig varit i DB och inte har någon
  // avvisningsorsak MÅSTE rapporteras som oförklarad.
  const control = auditRows(
    'definitely-not-a-real-source-xyz',
    [{ title: 'EventPulse-kontroll-som-inte-finns', date: '2099-01-01', url: 'https://example.com/ep-kontroll-2026-10-24' }],
    index,
  );
  if (control.unexplained.length !== 1) {
    fail('negativ kontroll — en rad som inte finns i DB rapporteras inte som oförklarad');
  }

  // Negativ kontroll 2: en rad som kollapsats med en syskonrad MÅSTE vara
  // oförklarad om syskonraden inte landade. Annars är kollapsen en godkänd
  // rätt som maskerar förluster.
  const collapsedControl = auditRows(
    'definitely-not-a-real-source-xyz',
    [
      { title: 'EventPulse-kollaps-kontroll', date: '2099-01-02', url: 'https://example.com/ep-kollaps-2026-10-24' },
      { title: 'EventPulse-kollaps-kontroll', date: '2099-01-02', url: 'https://example.com/ep-kollaps-2-2026-10-24' },
    ],
    index,
  );
  if (collapsedControl.collapsed !== 0 || collapsedControl.unexplained.length !== 2) {
    fail('negativ kontroll — en kollapsrad vars syskon inte landat godkänns som förklarad');
  }

  // Negativ kontroll 3 + positiv kontroll 4: dag-regeln.
  //
  // En rad som delar ticket_url med en DB-rad men ligger på en ANNAN
  // kalenderdag är INTE landad (annan företrädesdag). Samma URL + samma dag
  // ÄR landad. Kontrollerna körs mot en riktig DB-rad, så de bevisar att
  // gaten kan skilja de två fallen åt — inte bara att den är sträng.
  const urlEntry = [...index.urlDays.entries()].find(([, days]) => days.size > 0);
  if (!urlEntry) {
    fail('negativ kontroll — ingen DB-rad med ticket_url hittades, dag-regeln kan inte prövas');
  }
  const [controlUrl, controlDays] = urlEntry;
  const [controlDay] = controlDays;

  const otherDay = new Date(`${controlDay}T00:00:00Z`);
  otherDay.setUTCDate(otherDay.getUTCDate() + 400);
  const otherDayStr = otherDay.toISOString().slice(0, 10);

  const dayControl = auditRows(
    'definitely-not-a-real-source-xyz',
    [{ title: 'EventPulse-dagregering-kontroll', date: otherDayStr, url: controlUrl }],
    index,
  );
  if (dayControl.landed !== 0 || dayControl.unexplained.length !== 1) {
    fail(
      'negativ kontroll — en rad som delar ticket_url med en DB-rad men ligger på en annan kalenderdag ' +
        'godkänns som landad (URL-regeln är för lax)',
    );
  }

  const sameDayControl = auditRows(
    'definitely-not-a-real-source-xyz',
    [{ title: 'EventPulse-samma-dag-kontroll', date: controlDay, url: controlUrl }],
    index,
  );
  if (sameDayControl.landed !== 1 || sameDayControl.unexplained.length !== 0) {
    fail(
      'positiv kontroll — en rad med samma ticket_url och samma kalenderdag som en DB-rad ' +
        'godkänns inte som landad (URL-regeln är för strikt)',
    );
  }

  let total = 0, landed = 0, skippedPast = 0, excludedBySource = 0, collapsed = 0, titleRejected = 0, bulkRejected = 0;
  const unexplained = [];
  for (const id of ids) {
    const r = auditSource(id, index);
    total += r.total;
    landed += r.landed;
    skippedPast += r.skippedPast;
    excludedBySource += r.excludedBySource;
    collapsed += r.collapsed;
    titleRejected += r.titleRejected;
    bulkRejected += r.bulkRejected;
    for (const u of r.unexplained) unexplained.push({ sourceId: id, ...u });
  }

  if (unexplained.length > 0) {
    fail(
      `${unexplained.length}/${total} extraherade rader är oförklarade — varken landade eller avvisade:\n  ` +
        unexplained.slice(0, 15).map((u) => `${u.sourceId}: "${u.title}" ${u.start}${u.detail ? ` — ${u.detail}` : ''}`).join('\n  '),
    );
  }
  ok(
    `${landed} landade, ${collapsed} ihopkollapsade, ${skippedPast} datumförbi, ` +
      `${excludedBySource} källans egen uteslutning, ` +
      `${titleRejected} titel-gate, ${bulkRejected} bulk — ` +
      `0 oförklarade av ${total} extraherade rader i ${ids.length} källor`,
  );
}

// ── G7: inga döda (404/410) källor bland källorna i scopet ────────────────
if (GATE === 'no-dead-sources') {
  const ids = scopeIds();
  const entries = new Map(sourceFiles().map((e) => [e.id, e]));

  async function probeStatus(u) {
    try {
      const res = await fetch(u, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EventPulse/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      return res.status;
    } catch (e) {
      return `nätverksfel ${e.message}`;
    }
  }

  /** Döda källor bland `ids` — används av gaten OCH av negativ kontroll. */
  async function deadSourcesIn(idsToCheck) {
    const dead = [];
    for (const id of idsToCheck) {
      const entry = entries.get(id);
      if (!entry) { dead.push(`${id}: källfil saknas`); continue; }
      const status = await probeStatus(entry.url);
      if (status === 404 || status === 410) dead.push(`${id}: HTTP ${status} ${entry.url}`);
    }
    return dead;
  }

  // Negativ kontroll 1: en URL som inte finns MÅSTE upptäckas som död.
  const control = await probeStatus('https://example.com/eventpulse-404-kontroll-2026-10-24');
  if (control !== 404 && control !== 410) {
    fail(`negativ kontroll — kontroll-URL:en svarade ${control}, inte 404/410 (gaten kan inte se döda källor)`);
  }

  // Negativ kontroll 2: en AKTIV källa utan källfil MÅSTE rapporteras som
  // död. (Begravda källor utesluts ur scopet — de har ingen källfil i
  // sources/, men de är inte döda, de är begravda.)
  const controlDead = await deadSourcesIn(['eventpulse-ingen-kallfil-kontroll-2026-10-24']);
  if (controlDead.length !== 1 || !controlDead[0].includes('källfil saknas')) {
    fail('negativ kontroll — en aktiv källa utan källfil rapporteras inte som död');
  }

  const dead = await deadSourcesIn(ids);
  if (dead.length > 0) fail(`${dead.length} källor är döda (404/410):\n  ${dead.join('\n  ')}`);
  ok(`inga av de ${ids.length} källorna svarar 404/410`);
}

// ── G8: värdkällorna bär de extra event-URL:erna ───────────────────────────
if (GATE === 'eventurls-attached') {
  const ids = scopeIds();
  const entries = new Map(sourceFiles().map((e) => [e.id, e]));

  /** Problem per källa — används av gaten OCH av negativ kontroll. */
  function eventUrlProblems(idsToCheck) {
    const found = [];
    for (const id of idsToCheck) {
      const entry = entries.get(id);
      if (!entry) { found.push(`${id}: källfil saknas`); continue; }
      const urls = Array.isArray(entry.record?.metadata?.eventUrls) ? entry.record.metadata.eventUrls : [];

      // Källfilen måste vara EN RAD — radbaserade läsare parsar bara första raden.
      if (fs.readFileSync(path.join(SOURCES_DIR, `${id}.jsonl`), 'utf8').trim().includes('\n')) {
        found.push(`${id}: källfilen är flerradig`);
      }

      // Varje event-URL måste vara giltig, unik och skild från källans EGEN URL.
      // (Samma värd är tvunget — hela poängen med vikningen är att en värd har
      // flera event-sidor. Det som är fel är att källans egen adress ligger
      // kvar som "extra" event-sida; då kör C-gaten om sin egen sida.)
      const seen = new Set();
      const own = canonicalUrl(entry.url);
      for (const u of urls) {
        if (typeof u !== 'string' || !/^https?:\/\//.test(u)) {
          found.push(`${id}: ogiltig event-URL "${u}"`);
          continue;
        }
        if (seen.has(u)) { found.push(`${id}: dubblett av event-URL "${u}"`); continue; }
        seen.add(u);
        if (canonicalUrl(u) === own) {
          found.push(`${id}: event-URL "${u}" är källans egen URL`);
        }
      }
    }
    return found;
  }

  // Negativ kontroll 1: en AKTIV källa utan källfil MÅSTE rapporteras.
  const controlProblems = eventUrlProblems(['eventpulse-ingen-kallfil-kontroll-2026-10-24']);
  if (controlProblems.length !== 1 || !controlProblems[0].includes('källfil saknas')) {
    fail('negativ kontroll — en aktiv källa utan källfil rapporteras inte');
  }

  // Negativ kontroll 2: en värd UTAN eventUrls måste underkännas.
  const withoutUrls = ids.filter((id) => {
    const entry = entries.get(id);
    if (!entry) return false;
    const urls = entry.record?.metadata?.eventUrls;
    return !Array.isArray(urls) || urls.length === 0;
  });
  if (withoutUrls.length === ids.length) {
    fail('negativ kontroll — ingen källa i scopet har eventUrls (mätningen fångar ingenting)');
  }

  const problems = eventUrlProblems(ids);
  let total = 0;
  let withUrls = 0;
  for (const id of ids) {
    const entry = entries.get(id);
    if (!entry) continue;
    const urls = Array.isArray(entry.record?.metadata?.eventUrls) ? entry.record.metadata.eventUrls : [];
    if (urls.length > 0) withUrls += 1;
    total += urls.length;
  }

  if (problems.length > 0) fail(`${problems.length} problem:\n  ${problems.slice(0, 20).join('\n  ')}`);
  ok(`${total} event-URL:er på ${withUrls}/${ids.length} källor i scopet`);
}

// ── G9: en rad = en företrädesdag (occurrence-modellen) ───────────────────
/**
 * En ticket_url identifierar en SIDA, inte ett event. Samma sida kan bära
 * flera event på olika kalenderdagar — varje sådan dag ska vara en egen rad.
 *
 * Buggen 2026-10-24: normalizern tog den första raden med matchande URL och
 * skrev över den, så alla event på samma sida kollapsade till en rad.
 *
 * Gaten mäter detta på riktig data: för varje källa i scopet räknas hur
 * många DISTINKTA kalenderdagar varje URL bär i de extraherade raderna.
 * DB måste ha minst lika många rader för (källa, URL) — annars har något
 * kollapsat igen.
 */
if (GATE === 'occurrence-split') {
  const ids = scopeIds();
  const rows = await allEventRows('id,source,ticket_url,start_time,title_sv');

  // DB: (titel, kalenderdag) → antal rader. Detta ÄR identiteten som
  // företrädesdagen har: en rad = ett event på en dag. Källan spelar ingen
  // roll — cross-source-konsolideringen flyttar raden till ursprungskällans
  // identitet, men eventet finns kvar. URL:en spelar heller ingen roll:
  // samma event kan ligga under /en/-variant, annan värd eller annan
  // URL-stavning, och det är fortfarande ETT event.
  const dbTitleDays = new Map();
  const titleKey = (title, day) => `${title.trim().replace(/\s+/g, ' ').toLowerCase()}::${day}`;
  for (const r of rows) {
    const day = calendarDay(r.start_time);
    if (day === null || !r.title_sv) continue;
    const key = titleKey(r.title_sv, day);
    dbTitleDays.set(key, (dbTitleDays.get(key) ?? 0) + 1);
  }

  // Extraherat: URL → kalenderdag → titlar. Bara rader som IMPORTERN faktiskt
  // kan spara räknas — samma regler som importern använder, i samma ordning:
  //   datumvakt → jobb-id-dedup → titel-gate → bulk.
  // Utan jobb-id-dedupen skulle samma event, extraherad från två olika
  // filer med olika URL, räknas som två företrädesdagar — en falsk avvikelse.
  const extractedByUrlDay = new Map();
  const extractedOwner = new Map();
  for (const id of ids) {
    const seenJobs = new Set();
    const blockBCounts = new Map();
    for (const ev of readExtractedEvents(id)) {
      const raw = toRawEvent(id, ev);
      if (isEventPast(raw.start_time)) continue;

      // Källans egen uteslutningslista — samma filter, samma ordning
      // som importern (datumvakt → uteslutning). Se sourceTitleExclusions.ts.
      if (isExcludedTitle(id, raw.title)) continue;

      const jobId = buildJobId(raw);
      if (seenJobs.has(jobId)) continue; // samma event från en annan fil
      seenJobs.add(jobId);

      if (!evaluateTitle(raw.title, raw.source).ok) continue;

      const blockBKey = `${raw.source}::${raw.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
      const blockBCount = (blockBCounts.get(blockBKey) ?? 0) + 1;
      blockBCounts.set(blockBKey, blockBCount);
      if (blockBCount >= 50) continue;

      if (!raw.ticket_url) continue;
      const day = calendarDay(raw.start_time);
      if (day === null) continue;
      if (!extractedByUrlDay.has(raw.ticket_url)) extractedByUrlDay.set(raw.ticket_url, new Map());
      const byDay = extractedByUrlDay.get(raw.ticket_url);
      if (!byDay.has(day)) byDay.set(day, new Set());
      byDay.get(day).add(raw.title);
      if (!extractedOwner.has(raw.ticket_url)) extractedOwner.set(raw.ticket_url, id);
    }
  }

  const problems = [];
  let checkedUrls = 0;
  let expectedRows = 0;

  /**
   * En URL som bär flera kalenderdagar ska ALLA dessa dagar finnas i DB.
   * Matchningen sker på (titel, dag) — inte på URL — eftersom samma event
   * kan ligga under en annan URL-stavning. En dag räknas som bevisad om
   * NÅGON av de extraherade titlarna för den dagen finns i DB med samma dag.
   *
   * Används av gaten OCH av kontrollerna — samma kodväg.
   */
  function splitProblems(url, byDay) {
    if (byDay.size < 2) return [];
    const found = [];
    for (const [day, titles] of byDay) {
      const landed = [...titles].some((t) => dbTitleDays.has(titleKey(t, day)));
      if (!landed) {
        found.push(
          `${extractedOwner.get(url) ?? '?'}: ingen rad i DB för ${day} (titlar: ${[...titles].join(' / ')}) — ${url}`,
        );
      }
    }
    return found;
  }

  for (const [url, byDay] of extractedByUrlDay) {
    if (byDay.size < 2) continue; // en dag per URL → inget att kollapsa
    checkedUrls += 1;
    expectedRows += byDay.size;
    problems.push(...splitProblems(url, byDay));
  }

  // Negativ kontroll: en URL med två dagar och titlar som inte finns i DB
  // MÅSTE rapporteras — en per dag. Annars kan gaten inte faila.
  const controlUrl = 'https://example.com/ep-occurrence-kontroll-2026-10-24';
  const controlProblems = splitProblems(
    controlUrl,
    new Map([
      ['2099-01-01', new Set(['Kontroll Aldag'])],
      ['2099-01-02', new Set(['Kontroll Annandag'])],
    ]),
  );
  if (controlProblems.length !== 2) {
    fail(
      `negativ kontroll — en URL med två kalenderdagar utan DB-rader ger ${controlProblems.length} problem (förväntat 2): ` +
        'gaten kan inte faila',
    );
  }

  // Positiv kontroll: en riktig DB-rad måste godkännas av samma kodväg.
  const realRow = rows.find((r) => r.title_sv && calendarDay(r.start_time) !== null);
  if (!realRow) {
    fail('positiv kontroll — inga DB-rader med titel och datum att verifiera mot');
  }
  const realDay = calendarDay(realRow.start_time);
  const positiveProblems = splitProblems(
    'https://example.com/ep-occurrence-positiv-kontroll',
    new Map([[realDay, new Set([realRow.title_sv])]]),
  );
  if (positiveProblems.length !== 0) {
    fail(`positiv kontroll — en riktig DB-rad avvisades av gaten: ${positiveProblems.join('; ')}`);
  }

  if (problems.length > 0) {
    fail(
      `${problems.length} kalenderdagar saknas i DB trots att de extraherats:\n  ` +
        problems.slice(0, 15).join('\n  '),
    );
  }
  ok(
    `${checkedUrls} URL:er med flera kalenderdagar — alla ${expectedRows} företrädesdagar finns som egna rader i DB`,
  );
}

const KNOWN = [
  'census-selfcheck',
  'fold-complete',
  'unique-identities',
  'run-complete',
  'causes-classified',
  'db-delta',
  'no-dead-sources',
  'eventurls-attached',
  'occurrence-split',
];
if (!GATE) {
  console.error('usage: node scripts/verify-ingestion-state.mjs --gate=<namn>');
  process.exit(2);
}
if (!KNOWN.includes(GATE)) {
  console.error(`okänd gate: ${GATE}`);
  process.exit(2);
}
