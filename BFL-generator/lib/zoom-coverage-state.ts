/**
 * BFL-generator/lib/zoom-coverage-state.ts
 *
 * "Memory" för zoom-variation-pipelinen. Spårar vilka (tag, zoom, pose, light)-
 * kombinationer som redan är GENERERADE och FINNS på disk (local_image_library_stamped).
 *
 * Användning:
 *   - Innan generering: hämta existerande kombinationer → prioritera saknade.
 *   - Efter generering: registrera nya kombinationer.
 *   - Vid backfill: läs alla .webp.json och bygg initial state.
 *
 * Format (state/zoom-coverage.json):
 *   {
 *     "version": 1,
 *     "lastUpdated": "<iso>",
 *     "totals": { "<cat>": <count>, ... },
 *     "combos": {
 *       "<cat>": {
 *         "<tag>": [ [[zoomId, pose, light], source, createdAt], ... ]
 *       }
 *     }
 *   }
 *
 * Singleton — antingen läsa eller initiera. Inga race-conditions i single-process
 * eftersom pipeline kör sekventiellt per kategori.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, type Dirent } from 'node:fs';
import { join, dirname } from 'node:path';

const STATE_VERSION = 1;
const STATE_DIR = 'state';
const STATE_FILE = 'zoom-coverage.json';

export interface ComboEntry {
  combo: [string, string, string]; // [zoomId, pose, light]
  source: string;                  // runTag eller 'backfill'
  createdAt: string;               // ISO
  storagePath?: string;           // relativ path till .webp-filen
}

export interface CategoryState {
  totals: number;
  combos: Record<string, ComboEntry[]>;  // tag → entries
}

export interface CoverageState {
  version: number;
  lastUpdated: string;
  totals: Record<string, number>;
  combos: Record<string, CategoryState['combos']>;
}

const EMPTY_STATE: CoverageState = {
  version: STATE_VERSION,
  lastUpdated: new Date(0).toISOString(),
  totals: {},
  combos: {},
};

function statePath(rootDir: string): string {
  return join(rootDir, STATE_DIR, STATE_FILE);
}

export function loadCoverageState(rootDir: string = process.cwd()): CoverageState {
  const p = statePath(rootDir);
  if (!existsSync(p)) return { ...EMPTY_STATE };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as CoverageState;
    if (raw.version !== STATE_VERSION) {
      console.warn(`[zoom-coverage] state version mismatch (${raw.version} != ${STATE_VERSION}), starting fresh`);
      return { ...EMPTY_STATE };
    }
    return raw;
  } catch (err) {
    console.warn(`[zoom-coverage] kunde inte läsa ${p}: ${err}`);
    return { ...EMPTY_STATE };
  }
}

function saveCoverageState(state: CoverageState, rootDir: string = process.cwd()): void {
  const p = statePath(rootDir);
  mkdirSync(dirname(p), { recursive: true });
  // Atomic write via .tmp + rename för att undvika halv-skrivna filer
  // (på macOS, rename ersätter om målfilen finns)
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, p);
}

function comboKey(c: [string, string, string]): string {
  return c.join('|');
}

/**
 * Hämta set av (zoomId|pose|light) som redan finns för en (cat, tag).
 * Returnerar Map<tag, Set<comboKey>> för O(1)-lookup vid generering.
 */
export function existingCombos(
  state: CoverageState,
  cat: string,
  tag: string,
): Set<string> {
  const catCombos = state.combos[cat] ?? {};
  const entries = catCombos[tag] ?? [];
  return new Set(entries.map((e) => comboKey(e.combo)));
}

/**
 * Hämta total-count per kategori (snabb scan).
 */
export function totalPerCategory(state: CoverageState): Record<string, number> {
  return { ...state.totals };
}

/**
 * Lägg till en (cat, tag, combo, source, createdAt, storagePath).
 * No-op om samma (cat, tag, combo) redan finns (determinist).
 */
export function registerCombo(
  state: CoverageState,
  cat: string,
  tag: string,
  combo: [string, string, string],
  source: string,
  createdAt: string = new Date().toISOString(),
  storagePath?: string,
): CoverageState {
  // Immutable-ish: vi returnerar NY state
  const next: CoverageState = {
    version: state.version,
    lastUpdated: new Date().toISOString(),
    totals: { ...state.totals },
    combos: { ...state.combos },
  };
  if (!next.combos[cat]) next.combos[cat] = {};
  if (!next.combos[cat][tag]) next.combos[cat][tag] = [];
  const existing = next.combos[cat][tag];
  const key = comboKey(combo);
  if (existing.some((e) => comboKey(e.combo) === key)) {
    return state; // no-op
  }
  existing.push({ combo, source, createdAt, storagePath });
  next.totals[cat] = (next.totals[cat] ?? 0) + 1;
  return next;
}

/**
 * Hämta saknade (tag, combo)-par för en kategori, baserat på en önskad
 * uppsättning möjliga kombinationer (typ från buildRoundRobin).
 *
 * Returnerar lista av {tag, combo} som inte finns i state.
 */
export function missingCombos(
  state: CoverageState,
  cat: string,
  wantedByTag: Record<string, Array<[string, string, string]>>,
): Array<{ tag: string; combo: [string, string, string] }> {
  const out: Array<{ tag: string; combo: [string, string, string] }> = [];
  for (const [tag, combos] of Object.entries(wantedByTag)) {
    const existing = existingCombos(state, cat, tag);
    for (const c of combos) {
      if (!existing.has(comboKey(c))) {
        out.push({ tag, combo: c });
      }
    }
  }
  return out;
}

/**
 * Convenience: spara state till disk (efter en eller flera registerCombo).
 */
export function persist(state: CoverageState, rootDir: string = process.cwd()): void {
  saveCoverageState(state, rootDir);
}

/**
 * Nollställ state och returnera en tom CoverageState (single source of truth).
 * Använd --reset-state för att tvinga batch att generera N nya från scratch.
 */
export function resetCoverageState(rootDir: string = process.cwd()): CoverageState {
  const empty: CoverageState = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    totals: {},
    combos: {},
  };
  saveCoverageState(empty, rootDir);
  return empty;
}

/**
 * walkJsonFiles: skannar local_image_library_stamped rekursivt efter .webp.json.
 * Återanvänder samma logik som scripts/_zoom_backfill_coverage.ts.
 */
function walkJsonFiles(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkJsonFiles(p, out);
    else if (e.isFile() && e.name.endsWith('.webp.json')) out.push(p);
  }
  return out;
}

/**
 * reconcileFromDisk: synka state mot FACIT (faktiska .webp.json-filer på disk).
 *
 * Skannar `rootDir` + `stampedSubdir` (default: `local_image_library_stamped`)
 * rekursivt efter filer som slutar på `.webp.json`. Parsar varje fils JSON för
 * category/cluster_tag/zoomId/pose/light och registrerar via registerCombo
 * med source='disk-reconcile' (no-op om (cat, tag, combo) redan finns).
 *
 * Detta är "single source of truth"-sync: kör FÖRE computeAutoFillCount så att
 * state.combos/totals speglar verkligheten. Disk är sanningen — state är cache.
 *
 * Returnerar { next, added, skipped, scanned }.
 * Om stampedDir saknas: returnerar { next: state, added: 0, skipped: 0, scanned: 0 }.
 * Om filparsning failar: hoppar över och räknas som skipped.
 */
export function reconcileFromDisk(
  state: CoverageState,
  rootDir: string = process.cwd(),
  stampedSubdir: string = 'local_image_library_stamped',
): { next: CoverageState; added: number; skipped: number; scanned: number } {
  const stampedDir = join(rootDir, stampedSubdir);
  let next = state;
  let added = 0;
  let skipped = 0;
  let scanned = 0;

  if (!existsSync(stampedDir)) {
    return { next, added, skipped, scanned };
  }

  const files = walkJsonFiles(stampedDir);
  scanned = files.length;

  for (const f of files) {
    try {
      const raw = readFileSync(f, 'utf8');
      const d = JSON.parse(raw) as {
        category?: string;
        cluster_tag?: string;
        zoomId?: string;
        pose?: string;
        light?: string;
        created_at?: string;
        stamped_path?: string;
      };
      const cat = d.category;
      const tag = d.cluster_tag;
      const zoomId = d.zoomId;
      const pose = d.pose;
      const light = d.light;
      if (!cat || !tag || !zoomId || !pose || !light) {
        skipped++;
        continue;
      }
      const before = next.totals[cat] ?? 0;
      next = registerCombo(
        next,
        cat,
        tag,
        [zoomId, pose, light],
        'disk-reconcile',
        d.created_at ?? new Date().toISOString(),
        d.stamped_path,
      );
      const after = next.totals[cat] ?? 0;
      if (after > before) added++;
      else skipped++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[reconcile] hoppade över ${f}: ${msg}`);
      skipped++;
    }
  }

  return { next, added, skipped, scanned };
}