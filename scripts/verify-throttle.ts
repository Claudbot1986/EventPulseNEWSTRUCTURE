/**
 * verify-throttle.ts — bevis för att C-gatens 429 inte längre begravs
 * som extraktionsfel.
 *
 * Bakgrund (2026-10-24). Flera svenska sajter svarar 429 när C-gaten
 * anropar dem. Uppmätt på blekholmen.se: ~12 snabba anrop → 429 i ~30 s,
 * sedan 200 igen. C-gatens eget anropsvolym (sitemap + kandidatsidor +
 * C1-subpaths + C2/C3-hämtning, upp till 3 rundor) triggar WAF:en, och
 * C-gaten skrev det 429 som "fetch error: HTTP 429" — dvs. begravde
 * levande källor för att vi själva höll på för mycket.
 *
 * Samma mönster mättes på sju orelaterade domäner (blekholmen.se,
 * momentsapp.no, cirkus.se, folketshus.se, galeasen.se, filborna.se,
 * ifkstockholm.se) — alltså generellt, inte sajt-specifikt.
 *
 * Fixen ligger i 02-Ingestion/tools/fetchTools.ts: fetchHtml gör nu
 * retry med backoff på 429/503 och respekterar Retry-After.
 *
 * Gates:
 *   t1 — i C-gatens senaste körning får ingen av de throttling-drabbade
 *        källorna BLI BEGRAVD på grund av 429. Negativ kontroll: en
 *        syntetisk trace där 429 begravde källan MÅSTE upptäckas (annars
 *        kan t1 inte faila). Positiv kontroll: en trace där 429 ledde till
 *        en HANDOFF (route_success → D) får INTE flaggas — det är rätt
 *        utfall, inte en begravning.
 *
 * Varför "begravd" och inte bara "429 i traceen". Mätningen på de senaste
 * batcharna visar exakt utvecklingen:
 *
 *   batch-224/225  outcomeType=fail          exitReason=FETCH_ERROR
 *                  → 429 begravde källan (det gamla felet)
 *   batch-226/228  outcomeType=route_success exitReason=FETCH_BLOCKED_BOT_WALL
 *                  → 429 routades till D-renderGate (fixen fungerar)
 *
 * Den gamla gaten slog på förekomsten av strängen "429" i traceen. Den
 * flaggade då även de körningar där 429 ledde till korrekt handoff — alltså
 * en gata som mätte fixen som om den vore felet. Kriteriet är därför nu
 * "begravd", inte "429 syntes".
 *
 * Användning: npx tsx scripts/verify-throttle.ts t1
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, '02-Ingestion', 'C-htmlGate', 'reports');

const arg = process.argv[2];

/**
 * Källor som senast före fixen föll på HTTP 429 i C-gaten.
 * De ska inte längre göra det — varken i C1 eller i C2.
 */
const THROTTLE_SOURCES = [
  'blekholmen',
  'momentsapp-stockholm',
  'cirkus',
  'folkets-hus',
  'teater-galeasen',
  'filborna',
  'ifk-stockholm',
] as const;

function ok(msg: string) { console.log(msg); }
function fail(msg: string) { console.error(msg); process.exit(1); }

/** Finns det en 429 någonstans i trace-raden? */
function has429(trace: any): boolean {
  const fields = ['c1FetchError', 'c2Reason', 'exitReasonDetail', 'detail'];
  for (const f of fields) {
    if (String(trace?.[f] ?? '').includes('429')) return true;
  }
  return false;
}

/**
 * Blev källan BEGRAVD på grund av 429?
 *
 * En 429 är i sig inte felet — felet är att källan begravs. Utfallen i
 * batch-traces:
 *   outcomeType 'fail'           → begravd (det vi vill upptäcka)
 *   outcomeType 'route_success'  → handoff till D/UI (korrekt, inte felet)
 *   outcomeType 'extract_success' → events extraherade (korrekt)
 */
function buriedBy429(trace: any): boolean {
  if (!trace) return false;
  if (trace.outcomeType !== 'fail') return false;
  return has429(trace);
}

// ── T1: ingen 429 i senaste C-körningen för de throttling-drabbade källorna ─

if (arg === 't1') {
  if (!existsSync(REPORTS_DIR)) fail('t1: C-gatens rapportkatalog saknas');

  const batches = readdirSync(REPORTS_DIR)
    .filter((d) => /^batch-\d+$/.test(d))
    .map((d) => {
      const num = Number(d.replace('batch-', ''));
      return { dir: path.join(REPORTS_DIR, d), num };
    })
    .filter((b) => existsSync(path.join(b.dir, 'batch-traces.jsonl')))
    .sort((a, b) => b.num - a.num);

  if (batches.length === 0) fail('t1: ingen batch-traces.jsonl hittades');
  const latest = batches[0];

  // Se de senaste batcharna — en källa kan ha fallit ur poolen i en körning
  // och återkommit i nästa. Beviset är "senast gången källan kördes gav den
  // inte 429", så vi letar den senaste trace-raden per källa.
  const latestBySource = new Map<string, any>();
  for (const batch of batches.slice(0, 5)) {
    const traces = readFileSync(path.join(batch.dir, 'batch-traces.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l) as any; } catch { return null; } })
      .filter(Boolean) as any[];
    for (const t of traces) {
      if (t?.sourceId && !latestBySource.has(t.sourceId)) {
        latestBySource.set(t.sourceId, t);
      }
    }
  }

  const stillThrottled = THROTTLE_SOURCES.filter((id) => {
    const t = latestBySource.get(id);
    return buriedBy429(t);
  });
  const notRun = THROTTLE_SOURCES.filter((id) => !latestBySource.has(id));

  if (stillThrottled.length > 0) {
    fail(
      `t1: ${stillThrottled.length}/${THROTTLE_SOURCES.length} källor BEGRAVDES fortfarande på grund av ` +
      `HTTP 429 i senaste C-körningen (${path.basename(latest.dir)}): ${stillThrottled.join(', ')} — ` +
      'throttle-retryen fungerar inte, eller rättningen kördes inte.',
    );
  }
  if (notRun.length > 0) {
    fail(
      `t1: ${notRun.length}/${THROTTLE_SOURCES.length} källor saknas i senaste C-körningen ` +
      `(${path.basename(latest.dir)}): ${notRun.join(', ')} — de kördes inte, så t1 kan inte bevisa något.`,
    );
  }

  // Negativ kontroll: en syntetisk trace där 429 BEGRAVDE källan MÅSTE
  // upptäckas. Utan detta kan t1 inte faila.
  const syntheticBurial = {
    sourceId: '__t1_probe__',
    outcomeType: 'fail',
    c1FetchError: 'HTTP 429',
    c2Reason: 'fetchHtml failed: HTTP 429',
    exitReasonDetail: 'fetch failed: HTTP 429',
  };
  if (!buriedBy429(syntheticBurial)) {
    fail('t1: negativ kontroll — en syntetisk 429-begravning upptäcktes inte (kontrollen kan inte faila)');
  }

  // Positiv kontroll: en 429 som ledde till HANDOFF (route_success → D) är
  // rätt utfall, inte en begravning. Kontrollen får INTE flagga den —
  // annars mäter gaten fixen som om den vore felet.
  const syntheticHandoff = {
    sourceId: '__t1_probe_handoff__',
    outcomeType: 'route_success',
    routeSuggestion: 'D',
    exitReason: 'FETCH_BLOCKED_BOT_WALL',
    c1FetchError: 'HTTP 429',
    c2Reason: 'fetchHtml failed: HTTP 429',
    exitReasonDetail: 'client blocked (HTTP 429) — plain HTTP refused, routed to D-renderGate',
  };
  if (buriedBy429(syntheticHandoff)) {
    fail(
      't1: positiv kontroll — en 429 som routades till D-renderGate flaggades som begravning ' +
        '(kontrollen mäter fel sak)',
    );
  }

  ok(
    `t1: ingen av ${THROTTLE_SOURCES.length} throttling-drabbade källor BEGRAVDES på grund av 429 i ` +
    `senaste C-körningen (${path.basename(latest.dir)}); negativ kontroll: syntetisk 429-begravning ` +
    'upptäcks (kontrollen kan faila); positiv kontroll: 429-handoff flaggas inte pass',
  );
}

if (arg !== 't1') {
  fail('usage: npx tsx scripts/verify-throttle.ts t1');
}
