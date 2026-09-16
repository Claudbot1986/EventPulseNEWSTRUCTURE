/**
 * Quarantine Guard — den enda källan till sanning för "vilka källor ska INTE
 * bearbetas just nu".
 *
 * Designprincip (se plan eventual-leaping-plum.md §B):
 * - INDEX-filer (sources/_quarantine/INDEX.json, sources/_retired/INDEX.json)
 *   är källan till sanning, INTE mapparna.
 * - Gates läser INDEX vid varje körning (ingen cache, ingen race-risk).
 * - INDEX skrivs atomärt via write-then-rename i lifecycle-admin.ts.
 *
 * Vad denna modul INTE gör:
 * - Flyttar inga källfiler (det är lifecycle-admin.ts uppgift).
 * - Triggar inga auto-quarantines (det är sourceRegistry.ts uppgift).
 *
 * Användning i gates (typiskt mönster):
 *
 *   import { isSkipped } from '../lib/quarantineGuard';
 *   const skip = isSkipped(sourceId);
 *   if (skip.skip) {
 *     // logga skip, gå vidare till nästa
 *     continue;
 *   }
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../');

/**
 * Resolver för sandbox-stöd. Modulens konstanter ovan fångas vid import, men
 * vi vill kunna overrid:a via EVENTPULSE_SANDBOX_ROOT vid varje anrop
 * (tester, sandboxes, framtida per-tenant-körning).
 * Behåll de exporterade konstanterna för bakåtkompatibilitet (används av
 * andra moduler), men alla read-path går via *_RESOLVED-versionerna.
 */
function resolveDataRoot(): string {
  return process.env.EVENTPULSE_SANDBOX_ROOT
    ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
    : PROJECT_ROOT;
}

export const QUARANTINE_DIR = path.resolve(resolveDataRoot(), 'sources/_quarantine');
export const RETIRED_DIR = path.resolve(resolveDataRoot(), 'sources/_retired');
export const QUARANTINE_INDEX = path.resolve(QUARANTINE_DIR, 'INDEX.json');
export const RETIRED_INDEX = path.resolve(RETIRED_DIR, 'INDEX.json');

const QUARANTINE_DIR_RESOLVED = () => path.resolve(resolveDataRoot(), 'sources/_quarantine');
const RETIRED_DIR_RESOLVED = () => path.resolve(resolveDataRoot(), 'sources/_retired');
const QUARANTINE_INDEX_RESOLVED = () => path.join(QUARANTINE_DIR_RESOLVED(), 'INDEX.json');
const RETIRED_INDEX_RESOLVED = () => path.join(RETIRED_DIR_RESOLVED(), 'INDEX.json');

/**
 * Publika resolvers för konsumenter (lifecycle-admin, manual-review, tester)
 * som behöver evaluera sökvägen vid varje anrop, inte vid import.
 */
export const resolveQuarantineDir = QUARANTINE_DIR_RESOLVED;
export const resolveRetiredDir = RETIRED_DIR_RESOLVED;
export const resolveQuarantineIndexPath = QUARANTINE_INDEX_RESOLVED;
export const resolveRetiredIndexPath = RETIRED_INDEX_RESOLVED;

export interface LifecycleEntry {
  sourceId: string;
  url: string;
  movedAt: string;        // ISO-tidpunkt
  reasonCode: string;     // ReasonCode (eller 'unknown' om oklassificerat)
  note: string;           // fritext — varför
  lastError?: string;     // sista felmeddelandet vi såg
  movedBy?: string;       // 'auto' eller användarnamn
}

export interface SkipResult {
  skip: boolean;
  reason: 'quarantined' | 'retired' | null;
  entry: LifecycleEntry | null;
}

/**
 * Säker file-read med fel-tolerant fallback.
 * Returnerar [] om filen saknas eller är korrupt (då antar vi "inga källor
 * är skip:ade", vilket är säkrare än att krascha gates).
 */
function readIndex(filePath: string): LifecycleEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    // Validera att varje rad har ett sourceId — defensivt mot korrupta rader
    return parsed.filter((e): e is LifecycleEntry =>
      e != null && typeof e === 'object' && typeof e.sourceId === 'string'
    );
  } catch {
    // Korrupt JSON — returnera tomt. Loggas till stderr men kraschar inte gate.
    // (Felmeddelandet är avsiktligt kort — gates loggar tusentals rader.)
    console.error(`[quarantineGuard] Failed to read ${path.basename(filePath)} — treating as empty`);
    return [];
  }
}

/**
 * Returnerar ALLA quarantined-källor som en map {sourceId → entry}.
 * Läser från disk varje gång (ingen cache) → race-safe.
 */
export function loadQuarantineIndex(): Map<string, LifecycleEntry> {
  const map = new Map<string, LifecycleEntry>();
  for (const entry of readIndex(QUARANTINE_INDEX_RESOLVED())) {
    map.set(entry.sourceId, entry);
  }
  return map;
}

/**
 * Returnerar ALLA retired-källor som en map.
 */
export function loadRetiredIndex(): Map<string, LifecycleEntry> {
  const map = new Map<string, LifecycleEntry>();
  for (const entry of readIndex(RETIRED_INDEX_RESOLVED())) {
    map.set(entry.sourceId, entry);
  }
  return map;
}

/**
 * Kollar om en källa ska skip:as.
 * - Kollar retired FÖRST (retired är starkare än quarantined).
 * - Om skip=true, returnera entryn så gate kan logga orsak.
 */
export function isSkipped(sourceId: string): SkipResult {
  const retired = loadRetiredIndex().get(sourceId);
  if (retired) {
    return { skip: true, reason: 'retired', entry: retired };
  }
  const quarantined = loadQuarantineIndex().get(sourceId);
  if (quarantined) {
    return { skip: true, reason: 'quarantined', entry: quarantined };
  }
  return { skip: false, reason: null, entry: null };
}

/**
 * Bulk-version: returnerar Set av sourceIds som ska skip:as.
 * Praktiskt för gates som läser många källor i en batch.
 */
export function loadSkippedSourceIds(): Set<string> {
  const set = new Set<string>();
  for (const id of loadRetiredIndex().keys()) set.add(id);
  for (const id of loadQuarantineIndex().keys()) set.add(id);
  return set;
}

/**
 * Returnerar True om filerna/mapparna existerar (används av setup/lifecycle-admin).
 */
export function lifecycleDirsExist(): boolean {
  return existsSync(QUARANTINE_DIR) && existsSync(RETIRED_DIR);
}
