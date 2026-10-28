/**
 * importLedger.mjs — filnivå-idempotens för importen.
 *
 * Varför (2026-10-28). Två vägar importerar till samma kö:
 *
 *   02:00  scripts/ingestion-cron.ts → import-to-eventpulse → worker-drain
 *   04:00  runPostIngest.sh → runDaily.ts → ingestionPipeline.ts → import
 *
 * Utan en ledger kördes samma extractedevents-filer igen varje natt, och
 * varje körning köade upp events som redan fanns i databasen. Det är
 * dyrt (köer som växer), och det är svårt att se i loggen vad som
 * faktiskt är nytt.
 *
 * Vad ledger gör: en fil som redan importerats OCH PERSISTERATS med
 * SAKÄNN content hoppas över. Nytt innehåll → ny import.
 *
 * Varför hash och inte bara mtime (avvikelse från planens ord "fileMtime"):
 *   Planen föreslog `fileMtime` som nyckel. Mätning visar att det inte
 *   räcker: runA-extract skriver om filen varje natt (`writeFileSync` utan
 *   jämförelse), så mtime ändras trots identiskt innehåll. En mtime-baserad
 *   ledger skulle därför aldrig hoppa över något — varken mellan de två
 *   vägarna (04:00 kör efter 02:00 och skriver om filerna) eller natt efter
 *   natt. Vi registrerar därför BÅDE fileMtime (som planen säger) och en
 *   content-hash, och det är hashen som avgör.
 *
 *   fileMtime finns kvar i ledgerfilen för att kunna se när filen senast
 *   ändrades — användbart vid felsökning.
 *
 * TVÅ FASER (2026-10-28) — queued → persisted.
 *
 *   Enfas-ledgern registrerade källan vid KÖ-tid. Men jobben ligger bara i
 *   Redis: om dräneringen sedan misslyckas (Redis dör, ingen persistence),
 *   är jobben borta — och ledger säger ändå "importerad". Nästa natt hoppar
 *   importen över källan, och de eventen är förlorade för alltid.
 *
 *   Nu finns det två faser:
 *     queued    — importeraren köade upp jobben (skrivs av importen)
 *     persisted — dräneringen skrev dem till databasen (skrivs av drainen)
 *
 *   Bara 'persisted' hoppas över. En källa som stannade i 'queued' (drainen
 *   föll, eller kördes aldrig) importeras om nästa natt — dedup-hashen i
 *   databasen gör att de redan persisterade eventen inte dubblas, och de
 *   som saknas kommer ikapp.
 *
 * BEVIS, INTE ANTAGANDEN (2026-10-28, tredje rundan).
 *
 *   Den första tvåfas-versionen flipade alla 'queued'-rader till
 *   'persisted' så snart körningen var TOM och inget jobb hade fallerat.
 *   Det räcker inte: körningen kan vara tom för att Redis dog utan
 *   persistence — jobben är då borta, inte persisterade. Ledger ljög, och
 *   nästa natt hoppade importen över källorna.
 *
 *   Nu krävs BEVIS: dräneringen räknar hur många jobb som faktiskt kördes
 *   till färd per KÄLLA, och en rad får bara 'persisted' om antalet täcker
 *   det som importeraren köade upp. `bySource` i raden bryter ned antalet
 *   per kanonisk källa (en fil kan ge flera kanoniska källor — t.ex.
 *   berwaldhallen-tixly → berwaldhallen).
 *
 *   FYRDE RUNDAN (2026-10-28) — beviset får INTE lånas mellan filer. Två
 *   filer kan ge samma kanonisk källa, och räknaren är per kanonisk källa
 *   medan kravet är per fil. En radvis jämförelse lät fil A:s bevis täcka
 *   fil B:s krav → B flippa till 'persisted' utan att B:s jobb kördes, och
 *   B:s events förlorades för alltid. Kraven summeras därför per kanonisk
 *   källa: antingen täcker beviset hela summan, eller ingen rad med den
 *   källan flippar. Ett TOMT bySource är dessutom inget bevis alls.
 *
 * FEMTE RUNDAN (2026-10-28) — beviset räknas PER FIL, inte per kanonisk
 *   källa. Två luckor i fjärde rundan gjorde att modellen fortfarande kunde
 *   ljuga:
 *
 *   1. En GAMMAL 'queued'-rad som ligger kvar höjde kravsumman för evigt —
 *      en källa kunde aldrig flippa igen.
 *   2. En fil som delvis MISLYCKADES räknade de jobb den ändå köade, så
 *      ett bevis från en annan fil kunde få den att flippa — trots att
 *      ett event aldrig sparades.
 *
 *   Lösningen: jobbets payload bär vilken FIL det kom från
 *   (`import_file`), och importen räknar de jobb som faktiskt bär dess
 *   egen fil. Varje ledger-rad jämförs mot SIN räknare — aldrig mot
 *   någon annan rads. Ingen summa, inget lån, ingen gammal kvittensrad
 *   som kan låsa en källa.
 *
 * FYRDE RADERN (2026-10-28) — en rad som importerades med fel får state
 *   'failed'. Den flippar ALDRIG till 'persisted' och importeras om nästa
 *   natt. En rad som lade in NOLL jobb får state 'empty' — den har inget
 *   att bevisa och inget att importera om (men om filens innehåll ändras
 *   ändras hashen, och då importeras den igen).
 *
 * GAMLA RADER (utan 'state') räknas som 'queued' — de saknar bevis. De
 *   importeras om en gång, och den nya raden får bevis. Att behandla dem
 *   som 'persisterade' vore att gissa.
 *
 * Format: JSONL, en rad per källa. Filen skrivs om (inte appendad) efter
 * varje importkörning, så den växer aldrig obegränsat. Raderna:
 *   {"sourceId":"…","fileMtime":1730000000000,"fileHash":"…","enqueued":12,
 *    "jobs":12,"state":"queued","at":"…"}
 *
 * Återställning: radera filen → nästa körning importerar allt igen.
 * Dedup-hash + (source, source_id) i databasen är backstoppen.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Standardplats för ledgerfilen, relativt projektroten. */
export const LEDGER_RELATIVE_PATH = path.join('runtime', 'import-ledger.jsonl');

/**
 * @typedef {{
 *   fileMtime: number,
 *   fileHash: string,
 *   enqueued: number,
 *   jobs?: number,
 *   state: 'queued' | 'persisted' | 'empty' | 'failed',
 *   at: string,
 * }} LedgerRow
 */

/**
 * Läs ledgerfilen. En trasig eller saknad fil ger en tom ledger — då
 * importeras allt igen, vilket är den säkra utgångsläget.
 *
 * @param {string} ledgerPath
 * @returns {Map<string, LedgerRow>}
 */
export function loadLedger(ledgerPath) {
  /** @type {Map<string, LedgerRow>} */
  const map = new Map();
  let raw;
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    return map; // filen finns inte → tom ledger
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (typeof row?.sourceId !== 'string') continue;
      map.set(row.sourceId, {
        fileMtime: Number(row.fileMtime ?? 0),
        fileHash: typeof row.fileHash === 'string' ? row.fileHash : '',
        enqueued: Number(row.enqueued ?? 0),
        // 'jobs' = antalet jobb importen lade in ÅT DENNA FIL. Rader utan
        // fältet kommer från äldre ledgers: de har INTE bevis på att
        // jobben persisterades → de räknas som 'queued' och importeras om
        // en gång.
        jobs: parseJobs(row.jobs),
        state: parseState(row.state),
        at: typeof row.at === 'string' ? row.at : '',
      });
    } catch {
      // En trasig rad får inte stoppa hela ledgerfilen.
    }
  }
  return map;
}

/**
 * Tolka 'jobs'-fältet. En rad utan fältet (äldre ledger) saknar krav —
 * den får aldrig flippa till 'persisted'.
 *
 * @param {unknown} value
 * @returns {number | undefined}
 */
function parseJobs(value) {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/**
 * Tolka 'state'-fältet. Okända värden räknas som 'queued' — ingen bevis,
 * alltså importeras källan om en gång.
 *
 * @param {unknown} value
 * @returns {LedgerRow['state']}
 */
function parseState(value) {
  if (value === 'persisted') return 'persisted';
  if (value === 'empty') return 'empty';
  if (value === 'failed') return 'failed';
  return 'queued';
}

/**
 * Skriv ledgerfilen atomärt (tmp + rename) så att en avbruten körning
 * inte lämnar en halv fil som nästa körning inte kan läsa.
 *
 * @param {string} ledgerPath
 * @param {Map<string, LedgerRow>} map
 */
export function saveLedger(ledgerPath, map) {
  const dir = path.dirname(ledgerPath);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sourceId, row]) =>
      JSON.stringify({
        sourceId,
        fileMtime: row.fileMtime,
        fileHash: row.fileHash,
        enqueued: row.enqueued,
        // 'jobs' skrivs bara när det finns — en rad UTAN jobs betyder
        // "inget krav/bevis", och fältet ska inte se ut att saknas av misstag.
        ...(row.jobs === undefined ? {} : { jobs: row.jobs }),
        state: row.state,
        at: row.at,
      }),
    );
  const tmpPath = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmpPath, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tmpPath, ledgerPath);
}

/**
 * Har denna källa redan importerats med exakt samma innehåll?
 *
 * - 'persisted' → jobben gick igenom till databasen (bevis finns).
 * - 'empty'     → filen lade inte in något jobb (inget att importera om).
 * - 'queued'    → jobben ligger bara i Redis. Om de försvinner (Redis dör)
 *                 måste källan importeras om.
 * - 'failed'    → importen misslyckades. Källan importeras om.
 *
 * @param {Map<string, LedgerRow>} ledger
 * @param {string} sourceId
 * @param {string} fileHash
 * @returns {boolean}
 */
export function isAlreadyImported(ledger, sourceId, fileHash) {
  if (!fileHash) return false;
  const row = ledger.get(sourceId);
  if (!row || row.fileHash !== fileHash) return false;
  return row.state === 'persisted' || row.state === 'empty';
}

/**
 * Registrera en import — i fasen 'queued' (jobben ligger bara i Redis).
 *
 * Returnerar en NY ledger (immutabilitet): den inkommande Mapen lämnas
 * orörd.
 *
 * @param {Map<string, LedgerRow>} ledger
 * @param {string} sourceId
 * @param {{ fileMtime: number; fileHash: string }} fingerprint
 * @param {number} enqueued antal rader som lades i kön
 * @param {string} at ISO-tid
 * @param {number} [jobs] antal DISTINKTA jobb denna fil lade in
 * @param {boolean} [failed] importen misslyckades → raden får aldrig bli 'persisted'
 * @returns {Map<string, LedgerRow>}
 */
export function recordImport(ledger, sourceId, fingerprint, enqueued, at, jobs, failed = false) {
  const next = new Map(ledger);
  next.set(sourceId, {
    fileMtime: fingerprint.fileMtime,
    fileHash: fingerprint.fileHash,
    enqueued,
    // 'jobs' är KRAVET: dräneringen måste köra minst så många jobb som
    // bär DENNA fils märke innan raden får bli 'persisted'.
    jobs: jobs === undefined ? undefined : jobs,
    // En misslyckad import får ALDRIG bli 'persisted' — en del av filens
    // events köades aldrig, och de får inte glömmas.
    state: failed ? 'failed' : jobs === 0 ? 'empty' : 'queued',
    at,
  });
  return next;
}

/**
 * Markera källor som persisterade — men bara där det finns BEVIS.
 *
 * `persistedByFile` är dräneringens räkning: hur många jobb som faktiskt
 * kördes till färd, per FIL (jobbets `import_file`).
 *
 * REGELN (2026-10-28, femte rundan — granskningsfynden HIGH-1/HIGH-2).
 * Varje rad jämförs mot SIN räknare. Aldrig mot en summa, aldrig mot
 * någon annan rad.
 *
 *   Varför: `bySource`/kravsumman kopplade ihop filer. Två filer kan ge
 *   samma kanoniska källa, och en gammal 'queued'-rad höjde kravsumman
 *   för evigt. Nu bär jobbet sin fil, räknaren är per fil, och radens
 *   krav är bara dess eget antal jobb.
 *
 * Rader UTAN `jobs` markeras aldrig — de saknar krav (äldre ledger).
 * Rader i state 'failed' markeras aldrig — importen var inte komplett.
 *
 * @param {Map<string, LedgerRow>} ledger
 * @param {Map<string, number>} persistedByFile
 * @returns {Map<string, LedgerRow>}
 */
export function markPersisted(ledger, persistedByFile) {
  const next = new Map(ledger);
  for (const [sourceId, row] of next) {
    if (row.state !== 'queued') continue;
    // Ingen krav → ingen bevis → stannar i 'queued'.
    if (row.jobs === undefined) continue;
    const got = persistedByFile.get(sourceId) ?? 0;
    if (got < row.jobs) continue;
    next.set(sourceId, { ...row, state: 'persisted' });
  }
  return next;
}

/**
 * Slå ihop en pågående import med den ledger som LIGGER på disk.
 *
 * VARFÖR (2026-10-28). Importen läser ledger i början och sparar i slutet.
 * Under tiden kan dräneringen flippa rader till 'persisted' — och då
 * skriver importens sparande tillbaka dem till 'queued'. Effekten: en källa
 * som faktiskt persisterades importeras om varje natt, i det bästa fall.
 *
 * REGELN. En rad på disk som är 'persisted' med SAMMA hash vinner över
 * importens 'queued'. Den har bevis (jobbens antal täckdes), medan
 * importen bara har köat jobb — och dedup-hashen i databasen gör att de
 * jobben inte skapar dubbletter.
 *
 * @param {Map<string, LedgerRow>} disk vad som ligger på disk just nu
 * @param {Map<string, LedgerRow>} pending vad importen har ändrat
 * @returns {Map<string, LedgerRow>}
 */
export function mergeLedger(disk, pending) {
  const merged = new Map(disk);
  for (const [sourceId, row] of pending) {
    const onDisk = disk.get(sourceId);
    if (
      onDisk &&
      (onDisk.state === 'persisted' || onDisk.state === 'empty') &&
      onDisk.fileHash === row.fileHash
    ) {
      merged.set(sourceId, onDisk);
      continue;
    }
    merged.set(sourceId, row);
  }
  return merged;
}

/**
 * Har ledger-förändringen gjort någon skillnad?
 *
 * VARFÖR (2026-10-28). `loadLedger` normaliserar gamla rader (utan 'state')
 * till 'queued'. Utan denna kontroll skrev varje importköring tillbaka
 * samma 184 rader med ett extra fält — filen "rördes" trots att ingenting
 * hade importerats. Gaten L3 påstår "ledgerfilen röds INTE"; det påståendet
 * ska vara sant, inte bara ungefär sant.
 *
 * @param {Map<string, LedgerRow>} a
 * @param {Map<string, LedgerRow>} b
 * @returns {boolean}
 */
export function ledgerChanged(a, b) {
  if (a.size !== b.size) return true;
  for (const [sourceId, rowA] of a) {
    const rowB = b.get(sourceId);
    if (!rowB) return true;
    if (
      rowA.fileMtime !== rowB.fileMtime ||
      rowA.fileHash !== rowB.fileHash ||
      rowA.enqueued !== rowB.enqueued ||
      rowA.state !== rowB.state ||
      rowA.at !== rowB.at
    ) {
      return true;
    }
    const jobsA = rowA.jobs;
    const jobsB = rowB.jobs;
    if (jobsA !== jobsB) return true;
  }
  return false;
}
