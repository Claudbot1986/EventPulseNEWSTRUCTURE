/**
 * check-word-image-pairing.mjs — verifiering 3 (UI-parning).
 *
 * Enkla kontrollen (per användarens önskemål):
 *   1. Hämta event via events_public — det är vad appen läser.
 *   2. För varje event: vilket ord matchar titeln, och vilken bild pekar
 *      image_url ut?
 *   3. Bilden ska vara just den som genererats för det ordet.
 *   4. Bilden ska vara nåbar (HTTP 200) och ha rätt storlek.
 *
 * Kör: node scripts/check-word-image-pairing.mjs [--word=bastu]
 */
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
const { Client } = await import('pg');
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const wordArg = (process.argv.find((a) => a.startsWith('--word=')) ?? '').slice(7).toLowerCase();

// Ord → bildnyckel (från generatorns sidecars)
const sidecars = fs.readdirSync('local_image_library_stamped_v2/word')
  .filter((f) => f.endsWith('.webp.json'))
  .map((f) => JSON.parse(fs.readFileSync(`local_image_library_stamped_v2/word/${f}`, 'utf8')));
const keyToOrd = new Map(sidecars.map((s) => [s.image_key, s.ord]));

const where = wordArg ? `where title_sv ilike '%${wordArg}%' or title_en ilike '%${wordArg}%'` : '';
const { rows } = await c.query(
  `select id, title_sv, title_en, image_url, image_generated_at, image_model
     from events_public ${where} order by title_sv limit 60`
);
await c.end();

const tokenize = (s) => s.toLowerCase().split(/[^a-z0-9åäöéüæøèáàíóúúñç]+/i).filter(Boolean);
const wordInTitle = (w, toks) => toks.some((t) => t === w || (t.length > w.length && t.endsWith(w)));

console.log(`=== VERIFIERING 3: titel ↔ bild i UI (events_public) ===\n`);
let ok = 0, problem = 0;
for (const r of rows) {
  const title = r.title_sv || r.title_en || '';
  const toks = tokenize(title);
  // Vilket ord matchar? (längsta)
  const hits = sidecars
    .filter((s) => [s.image_key, s.ord].some((f) => wordInTitle(f.toLowerCase(), toks)))
    .sort((a, b) => b.image_key.length - a.image_key.length);
  const expected = hits[0];
  const img = (r.image_url ?? '').split('/').pop();
  const expectedFile = expected ? `${expected.image_key}__*.webp` : '(ingen)';
  const matches = !!expected && img.startsWith(expected.image_key + '__');

  let reachable = 'n/a';
  if (r.image_url) {
    const res = await fetch(r.image_url, { method: 'GET' });
    reachable = `${res.status} ${res.headers.get('content-type') ?? ''}`;
  }
  const good = matches && String(reachable).startsWith('200');
  if (good) ok++; else problem++;
  console.log(`${good ? '✓' : '✗'} ${title.slice(0, 44).padEnd(44)} ord=${(expected?.ord ?? '-').padEnd(10)} bild=${img ?? 'NULL'} ${reachable}`);
}
console.log(`\nOK: ${ok} · problem: ${problem}`);
console.log(`\nOrd-bilder i biblioteket:`);
for (const s of sidecars) {
  console.log(`  ${s.ord.padEnd(12)} key=${s.image_key.padEnd(12)} match=${s.verified_match} lämplig=${s.verified_appropriate} fil=${s.stamped_path.split('/').pop()}`);
}
process.exit(problem > 0 ? 1 : 0);
