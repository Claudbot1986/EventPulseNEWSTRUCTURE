#!/usr/bin/env node
/**
 * verify-month-boundary.mjs — bevis för månadsnamnens ordgräns (2026-10-24).
 *
 * VARFÖR: månadsnamnen avslutades med `\b` (word boundary). Men en siffra ÄR
 * ett word-tecken — mellan "oktober" och "1" finns ingen word boundary. Därför
 * matchade aldrig "29 oktober185" (berwaldhallen.se: månad + pris utan
 * mellanrum). Kortet fick ingen datum-signal, C3 expanderade upp till en granne
 * med ett annat datum ("6 november"), och 21 av 22 konserter i listan fick
 * samma feldatum.
 *
 * Gaten har tre delar:
 *   1. LEVDAG — berwaldhallen.se hämtas LIVE och extraktorn körs på den.
 *      Rätt svar: konserten får 29 oktober. Före fixen: 6 november.
 *   2. SYNTHETISK POSITIV — "29 oktober185" ska ge 29 oktober.
 *   3. NEGATIV KONTROLL — "12 maria" får INTE ge 12 mars (månadsnamnet
 *      måste vara ett helt ord).
 *
 * `--negative-control` muterar en KOPIA av extraktorn tillbaka till `\b` och
 * kräver att samma kontroller då FAIL:ar. Annars bevisar gaten ingenting —
 * en gate som aldrig kan falla är inte en gate.
 *
 * Ingen syntetisk extraktion i produktion: del 1 är ett riktigt nätanrop mot
 * en riktig sida, del 2–3 är negativa kontroller mot inline-HTML.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTRACTOR_DIR = path.join(ROOT, '02-Ingestion', 'F-eventExtraction');
const EXTRACTOR_PATH = path.join(EXTRACTOR_DIR, 'universal-extractor.ts');
const NEGCTL_PATH = path.join(EXTRACTOR_DIR, '__negctl-extractor.ts');

const BERWALDHALLEN_URL = 'https://www.berwaldhallen.se';
const STREETSTAR_URL_PART = 'streetstardanceschoolchallenge2026-14-16-ar';

/**
 * Mutationer som återställer `\b`-beteendet i de tre regexarna.
 * Varje mönster måste vara unikt i filen — annars vore mutationen inte
 * densamma som före-fix-koden.
 */
const MUTATIONS = [
  {
    name: 'SWE_MONTH_FOLLOWS_LOOKAHEAD',
    from: 'const SWE_MONTH_FOLLOWS_LOOKAHEAD = `(?!\\\\s*(?:${SWE_MONTH_ALT})${SWE_MONTH_NOT_LETTER})`;',
    to: 'const SWE_MONTH_FOLLOWS_LOOKAHEAD = `(?!\\\\s*(?:${SWE_MONTH_ALT})\\\\b)`;',
  },
  {
    name: 'SWE_DATE_NO_YEAR_RX',
    from: '${SWE_MONTH_NOT_LETTER}(?!\\\\s*,?\\\\s*\\\\d{4})',
    to: '\\\\b(?!\\\\s*,?\\\\s*\\\\d{4})',
  },
  {
    name: 'SWE_EXPLICIT_DATE_RX',
    from: '${SWE_MONTH_NOT_LETTER}(?:\\\\s*,?\\\\s*(\\\\d{4}))?',
    to: '\\\\b(?:\\\\s*,?\\\\s*(\\\\d{4}))?',
  },
];

/** Bygger en före-fix-kopia av extraktorn. Returnerar sökvägen. */
function buildPrefixCopy() {
  const source = fs.readFileSync(EXTRACTOR_PATH, 'utf8');
  let mutated = source;
  for (const m of MUTATIONS) {
    const parts = mutated.split(m.from);
    if (parts.length !== 2) {
      throw new Error(
        `mutationen för ${m.name} träffar ${parts.length - 1} ställen (förväntat exakt 1) — ` +
          `kopian skulle inte vara före-fix-koden`,
      );
    }
    mutated = parts.join(m.to);
  }
  fs.writeFileSync(NEGCTL_PATH, mutated, 'utf8');
  return NEGCTL_PATH;
}

const failures = [];
const notes = [];

function check(name, ok, detail) {
  if (ok) {
    notes.push(`${name}=ok`);
    return true;
  }
  failures.push(`${name}: ${detail}`);
  return false;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** Kör de tre kontrollerna mot en given extraktor. Returnerar {failures, liveDate}. */
async function runChecks(extractorPath) {
  const { extractEvents } = await import(extractorPath);
  const localFailures = [];

  // 1. LEVDAG: berwaldhallen.se
  let liveDate = '';
  let liveTitle = '';
  try {
    const html = await fetchHtml(BERWALDHALLEN_URL);
    const result = extractEvents(html, 'berwaldhallen', BERWALDHALLEN_URL);
    const evt = result.events.find((e) => String(e.url ?? '').includes(STREETSTAR_URL_PART));
    if (!evt) {
      localFailures.push(`live: ingen rad med url ${STREETSTAR_URL_PART} i ${result.events.length} rader`);
    } else {
      liveDate = evt.date;
      liveTitle = evt.title;
      if (evt.date.slice(5) !== '10-29') {
        localFailures.push(`live: datumet blev ${evt.date} (väntat 10-29), titel "${evt.title}"`);
      }
    }
  } catch (e) {
    localFailures.push(`live: hämtning/extraction kastade: ${e.message}`);
  }

  // 2. SYNTHETISK POSITIV: månad + siffra utan mellanrum
  const positiveHtml = `<!doctype html>
<html lang="sv">
<body>
  <li class="Blurb">
    <span>29 oktober</span><span>185 kr</span>
    <a href="/konsert/streetstar/">Streetstar Dance School Challenge 2026</a>
  </li>
</body>
</html>`;
  const posResult = extractEvents(positiveHtml, 'berwaldhallen', 'https://www.berwaldhallen.se/');
  const posEvent = posResult.events.find((e) => e.title === 'Streetstar Dance School Challenge 2026');
  if (!posEvent || posEvent.date.slice(5) !== '10-29') {
    localFailures.push(
      `positiv: ${posEvent ? `datumet blev ${posEvent.date}` : `ingen rad hittades (${posResult.events.length} rader)`}`,
    );
  }

  // 3. NEGATIV KONTROLL: månadsnamnet måste vara ett helt ord
  const negativeHtml = `<!doctype html>
<html lang="sv">
<body>
  <div class="event-card">
    <h2>Maria Larkmans konsert</h2>
    <p>12 maria Björk</p>
    <a href="/maria-larkman/">Maria Larkmans konsert</a>
  </div>
</body>
</html>`;
  const negResult = extractEvents(negativeHtml, 'maria-larkman', 'https://maria-larkman.se/');
  if (negResult.events.some((e) => e.date.slice(5) === '03-12')) {
    localFailures.push(
      `negativ: fick ${negResult.events.length} rad(er) med datum ${negResult.events.map((e) => e.date).join(',')}`,
    );
  }

  return { localFailures, liveDate, liveTitle };
}

// ── Läge 1: negativ kontroll (före-fix-kopia MÅSTE fail:a) ─────────────────
if (process.argv.includes('--negative-control')) {
  let copyPath = null;
  try {
    copyPath = buildPrefixCopy();
    const { localFailures } = await runChecks(copyPath);
    if (localFailures.length === 0) {
      console.error(
        'mb-negativkontroll: FAIL före-fix-kopian PASS:ar kontrollerna — gaten mäter ingenting',
      );
      process.exit(1);
    }
    console.log(
      `mb-negativkontroll: före-fix-kopia FAIL:ar som väntat (${localFailures.length} kontroller) pass`,
    );
  } catch (e) {
    console.error(`mb-negativkontroll: FAIL ${e.message}`);
    process.exit(1);
  } finally {
    if (copyPath) fs.rmSync(copyPath, { force: true });
  }
  process.exit(0);
}

// ── Läge 2: vanlig kontroll mot den riktiga extraktorn ────────────────────
const { localFailures, liveDate, liveTitle } = await runChecks(EXTRACTOR_PATH);
if (localFailures.length > 0) {
  console.error(`mb: FAIL ${localFailures.join(' | ')}`);
  process.exit(1);
}
console.log(
  `mb: live berwaldhallen streetstar=${liveDate} "${String(liveTitle).slice(0, 40)}" kontroller=3 pass`,
);
