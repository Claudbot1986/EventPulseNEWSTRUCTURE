/**
 * verify-status-truth.ts — kontroll att sources_status.jsonl inte ljuger.
 *
 * VARFÖR ett eget skript: kedjan C → D → import → drain kan lyckas och
 * ändå lämna källan som `fail` i statusfilen. Det är inte en kosmetisk
 * detalj: felräknaren (`consecutiveFailures`) stiger vid varje sådan
 * körning, och vid 5 begravs källan — en källa som fungerar försvinner ur
 * pipelinen.
 *
 * MÄTER: invarianten "en källa som D-gaten lyckades extrahera ifrån ska
 * stå som `success` i sources_status.jsonl, med felräknaren nollställd
 * och utan kvarvarande lastError".
 *
 * RÄCKVIDD: bara levande källor i scope (sources/<id>.jsonl finns och
 * city = Stockholm). Burkade/retirerade källor och källor utanför
 * Stockholm räknas inte — de hör till andra beslut.
 *
 * MODER:
 *   st1 — positiv kontroll: live-data. Varje källa i postD-UI som är
 *         levande och i scope ska stå som success. (Den här gaten kan
 *         faila idag — det är poängen.)
 *   st2 — negativ kontroll: samma mätning mot en MUTERAD KOPIA av
 *         statusfilen där statusradens felräknare inte nollställs. Utan
 *         denna kontroll bevisar st1 ingenting.
 *
 * Utskrift: `stN: <mätning> pass` på stdout, exit 0. Vid fel:
 * `stN: FAIL …` på stderr, exit 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const mode = process.argv[2] ?? 'st1';

const RUNTIME_DIR = path.join(ROOT, 'runtime');
const SOURCES_DIR = path.join(ROOT, 'sources');
const STATUS_FILE = path.join(RUNTIME_DIR, 'sources_status.jsonl');
const POST_D_UI = path.join(RUNTIME_DIR, 'postD-UI.jsonl');
const D_EXTRACTED_DIR = path.join(ROOT, '03-Queue', '03-extractedevents', 'D');

function ok(msg: string): void {
  console.log(msg);
  process.exit(0);
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

interface StatusRow {
  sourceId: string;
  status?: string;
  lastEventsFound?: number;
  consecutiveFailures?: number;
  lastError?: string;
  lastPathUsed?: string;
}

function readJsonl(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  const out: any[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* trasig rad — hoppas över */
    }
  }
  return out;
}

/** Källan lever (filen finns) och ligger i scope (city = Stockholm). */
function isAliveInScope(sourceId: string): boolean {
  const file = path.join(SOURCES_DIR, `${sourceId}.jsonl`);
  if (!fs.existsSync(file)) return false;
  const rows = readJsonl(file);
  if (rows.length === 0) return false;
  const city = String(rows[0].city ?? '').trim();
  return city === 'Stockholm';
}

/**
 * De källor som D-gaten lyckades med. postD-UI är en append-kö, så
 * samma källa kan ligga flera gånger — bara förekomsten spelar roll.
 */
function dSucceededSources(): string[] {
  const ids = new Set<string>();
  for (const row of readJsonl(POST_D_UI)) {
    const id = String(row.sourceId ?? '').trim();
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

interface Violation {
  sourceId: string;
  reason: string;
}

interface Measurement {
  violations: Violation[];
  checked: number;
  /** D-extragerad fil raderad efter import — inte ett fel, bara information. */
  cleanedFiles: number;
}

function findViolations(statusRows: StatusRow[]): Measurement {
  const byId = new Map<string, StatusRow>();
  for (const row of statusRows) {
    if (!row.sourceId) continue;
    byId.set(row.sourceId, row); // sista raden vinner
  }

  const violations: Violation[] = [];
  let checked = 0;
  let cleanedFiles = 0;

  for (const sourceId of dSucceededSources()) {
    if (!isAliveInScope(sourceId)) continue;
    checked++;

    const row = byId.get(sourceId);
    if (!row) {
      violations.push({ sourceId, reason: 'saknas helt i sources_status.jsonl' });
      continue;
    }
    if (row.status !== 'success') {
      violations.push({ sourceId, reason: `status=${row.status} (D-gaten lyckades med events)` });
      continue;
    }
    if (row.lastError) {
      violations.push({ sourceId, reason: `lastError kvar: ${String(row.lastError).slice(0, 70)}` });
      continue;
    }
    if ((row.consecutiveFailures ?? 0) > 0) {
      violations.push({
        sourceId,
        reason: `consecutiveFailures=${row.consecutiveFailures} trots success`,
      });
      continue;
    }
    if (!(row.lastEventsFound ?? 0) > 0) {
      violations.push({ sourceId, reason: `lastEventsFound=${row.lastEventsFound ?? 0} trots success` });
      continue;
    }
    // Filen ska vara icke-tom OM den finns. En raderad fil är inte ett fel:
    // D-gatens stale-artifact-rensning tar bort filen när en senare körning
    // hittade 0 events — eventen ligger då redan i databasen.
    const extracted = path.join(D_EXTRACTED_DIR, `${sourceId}.jsonl`);
    if (!fs.existsSync(extracted)) {
      cleanedFiles++;
    } else if (fs.readFileSync(extracted, 'utf8').trim() === '') {
      violations.push({ sourceId, reason: 'D-extragerad fil finns men är tom' });
    }
  }

  return { violations, checked, cleanedFiles };
}

function st1(): void {
  if (!fs.existsSync(STATUS_FILE)) {
    fail(`st1: FAIL ${STATUS_FILE} saknas — ingen status att verifiera`);
  }
  if (!fs.existsSync(POST_D_UI)) {
    fail(`st1: FAIL ${POST_D_UI} saknas — ingen D-körning att verifiera mot`);
  }

  const statusRows = readJsonl(STATUS_FILE) as StatusRow[];
  const { violations, checked, cleanedFiles } = findViolations(statusRows);

  if (checked === 0) {
    fail(
      `st1: FAIL ingen av källorna i postD-UI är levande och i scope — ` +
      'mätningen kan inte skilja rätt från fel',
    );
  }
  if (violations.length > 0) {
    console.error(`st1: FAIL ${violations.length}/${checked} källor säger fel i statusfilen`);
    for (const v of violations.slice(0, 15)) {
      console.error(`  [${v.sourceId}] ${v.reason}`);
    }
    process.exit(1);
  }
  ok(`st1: kontrollerade=${checked} statusfel=0 rensade_filer=${cleanedFiles} pass`);
}

/**
 * Negativ kontroll. Muterar en KOPIA av statusfilen (originalet rörs
 * aldrig) så att felräknaren inte nollställs — dvs. exakt det fel som
 * riksarkivet hade. Mätningen ska då hitta avvikelsen.
 */
function st2(): void {
  const statusRows = readJsonl(STATUS_FILE) as StatusRow[];

  const clean = findViolations(statusRows);
  if (clean.checked === 0) {
    fail('st2: FAIL st1:s mätning har inga källor att kontrollera');
  }

  // Mutera en kopia: felräknaren lämnas kvar trots success.
  const mutantPath = path.join(RUNTIME_DIR, '__mutant-sources_status.jsonl');
  const mutantRows = statusRows.map((row) =>
    row.status === 'success' && (row.lastEventsFound ?? 0) > 0 && row.sourceId
      ? { ...row, consecutiveFailures: 3 }
      : row,
  );
  try {
    fs.writeFileSync(mutantPath, mutantRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const mutant = findViolations(readJsonl(mutantPath) as StatusRow[]);
    if (mutant.violations.length === 0) {
      fail(
        'st2: FAIL den muterade statusfilen upptäcks INTE — ' +
        'mätningen kan inte skilja rätt från fel, så st1 bevisar ingenting',
      );
    }
    ok(
      `st2: negativ kontroll avvikelser=${mutant.violations.length} ` +
      `(kontrollerade=${mutant.checked}) pass`,
    );
  } finally {
    try {
      fs.unlinkSync(mutantPath);
    } catch {
      /* redan bort */
    }
  }
}

function main(): void {
  if (mode === 'st1') return st1();
  if (mode === 'st2') return st2();
  fail(`usage: npx tsx scripts/verify-status-truth.ts <st1|st2>`);
}

main();
