/**
 * extracted-events.mjs — läs extraherade events ur `03-Queue/03-extractedevents`.
 *
 * Varför (2026-10-28). Import-ledgern gör importen idempotent: en källa med
 * oförändrat innehåll hoppas över. Det är rätt beteende — men det gör det
 * omöjligt att bevisa att importen FAKTISKT kan köa events, eftersom en
 * omkörning då alltid ger 0.
 *
 * Två gater behöver därför tvinga fram en riktig import:
 *   - L2 (verify-failfast.mjs): negativ kontroll mot levande Redis.
 *   - L3 (verify-chain-live.mjs): bevis att kedjan producerar events.
 *
 * Båda behöver samma sak: veta vilka källor som har events kvar att köa.
 * Importens datumvakt kastar bort förgångna och datumlösa rader — en källa
 * vars samtliga events redan har varit kan alltså inte importeras igen.
 * Den här modulen hittar de källor som har något FRAMTID kvar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLedger, LEDGER_RELATIVE_PATH } from '../../03-Queue/importLedger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Var de extraherade eventsen ligger. */
export const EXTRACTED_DIR = path.join(PROJECT_ROOT, '03-Queue', '03-extractedevents');

/** Var import-ledgern ligger. */
export const LEDGER_PATH = path.join(PROJECT_ROOT, LEDGER_RELATIVE_PATH);

/**
 * Starttid för en extraherad rad — speglar importens regel
 * (`start_time`/`startTime` som ISO, annars `date` + `time`).
 *
 * @param {Record<string, unknown>} ev
 * @returns {string | null}
 */
export function resolveStartStamp(ev) {
  const iso = ev.start_time ?? ev.startTime;
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(iso.trim())) return iso.trim();
  const day = typeof ev.date === 'string' ? ev.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const clock = typeof ev.time === 'string' ? ev.time.trim() : '';
  const m = /^(\d{1,2}):(\d{2})/.exec(clock);
  const hh = m ? m[1].padStart(2, '0') : '00';
  const mm = m ? m[2] : '00';
  return `${day}T${hh}:${mm}:00.000Z`;
}

/**
 * Artefaktfiler som hör till en källa — samma sökvägar som importen använder
 * (top-level + gate-underkataloger A/B/C/D).
 *
 * @param {string} sourceId
 * @returns {string[]}
 */
export function artifactFilesFor(sourceId) {
  const files = [path.join(EXTRACTED_DIR, `${sourceId}.jsonl`)];
  for (const gate of ['A', 'B', 'C', 'D']) {
    files.push(path.join(EXTRACTED_DIR, gate, `${sourceId}.jsonl`));
  }
  return files;
}

/**
 * Antal events i en källs artefaktfiler som ligger i FRAMTID.
 *
 * @param {string} sourceId
 * @param {number} nowMs
 * @returns {number}
 */
export function countFutureEvents(sourceId, nowMs) {
  let future = 0;
  for (const file of artifactFilesFor(sourceId)) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      const stamp = resolveStartStamp(ev);
      if (!stamp) continue;
      const ts = Date.parse(stamp);
      if (Number.isFinite(ts) && ts >= nowMs) future++;
    }
  }
  return future;
}

/**
 * Välj källor som har framtida events — de som gaten kan tvinga fram.
 *
 * Föredrar ett mittenband (3–150 framtida events): för stora källor gör
 * gaten långsam (momsapp-stockholm har ~3 000 events — 9 minuters dränering),
 * för små bevisar de knappt att vägen fungerar.
 *
 * @param {Iterable<string>} sourceIds
 * @param {number} nowMs
 * @returns {Array<{ sourceId: string, future: number }>}
 */
export function pickSourcesWithFutureEvents(sourceIds, nowMs) {
  /** @type {Array<{ sourceId: string, future: number }>} */
  const candidates = [];
  for (const sourceId of sourceIds) {
    const future = countFutureEvents(sourceId, nowMs);
    if (future > 0) candidates.push({ sourceId, future });
  }
  candidates.sort((a, b) => b.future - a.future);
  const inBand = candidates.filter((c) => c.future >= 3 && c.future <= 150);
  return inBand.length > 0 ? inBand : candidates;
}

/**
 * Källor som gaten kan tvinga fram.
 *
 * Två filter:
 *   1. `enqueued > 0` i ledgern — källan har faktiskt producerat events
 *      tidigare. En källa som aldrig köat något är antingen tom eller
 *      retirad (retired/quarantined) och importeras inte av importen.
 *   2. minst ett FRAMTIDA event — annars kastar importens datumvakt bort
 *      allt och det finns inget att köa.
 *
 * @param {number} nowMs
 * @returns {Array<{ sourceId: string, future: number }>}
 */
export function pickProducableSources(nowMs) {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const ledger = loadLedger(LEDGER_PATH);
  const importable = [...ledger.entries()]
    .filter(([, row]) => (row.enqueued ?? 0) > 0)
    .map(([id]) => id);
  return pickSourcesWithFutureEvents(importable, nowMs);
}
