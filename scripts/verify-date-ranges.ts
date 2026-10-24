/**
 * verify-date-ranges.ts — oberoende kontroll av datumintervall i extraktorn.
 *
 * VARFÖR ett eget skript: en gate som bara kör produktionens egna test
 * bevisar att koden gör vad den gjorde i går. Här byggs en ORACLE som är
 * skriven oberoende av produktionen (egen regex, egen årshärledning, egen
 * valregel) och jämförs mot extraktorns verkliga utdata på RIKTIG korpustext.
 *
 * MODER:
 *   dr1 — positiv kontroll: extraktorn ligger inom oracle-fönstret på ALLA
 *         korpusrader som innehåller ett svenskt datumintervall, och
 *         produktionens datum-API ger de HANDSKRIVNA förväntade värdena på
 *         ett fixturset.
 *   dr2 — negativ kontroll: en MUTERAD KOPIA av extraktorn (temp-fil i samma
 *         katalog — originalet muteras aldrig) måste avvika från oracle på
 *         fixtursetet. Utan detta bevisar dr1 ingenting: en oracle som alltid
 *         håller med om allt är värdelös.
 *   dr3 — live-bevis: C-gatens extragerade events för de berörda källorna
 *         har giltiga datum.
 *
 * Utskrift: `drN: <mätning> pass` på stdout, exit 0. Vid fel: `drN: FAIL …`
 * på stderr, exit 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CORPUS = path.join(ROOT, '03-Queue', '03-extractedevents');
const EXTRACTOR_DIR = path.join(ROOT, '02-Ingestion', 'F-eventExtraction');
const EXTRACTOR = path.join(EXTRACTOR_DIR, 'universal-extractor.ts');

const mode = process.argv[2] ?? 'dr1';

function ok(msg: string): void {
  console.log(msg);
  process.exit(0);
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ─── ORACLE ─────────────────────────────────────────────────────────────────
// Skriven oberoende av 02-Ingestion/F-eventExtraction/universal-extractor.ts.
// Den delar INTE kod med extraktorn — bara den svenska datumformen.

const MONTH_WORDS = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti',
  'september', 'oktober', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
];

const MONTH_NUM: Record<string, string> = {
  januari: '01', februari: '02', mars: '03', april: '04', maj: '05', juni: '06',
  juli: '07', augusti: '08', september: '09', oktober: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08',
  sep: '09', okt: '10', nov: '11', dec: '12',
};

const MONTH_ALT = MONTH_WORDS.join('|');
/** Månadsnamnet måste vara ett helt ord — "mar" i "Maria" är inte mars. */
const NOT_LETTER = '(?![a-zåäö])';
/** Dagen får inte vara de sista siffrorna i ett år ("2026–28 februari"). */
const NOT_DIGIT_BEFORE = '(?<!\\d)';

const SAME_MONTH_RX = new RegExp(
  `${NOT_DIGIT_BEFORE}(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})\\s+(${MONTH_ALT})${NOT_LETTER}\\w*?(?:\\s*[.,]?\\s*(\\d{4}))?`,
  'gi',
);
const CROSS_MONTH_RX = new RegExp(
  `${NOT_DIGIT_BEFORE}(\\d{1,2})\\s+(${MONTH_ALT})${NOT_LETTER}\\w*?(?:\\s*[.,]?\\s*(\\d{4}))?\\s*[-–—]\\s*(\\d{1,2})\\s+(${MONTH_ALT})${NOT_LETTER}\\w*?(?:\\s*[.,]?\\s*(\\d{4}))?`,
  'gi',
);

interface OracleRange {
  index: number;
  hasYear: boolean;
  start: string;
  end: string;
}

const pad = (n: number | string): string => String(n).padStart(2, '0');

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Årslöst intervall: året är det år då SLUTDAGEN inträffar (eller nästa).
 * Ett pågående evenemang får inte förloras till nästa år.
 */
function inferEndYear(monthNum: string, endDay: number, now: Date): number {
  const today = now.toISOString().slice(0, 10);
  const thisYear = now.getUTCFullYear();
  const endThisYear = `${thisYear}-${monthNum}-${pad(endDay)}`;
  if (isValidIsoDate(endThisYear) && endThisYear >= today) return thisYear;
  const nextYear = thisYear + 1;
  if (isValidIsoDate(`${nextYear}-${monthNum}-${pad(endDay)}`)) return nextYear;
  return thisYear;
}

function sameMonthRange(m: RegExpExecArray, now: Date): OracleRange | null {
  const d1 = Number(m[1]);
  const d2 = Number(m[2]);
  const monthNum = MONTH_NUM[(m[3] ?? '').toLowerCase()];
  if (!monthNum) return null;
  if (!(d1 >= 1 && d1 <= 31) || !(d2 >= 1 && d2 <= 31)) return null;

  const year = m[4] ? Number(m[4]) : inferEndYear(monthNum, d2, now);
  if (!Number.isFinite(year)) return null;

  const start = `${year}-${monthNum}-${pad(d1)}`;
  if (!isValidIsoDate(start)) return null;
  let end = `${year}-${monthNum}-${pad(d2)}`;
  if (!isValidIsoDate(end)) return null;
  // Intervallet får korsa årsskiftet ("29-31 december").
  if (end < start) {
    end = `${year + 1}-${monthNum}-${pad(d2)}`;
    if (!isValidIsoDate(end)) return null;
  }
  return { index: m.index, hasYear: Boolean(m[4]), start, end };
}

function crossMonthRange(m: RegExpExecArray, now: Date): OracleRange | null {
  const d1 = Number(m[1]);
  const d2 = Number(m[4]);
  const month1 = MONTH_NUM[(m[2] ?? '').toLowerCase()];
  const month2 = MONTH_NUM[(m[5] ?? '').toLowerCase()];
  if (!month1 || !month2) return null;
  if (month1 === month2) return null; // Samma månad är ett vanligt intervall.
  if (!(d1 >= 1 && d1 <= 31) || !(d2 >= 1 && d2 <= 31)) return null;

  const y1 = m[3] ? Number(m[3]) : null;
  const y2 = m[6] ? Number(m[6]) : null;

  let startYear: number;
  let endYear: number;
  if (y2 !== null) {
    endYear = y2;
    startYear = y1 ?? y2 - (month1 > month2 ? 1 : 0);
  } else if (y1 !== null) {
    startYear = y1;
    endYear = y1 + (month2 < month1 ? 1 : 0);
  } else {
    endYear = inferEndYear(month2, d2, now);
    startYear = endYear - (month1 > month2 ? 1 : 0);
  }

  const start = `${startYear}-${month1}-${pad(d1)}`;
  const end = `${endYear}-${month2}-${pad(d2)}`;
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return null;
  if (end < start) return null;
  return { index: m.index, hasYear: Boolean(m[3] || m[6]), start, end };
}

/**
 * Oracle-regeln: ett intervall MED år vinner alltid. Inom samma klass vinner
 * det intervall som nämns FÖRST i texten.
 */
function oracleRange(text: string, now: Date): OracleRange | null {
  const candidates: OracleRange[] = [];

  SAME_MONTH_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SAME_MONTH_RX.exec(text)) !== null) {
    const r = sameMonthRange(m, now);
    if (r) candidates.push(r);
  }

  CROSS_MONTH_RX.lastIndex = 0;
  while ((m = CROSS_MONTH_RX.exec(text)) !== null) {
    const r = crossMonthRange(m, now);
    if (r) candidates.push(r);
  }

  candidates.sort((a, b) => a.index - b.index);
  const withYear = candidates.filter((c) => c.hasYear);
  if (withYear.length > 0) return withYear[0];
  return candidates[0] ?? null;
}

// ─── FIXTUR ─────────────────────────────────────────────────────────────────
// Handskrivna förväntningar. De är ORAKELNS egen kontroll: om oracle och
// fixtring inte håller med om samma sak är en av dem trasig.

const FIXED_NOW = new Date('2026-10-24T00:00:00Z');

interface Fixture {
  name: string;
  text: string;
  /** null = texten ska INNEHÅLLA något datumintervall alls. */
  start: string | null;
  end: string | null;
}

const FIXTURES: Fixture[] = [
  {
    name: 'vanligt intervall med år',
    text: 'Konserten spelas 12-14 januari 2027 i Stockholm.',
    start: '2027-01-12', end: '2027-01-14',
  },
  {
    name: 'korsmånadsintervall med år',
    text: 'Utställningen pågår 3 oktober 2026–28 februari 2027.',
    start: '2026-10-03', end: '2027-02-28',
  },
  {
    name: 'året får inte läsas som dagen (lookbehind)',
    text: 'Byggnaden invigdes 2030 - 7 maj i helgen.',
    start: null, end: null,
  },
  {
    name: 'två intervall — det första vinner',
    text: 'Höstlovstema går 24-25 oktober och 31 oktober–1 november.',
    start: '2026-10-24', end: '2026-10-25',
  },
  {
    name: 'med år vinner över årslöst även om det årslösta står först',
    text: 'Teasern säger 5-13 maj, men datumet är 7-8 maj 2026.',
    start: '2026-05-07', end: '2026-05-08',
  },
  {
    name: 'årslöst intervall — året härleds från slutdagen',
    text: 'Öppet 23-28 oktober.',
    start: '2026-10-23', end: '2026-10-28',
  },
  {
    name: 'intervall får korsa årsskiftet',
    text: 'Nyårskiva 29-31 december.',
    start: '2026-12-29', end: '2026-12-31',
  },
  {
    name: 'månadsnamnet måste vara ett helt ord',
    text: 'Maria Larkman spelar 12-17 mars.',
    start: '2027-03-12', end: '2027-03-17',
  },
];

// ─── KORPUS ─────────────────────────────────────────────────────────────────

interface CorpusRow {
  source: string;
  title: string;
  description: string;
  url: string;
  expected: OracleRange;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function collectRows(): CorpusRow[] {
  const rows: CorpusRow[] = [];
  // Referensdagen är NU. Ett årslöst intervall kan byta år mellan idag och
  // i morgon, så varje rad accepteras inom fönstret för BÅDA dagarna. Ett
  // intervall med utskrivet år har bara ett fönster.
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);

  for (const file of walk(CORPUS)) {
    const source = path.basename(file, '.jsonl');
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o: any;
      try { o = JSON.parse(line); } catch { continue; }
      const title = String(o.title ?? '');
      const description = String(o.description ?? '');
      const text = `${title} ${description}`;
      const expected = oracleRange(text, now);
      if (!expected) continue;
      const alt = expected.hasYear ? null : oracleRange(text, tomorrow);
      rows.push({
        source, title, description,
        url: String(o.url ?? ''),
        expected,
        alt,
      } as CorpusRow);
    }
  }
  return rows;
}

function htmlFor(row: CorpusRow): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<html><body><main>
    <article class="event">
      <h2>${esc(row.title)}</h2>
      <p>${esc(row.description)}</p>
      <a href="${esc(row.url)}">${esc(row.title)}</a>
    </article>
  </main></body></html>`;
}

type Extractor = (html: string, source: string, baseUrl: string) => { events?: any[] };
type RangeParser = (text: string, options?: { now?: Date; allowInferredYear?: boolean }) => { start: string; end: string } | null;

async function loadExtractor(modulePath: string): Promise<Extractor> {
  const mod = await import(pathToFileURL(modulePath).href);
  return mod.extractEvents as Extractor;
}

async function loadRangeParser(modulePath: string): Promise<RangeParser> {
  const mod = await import(pathToFileURL(modulePath).href);
  return mod.parseSwedishDateRange as RangeParser;
}

function extractDate(extract: Extractor, row: CorpusRow): string {
  const result = extract(htmlFor(row), row.source, row.url);
  const events = (result.events ?? []) as any[];
  const match = events.find((e) => String(e.title ?? '').trim() === row.title.trim()) ?? events[0];
  return match ? String(match.date ?? '') : '';
}

// ─── MUTANT (negativ kontroll) ──────────────────────────────────────────────

interface Mutation {
  name: string;
  find: string;
  replace: string;
}

/**
 * Tre mutationer som bryter en REGEL i tag. Originalfilen rörs aldrig —
 * mutationen skrivs till en temp-fil i samma katalog (så att de relativa
 * importerna fortfarande löser sig) och raderas efteråt.
 */
const MUTATIONS: Mutation[] = [
  {
    // Bryter "det FÖRSTA intervallet i texten vinner".
    name: 'sista-intervallet-vinner',
    find: 'out.sort((a, b) => a.index - b.index);',
    replace: 'out.sort((a, b) => b.index - a.index);',
  },
  {
    // Bryter lookbehind-skyddet: "2030 - 7 maj" får läsas som "30-7 maj".
    name: 'lookbehind-bort',
    find: '`(?<!\\\\d)(\\\\d{1,2})\\\\s*[-–—]\\\\s*(\\\\d{1,2})',
    replace: '`(\\\\d{1,2})\\\\s*[-–—]\\\\s*(\\\\d{1,2})',
  },
  {
    // Bryter "ett intervall MED år vinner alltid".
    name: 'arslost-forst',
    find: 'parseSwedishRangeWithYear(text, options) ??\n    parseSwedishRangeWithoutYear(text, options)',
    replace: 'parseSwedishRangeWithoutYear(text, options) ??\n    parseSwedishRangeWithYear(text, options)',
  },
];

async function runMutant(mutation: Mutation): Promise<string[]> {
  const source = fs.readFileSync(EXTRACTOR, 'utf8');
  if (!source.includes(mutation.find)) {
    fail(`dr2: FAIL mutationen "${mutation.name}" hittade inte sin måltext i extraktorn — kontrollen mäter ingenting`);
  }
  const mutantPath = path.join(EXTRACTOR_DIR, `__mutant-${mutation.name}.ts`);
  try {
    fs.writeFileSync(mutantPath, source.replace(mutation.find, mutation.replace));
    const parse = await loadRangeParser(mutantPath);
    const deviating: string[] = [];
    for (const fixture of FIXTURES) {
      const got = parse(fixture.text, { now: FIXED_NOW });
      const gotStart = got ? got.start : null;
      const gotEnd = got ? got.end : null;
      if (gotStart !== fixture.start || gotEnd !== fixture.end) {
        deviating.push(fixture.name);
      }
    }
    return deviating;
  } finally {
    try { fs.unlinkSync(mutantPath); } catch { /* redan bort */ }
  }
}

// ─── MODER ──────────────────────────────────────────────────────────────────

/** Oracle mot produktionens datum-API på det handskrivna fixtursetet. */
function checkFixtures(parse: RangeParser, label: string): string[] {
  const problems: string[] = [];
  for (const fixture of FIXTURES) {
    const oracle = oracleRange(fixture.text, FIXED_NOW);
    const oracleStart = oracle ? oracle.start : null;
    const oracleEnd = oracle ? oracle.end : null;
    if (oracleStart !== fixture.start || oracleEnd !== fixture.end) {
      problems.push(
        `${label}: oracle för "${fixture.name}" ger ${oracleStart ?? 'null'}..${oracleEnd ?? 'null'} ` +
        `men fixturet säger ${fixture.start ?? 'null'}..${fixture.end ?? 'null'}`,
      );
      continue;
    }
    const got = parse(fixture.text, { now: FIXED_NOW });
    const gotStart = got ? got.start : null;
    const gotEnd = got ? got.end : null;
    if (gotStart !== fixture.start || gotEnd !== fixture.end) {
      problems.push(
        `${label}: "${fixture.name}" ger ${gotStart ?? 'null'}..${gotEnd ?? 'null'} ` +
        `men förväntat ${fixture.start ?? 'null'}..${fixture.end ?? 'null'}`,
      );
    }
  }
  return problems;
}

async function dr1(): Promise<void> {
  const parse = await loadRangeParser(EXTRACTOR);
  const fixtureProblems = checkFixtures(parse, 'dr1');
  if (fixtureProblems.length > 0) {
    console.error(`dr1: FAIL ${fixtureProblems.length} fixturproblem`);
    for (const p of fixtureProblems) console.error('  ' + p);
    process.exit(1);
  }

  const rows = collectRows();
  if (rows.length === 0) {
    fail('dr1: FAIL korpuset innehåller inga rader med datumintervall — mätningen kan inte skilja rätt från fel');
  }
  const extract = await loadExtractor(EXTRACTOR);
  const wrong: string[] = [];
  for (const row of rows) {
    const date = extractDate(extract, row);
    const inExpected = date >= row.expected.start && date <= row.expected.end;
    const alt = (row as any).alt as OracleRange | null;
    const inAlt = alt ? date >= alt.start && date <= alt.end : false;
    if (!inExpected && !inAlt) {
      wrong.push(
        `[${row.source}] "${row.title.slice(0, 60)}" datum=${date || '(saknas)'} ` +
        `förväntat ${row.expected.start}..${row.expected.end}`,
      );
    }
  }
  if (wrong.length > 0) {
    console.error(`dr1: FAIL ${wrong.length}/${rows.length} korpusrader ligger utanför oracle-fönstret`);
    for (const w of wrong.slice(0, 10)) console.error('  ' + w);
    process.exit(1);
  }
  ok(`dr1: fixtrar=${FIXTURES.length} rader=${rows.length} avvikelser=0 pass`);
}

async function dr2(): Promise<void> {
  const results: string[] = [];
  for (const mutation of MUTATIONS) {
    const deviating = await runMutant(mutation);
    if (deviating.length === 0) {
      fail(
        `dr2: FAIL mutationen "${mutation.name}" avviker INTE från oracle på något fixtur — ` +
        'oraklet kan inte skilja rätt från fel, så dr1 bevisar ingenting',
      );
    }
    results.push(`${mutation.name}=[${deviating.join(', ')}]`);
  }
  ok(`dr2: negativ kontroll ${results.join(' ')} fixtrar=${FIXTURES.length} pass`);
}

async function dr3(): Promise<void> {
  // Live-bevis: C-gatens extragerade events för de källor som datumfixen
  // berör. Läses från C-gatens utdata — inte från korpuset.
  const sandbox = process.env.EVENTPULSE_SANDBOX_ROOT;
  const outDir = sandbox
    ? path.join(sandbox, '03-Queue', '03-extractedevents', 'C')
    : path.join(ROOT, '03-Queue', '03-extractedevents', 'C');

  const AFFECTED = [
    'lokalhelhet-calendar', 'berwaldhallen', 'dansenshus', 'dn-kalendariet',
    '3arena', 'aviciiarena', 'stockholmlive-evenemang', 'oscarsteatern',
    'billetto-stockholm', 'eventbrite-stockholm', 'vadkul-stockholm',
    'fotografiska', 'wwwtekniskamuseetse', 'pingstkyrkan',
  ];

  const found: string[] = [];
  let total = 0;
  const bad: string[] = [];
  for (const source of AFFECTED) {
    const file = path.join(outDir, `${source}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    if (lines.length === 0) continue;
    found.push(source);
    for (const line of lines) {
      let o: any;
      try { o = JSON.parse(line); } catch { continue; }
      const date = String(o.date ?? '');
      total++;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        bad.push(`[${source}] "${String(o.title ?? '').slice(0, 50)}" ogiltigt datum "${date}"`);
      }
    }
  }

  if (found.length === 0) {
    fail(`dr3: FAIL ingen av de berörda källorna finns i ${outDir} — live-beviset saknas`);
  }
  if (bad.length > 0) {
    console.error(`dr3: FAIL ${bad.length}/${total} extraherade events har ogiltigt datum`);
    for (const b of bad.slice(0, 10)) console.error('  ' + b);
    process.exit(1);
  }
  ok(`dr3: källor=${found.length} events=${total} ogiltiga=0 pass`);
}

async function main(): Promise<void> {
  if (mode === 'dr1') return dr1();
  if (mode === 'dr2') return dr2();
  if (mode === 'dr3') return dr3();
  fail(`usage: npx tsx scripts/verify-date-ranges.ts <dr1|dr2|dr3>`);
}

main().catch((e) => fail(`${mode}: FAIL threw: ${e?.message ?? e}`));
