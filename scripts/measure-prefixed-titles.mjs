#!/usr/bin/env node
/**
 * Mäter "smutsiga titlar" i korpusen: titlar som BÖRJA med datum/tid
 * (eller ett fotokredit) och sedan fortsätter med den riktiga titeln.
 *
 * Exempel: "1 nov. 2026 – 14:00–15:00Boksamtal: Björn Wiman"
 *
 * Syftet: avgöra om mönstret är GENERELLT (flera orelaterade domäner →
 * får rättas i C-lagret) eller ENKELT DOMÄNSPECIFIKT (då ska det lösas
 * med source-adapter, inte i C0/C1/C2 — Generalization Protection Rule).
 *
 * Kör:  node scripts/measure-prefixed-titles.mjs
 */
import fs from 'fs';
import path from 'path';

const CORPUS = path.resolve(process.cwd(), '03-Queue/03-extractedevents');
const MONTH = 'januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec';

// Titel som BÖRJAR med datum (+ ev. tid) och har mer text efteråt.
const LEADING_DATE_RX = new RegExp(
  '^\\s*(?:' +
    '\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}' +
    '|\\d{1,2}\\s*(?:' + MONTH + ')\\b\\.?\\s*,?\\s*\\d{4}?' +
    '|\\d{1,2}\\s*[-–]\\s*\\d{1,2}\\s*(?:' + MONTH + ')\\b\\.?' +
    '|(?:' + MONTH + ')\\b\\s+\\d{1,2},?\\s*\\d{4}?' +
  ')' +
  // valfri tid eller tidsintervall
  '(?:\\s*[-–,]?\\s*\\d{1,2}[:.]\\d{2}(?:\\s*[-–]\\s*\\d{1,2}[:.]\\d{2})?)?' +
  '\\s*',
  'i',
);

// Titel som BÖRJAR med ett fotokredit ("Foto: Namn").
const LEADING_CREDIT_RX = /^\s*(?:foto|fotograf|photo|image|bild)\s*[:–-]\s*\S/i;

const title = (r) =>
  typeof r.title === 'string' ? r.title : (r.title?.rendered ?? JSON.stringify(r.title ?? ''));

const perSource = new Map();
const examples = [];
let total = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith('.jsonl')) continue;
    const id = entry.name.replace(/\.jsonl$/, '');

    let rows = [];
    try {
      rows = fs
        .readFileSync(full, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      continue;
    }

    for (const row of rows) {
      const t = title(row);
      if (!t) continue;
      total++;
      const datePrefixed = LEADING_DATE_RX.test(t) && t.replace(LEADING_DATE_RX, '').trim().length >= 3;
      const creditPrefixed = LEADING_CREDIT_RX.test(t);
      if (!datePrefixed && !creditPrefixed) continue;
      perSource.set(id, (perSource.get(id) || 0) + 1);
      if (examples.length < 25) {
        examples.push({ id, kind: datePrefixed ? 'datum-prefix' : 'kredit-prefix', t: t.slice(0, 90) });
      }
    }
  }
}

if (!fs.existsSync(CORPUS)) {
  console.error(`Korpusen saknas: ${CORPUS}`);
  process.exit(1);
}
walk(CORPUS);

console.log(`Korpus: ${CORPUS}`);
console.log(`Titlar totalt: ${total}`);
console.log(`Smutsiga titlar: ${[...perSource.values()].reduce((a, b) => a + b, 0)}`);
console.log('');
console.log('Per källa (antal smutsiga titlar):');
for (const [id, n] of [...perSource.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id} = ${n}`);
}
console.log('');
for (const ex of examples) console.log(`  [${ex.kind} ${ex.id}] ${ex.t}`);
