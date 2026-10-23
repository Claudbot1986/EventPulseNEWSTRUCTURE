#!/usr/bin/env node
/**
 * verify-c3-extractor.mjs — bevis för C3-fixen i universal-extractor.
 *
 * Bakgrund (2026-10-24). Tre fel hittades i C-gatens HTML-extraktion:
 *
 *   1. **Layout-wrapper som "kort".** Tailwind-klassen "items-center" /
 *      "align-items-center" innehåller delsträngen "item" och matchar
 *      därför [class*="item"]. C3:s `$a.closest(...)` snappar då kortet till
 *      en tom layoutkolumn i stället för kortets egen post — och evenemanget
 *      försvinner helt. Bevis: 24–25 orelaterade domäner har samma
 *      substring-träff, 13 domäner ändrade kortuppslagning.
 *
 *   2. **Årets siffror som datum.** Regexen för årslösa svenska datum
 *      ("23 okt") matchade de två sista siffrorna i ett ÅR om de följdes av
 *      en månadsnamn. Rubriken "...Through March 2027" + publiceringsdatumet
 *      "Sep 30, 2026" blev därför datumet "27 Sep" → 2027-09-27, ett
 *      påhittat event på en nyhetssida.
 *
 *   3. **Ogiltiga datum/tider lämnade extractorn.** "30-31 oktober" ger
 *      dag=30, månad=31 → "2026-31-30"; "35:54" skrevs som klockslag.
 *      Bevis: dansenshus.se och tekniskamuseet.se.
 *
 * Gates:
 *   x1 — positiv kontroll: en riktig venue-lista ger events med giltiga datum
 *        (och "31 okt lör" → 2026-10-31, inte nästa lördag).
 *   x2 — negativ kontroll: nyhetssidor ger INGA events.
 *   x3 — datumvalidering: inget ogiltigt datum eller klockslag lämnar extractorn.
 *   x4 — negativ kontroll mot en extraktor UTAN lookbehind: nyhetssidorna ger
 *        DÅ skräpeevents → gaten kan faila (bevisar att x2 inte är vacuous).
 *   x5 — regression: ingen källa tappar events om den inte är godkänd.
 *
 * Anropas som `node scripts/verify-c3-extractor.mjs <x1|x2|x3|x4|x5>`.
 * Skriver ut `xN: <status> pass` på stdout vid PASS, annars `xN: FAIL …`
 * på stderr + exit 1. Utskriften matchas av GATES.md:s `EXPECT:`.
 *
 * Fixtures: scripts/fixtures/*.html — utklippta ur de RIKTIGA sidorna
 * (scalateatern.se/forestallningar, rustourismnews.com, musikindustri.se,
 * postmuseum.se). Inga syntetiska event: markupen är bokstavligen sidans.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

const EXTRACTOR = path.join(ROOT, '02-Ingestion/F-eventExtraction/universal-extractor.ts');
const NEGATIVE_CONTROL = path.join(
  ROOT,
  '02-Ingestion/F-eventExtraction/.gate-c3-negative-control.ts',
);
const FIXTURES = path.join(__dirname, 'fixtures');

const SCALATEATRN = path.join(FIXTURES, 'venue-scalateatern-listing.html');
const NEWS_PAGES = [
  { id: 'wwwrustourismnewscom', file: path.join(FIXTURES, 'news-rustourismnews.html'), url: 'https://www.rustourismnews.com/' },
  { id: 'wwwmusikindustrinse', file: path.join(FIXTURES, 'news-musikindustri.html'), url: 'https://www.musikindustri.se/' },
  { id: 'postmuseum', file: path.join(FIXTURES, 'news-postmuseum.html'), url: 'https://www.postmuseum.se/aktuellt/' },
];

/** Lookbehind-fixen. Sitter i fyra regexer: SWE_DATE_NO_YEAR_RX,
 *  SWE_EXPLICIT_DATE_RX + de två "datum med år"-mönstren (sweDateRx). */
const FIXED_SRC = '(?<!\\d)(\\d{1,2})\\s+(januari';
/** Utan fixen. */
const BROKEN_SRC = '(\\d{1,2})\\s+(januari';
/** Antal regexer som bär fixen. Ändras detta måste gaten skrivas om. */
const FIXED_COUNT = 4;

/** Källor som FÅR tappa events (skräp som verifierats bort). */
const APPROVED_LOSS = new Set(['postmuseum', 'dansenshus-sv']);

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

// ── Kör extraktorn mot fixtures ───────────────────────────────────────────

function runExtractor(modulePath, pages) {
  const probe = `
import { readFileSync } from 'fs';
import { extractEvents } from ${JSON.stringify(modulePath)};
const pages = ${JSON.stringify(pages)};
const out = {};
for (const p of pages) {
  const html = readFileSync(p.file, 'utf8');
  const r = extractEvents(html, p.id, p.url);
  out[p.id] = r.events.map((e) => ({
    title: e.title,
    date: e.date,
    time: e.time ?? null,
    url: e.url ?? null,
  }));
}
console.log('###RESULT###' + JSON.stringify(out));
`;
  const probePath = path.join(path.dirname(modulePath), `.gate-c3-probe-${process.pid}.ts`);
  writeFileSync(probePath, probe, 'utf8');
  try {
    const res = spawnSync('npx', ['tsx', probePath], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    if (res.status !== 0) {
      return { error: `tsx-probe avslutade med ${res.status}: ${(res.stderr || '').trim().slice(0, 400)}` };
    }
    const line = (res.stdout || '').split('###RESULT###')[1];
    if (!line) {
      return { error: `proben skrev ingen resultatrad: ${(res.stdout || '').trim().slice(0, 300)}` };
    }
    return { data: JSON.parse(line.trim()) };
  } catch (e) {
    return { error: `tsx-probe kastade: ${e?.message ?? e}` };
  } finally {
    rmSync(probePath, { force: true });
  }
}

/**
 * Bygg en kopia av extraktorn där lookbehind-fixen är ÅTERFÖRD — så att den
 * negativa kontrollen mäter en riktig regression, inte ett syntaxfel.
 */
function writeNegativeControl() {
  if (!existsSync(EXTRACTOR)) return { error: `extraktorn saknas: ${EXTRACTOR}` };
  const src = readFileSync(EXTRACTOR, 'utf8');
  const fixed = src.split(FIXED_SRC).length - 1;
  if (fixed !== FIXED_COUNT) {
    return {
      error:
        `negativ kontroll ogiltig: lookbehind-fixen hittades ${fixed} gånger i ` +
        `extraktorn (förväntat exakt ${FIXED_COUNT}) — filen har ändrats sedan gaten skrevs`,
    };
  }
  writeFileSync(NEGATIVE_CONTROL, src.split(FIXED_SRC).join(BROKEN_SRC), 'utf8');
  return { ok: true };
}

function requireFixtures() {
  const missing = [SCALATEATRN, ...NEWS_PAGES.map((p) => p.file)].filter((f) => !existsSync(f));
  if (missing.length) {
    fail(`${arg}: fixtures saknas: ${missing.map((m) => path.relative(ROOT, m)).join(', ')}`);
  }
}

/** ISO-datum som faktiskt finns i kalendern. */
function isRealDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function isRealTime(t) {
  if (t === null || t === undefined) return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

// ── X1: positiv kontroll — riktig venue-lista ger events ──────────────────

if (arg === 'x1') {
  requireFixtures();
  const pages = [{ id: 'wwwscalateaternse', file: SCALATEATRN, url: 'https://www.scalateatern.se/forestallningar/' }];
  const r = runExtractor(EXTRACTOR, pages);
  if (r.error) fail(`x1: ${r.error}`);
  const events = r.data['wwwscalateaternse'];
  if (!Array.isArray(events)) fail('x1: extraktorn gav inget resultat för scalateatern');
  if (events.length < 20) {
    fail(`x1: scalateatern-listan gav ${events.length} events — för få (väntat ≥ 20)`);
  }
  const keys = events.map((e) => `${e.title}|${e.date}|${e.time ?? ''}`);
  if (new Set(keys).size !== keys.length) {
    fail('x1: scalateatern-listan gav dubblerade (titel, datum)-par');
  }
  for (const e of events) {
    if (!isRealDate(e.date)) fail(`x1: ogiltigt datum "${e.date}" på "${e.title}"`);
  }
  // "31 okt lör" ska bli 2026-10-31 — INTE nästa lördag (2026-10-24).
  if (!events.some((e) => e.date === '2026-10-31')) {
    fail('x1: "31 okt"-fallet saknas — veckodagsinferensen vann över det explicita datumet');
  }
  ok(`x1: scalateatern ${events.length} events, unika (titel, datum)-par, "31 okt" → 2026-10-31 pass`);
}

// ── X2: negativ kontroll — nyhetssidor ger INGA events ─────────────────────

if (arg === 'x2') {
  requireFixtures();
  const r = runExtractor(EXTRACTOR, NEWS_PAGES);
  if (r.error) fail(`x2: ${r.error}`);
  const dirty = [];
  for (const p of NEWS_PAGES) {
    const events = r.data[p.id] || [];
    if (events.length > 0) {
      dirty.push(
        `${p.id}: ${events.length} events (${events.slice(0, 3).map((e) => `${e.date} "${e.title.slice(0, 30)}"`).join(', ')})`,
      );
    }
  }
  if (dirty.length) {
    fail(`x2: nyhetssidor gav events — påhittade datum eller författarlänkar:\n  ${dirty.join('\n  ')}`);
  }
  ok(`x2: ${NEWS_PAGES.length} nyhetssidor gav 0 events pass`);
}

// ── X3: datum-/tidvalidering ──────────────────────────────────────────────

if (arg === 'x3') {
  requireFixtures();
  const pages = [
    { id: 'wwwscalateaternse', file: SCALATEATRN, url: 'https://www.scalateatern.se/forestallningar/' },
    ...NEWS_PAGES,
  ];
  const r = runExtractor(EXTRACTOR, pages);
  if (r.error) fail(`x3: ${r.error}`);
  const bad = [];
  for (const [id, events] of Object.entries(r.data)) {
    for (const e of events) {
      if (!isRealDate(e.date)) bad.push(`${id}: datum "${e.date}" på "${e.title}"`);
      if (!isRealTime(e.time)) bad.push(`${id}: tid "${e.time}" på "${e.title}"`);
    }
  }
  if (bad.length) {
    fail(`x3: ogiltiga datum/tider lämnade extractorn:\n  ${bad.slice(0, 10).join('\n  ')}`);
  }
  ok(`x3: inga ogiltiga datum eller klockslag i ${Object.keys(r.data).length} sidor pass`);
}

// ── X4: negativ kontroll mot extraktor UTAN fixen ─────────────────────────

if (arg === 'x4') {
  requireFixtures();
  const nc = writeNegativeControl();
  if (nc.error) fail(`x4: ${nc.error}`);
  try {
    const r = runExtractor(NEGATIVE_CONTROL, NEWS_PAGES);
    if (r.error) fail(`x4: ${r.error}`);
    const total = NEWS_PAGES.reduce((sum, p) => sum + (r.data[p.id] || []).length, 0);
    if (total === 0) {
      fail('x4: negativa kontrollen gav 0 events — gaten kan inte faila, fixen mäts inte');
    }
    ok(`x4: utan lookbehind ger nyhetssidorna ${total} skräpeevents — gaten kan faila pass`);
  } finally {
    rmSync(NEGATIVE_CONTROL, { force: true });
  }
}

// ── X5: regression — inga oförväntade källor tappar events ─────────────────

if (arg === 'x5') {
  const probe = spawnSync('npx', ['tsx', 'scripts/probe-extractor-regression.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 600000,
  });
  if (probe.status !== 0) {
    fail(`x5: regression-proben avslutade med ${probe.status}: ${(probe.stderr || '').trim().slice(0, 400)}`);
  }
  const out = probe.stdout || '';
  const compared = out.match(/Jämför (\d+) källor/);
  if (!compared || Number(compared[1]) < 15) {
    fail(`x5: regression-proben jämförde för få källor: ${compared ? compared[1] : 'okänt'}`);
  }
  const downs = [...out.matchAll(/^\s*▼\s+(\S+)/gm)].map((m) => m[1]);
  const unexpected = downs.filter((d) => !APPROVED_LOSS.has(d));
  if (unexpected.length) {
    fail(
      `x5: oförväntade källor tappade events: ${unexpected.join(', ')} ` +
      `(godkända skräpkällor: ${[...APPROVED_LOSS].join(', ')})`,
    );
  }
  ok(
    `x5: ${compared[1]} källor jämförda, ${downs.length} nedgångar (alla godkända: ${downs.join(', ') || 'inga'}) pass`,
  );
}

if (!['x1', 'x2', 'x3', 'x4', 'x5'].includes(arg)) {
  fail(`usage: node scripts/verify-c3-extractor.mjs <x1|x2|x3|x4|x5>`);
}
