/**
 * check-word-image-pairing.mjs — verifiering 3 (UI-parning).
 *
 * Enkla kontrollen (per användarens önskemål):
 *   1. Hämta event via events_public — det är vad appen läser.
 *   2. För varje event: vilket ord matchar titeln, och vilken bild pekar
 *      image_url ut?
 *   3. Bilden ska vara just den som genererats för det ordet.
 *   4. Bilden ska vara nåbar (HTTP 200).
 *
 * ── Ordlistan är facit (samma som resten av pipelinen) ────────────────────
 * Tidigare matchades ord med "tokenet SLUTAR med ordet". Det gav FALSA
 * träffar ("Ludwig Hart" → "art", "Tennis Night" → "is") och gjorde att
 * verifieringen räknade fel. Nu används scripts/lib/word-image-match.js —
 * samma index som generatorn, gaten och tilldelningen — så test 3 mäter
 * exakt det som kopplingen gjorde.
 *
 * Kör:
 *   node --import tsx scripts/check-word-image-pairing.mjs --word=bastu
 *   node --import tsx scripts/check-word-image-pairing.mjs --all
 *   node --import tsx scripts/check-word-image-pairing.mjs --all --sample=40
 */
import fs from 'fs';

import { buildWordIndex, matchKeysInTitle, matchForms, storageFileName } from './lib/word-image-match.js';

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
const { Client } = await import('pg');
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const argv = process.argv.slice(2);
const arg = (n) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : '';
};
const wordArg = arg('word').toLowerCase();
const ALL = argv.includes('--all');
const SAMPLE = parseInt(arg('sample') || (ALL ? '40' : '0'), 10);

const WORD_DIR = 'local_image_library_stamped_v2/word';
const INVENTORY_CSV = 'docs/audit/data/huvudattraktioner-2026-10-31-ord-inventering.csv';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows[0];
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

// Ordlistan → bildnyckel (gemensam modell).
const invRows = parseCsv(fs.readFileSync(INVENTORY_CSV, 'utf8'));
const wordIndex = buildWordIndex(invRows.map((r) => ({ ord: r.ord ?? '', stam: r.stam ?? '' })));

// Ord → bildnyckel (från generatorns sidecars).
const sidecars = fs.readdirSync(WORD_DIR)
  .filter((f) => f.endsWith('.webp.json'))
  .map((f) => JSON.parse(fs.readFileSync(`${WORD_DIR}/${f}`, 'utf8')));
const keyToOrd = new Map(sidecars.map((s) => [s.image_key, s.ord]));

/**
 * Vilken bild ska eventet ha? Längsta ordet vinner (mest specifikt) —
 * samma regel som word_image_assign.ts.
 */
function expectedKey(title) {
  const titleKeys = matchKeysInTitle(title, wordIndex);
  if (!titleKeys.size) return null;
  const hits = sidecars
    .filter((s) => titleKeys.has(s.image_key)
      || matchForms(s.image_key, s.ord).some((f) => titleKeys.has(f)))
    .sort((a, b) => (b.image_key?.length ?? 0) - (a.image_key?.length ?? 0)
      || (b.ord?.length ?? 0) - (a.ord?.length ?? 0));
  return hits[0]?.image_key ?? null;
}

const where = [];
if (wordArg) where.push(`(title_sv ilike '%${wordArg}%' or title_en ilike '%${wordArg}%')`);
if (ALL) where.push(`image_url like '%/import-stamped/word/%'`);
const whereSql = where.length ? `where ${where.join(' and ')}` : '';
const { rows } = await c.query(
  `select id, title_sv, title_en, image_url, image_generated_at, image_model
     from events_public ${whereSql} order by title_sv`,
);
await c.end();

console.log(`=== VERIFIERING 3: titel ↔ bild i UI (events_public) ===\n`);
let ok = 0, problem = 0;
let checkedHttp = 0;
const problems = [];

// HTTP-kontroll på ett urval (alla om det är få rader).
let httpRows = rows;
if (SAMPLE > 0 && rows.length > SAMPLE) {
  const step = rows.length / SAMPLE;
  httpRows = [];
  for (let i = 0; i < SAMPLE; i++) httpRows.push(rows[Math.floor(i * step)]);
}
const httpIds = new Set(httpRows.map((r) => r.id));

for (const r of rows) {
  const title = r.title_sv || r.title_en || '';
  const expected = expectedKey(title);
  const img = (r.image_url ?? '').split('/').pop();
  // Filnamnet i storage är ASCII + hash av ordnyckeln (Supabase avvisar
  // icke-ASCII-nycklar) — samma funktion som tilldelningen använder.
  // Äldre körningar (före fixen) använde det råa ordet + "__NNN.webp".
  const matches = !!expected && !!img
    && (img === storageFileName(expected) || img.startsWith(expected + '__'));

  let reachable = 'n/a';
  if (httpIds.has(r.id) && r.image_url) {
    const res = await fetch(r.image_url, { method: 'GET' });
    reachable = `${res.status} ${res.headers.get('content-type') ?? ''}`;
    checkedHttp++;
  }
  const httpOk = reachable === 'n/a' || String(reachable).startsWith('200');
  const good = matches && httpOk;
  if (good) ok++; else {
    problem++;
    problems.push({ title, expected, img, reachable });
  }
  if (rows.length <= 80 || problems.length <= 20) {
    console.log(`${good ? '✓' : '✗'} ${title.slice(0, 44).padEnd(44)} ord=${(expected ? keyToOrd.get(expected) : '-').padEnd(12)} bild=${img ?? 'NULL'} ${reachable}`);
  }
}
console.log(`\nOK: ${ok} · problem: ${problem} · rader: ${rows.length} · HTTP-kontrollerade: ${checkedHttp}`);
if (problems.length) {
  console.log('\nProblem:');
  for (const p of problems.slice(0, 20)) {
    console.log(`  ✗ "${p.title.slice(0, 50)}" väntade=${p.expected ?? '-'} fick=${p.img ?? 'NULL'} ${p.reachable}`);
  }
}
console.log(`\nOrd-bilder i biblioteket: ${sidecars.length}`);
process.exit(problem > 0 ? 1 : 0);
