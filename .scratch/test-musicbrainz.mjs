/**
 * test-musicbrainz.mjs — Live-API smoke test för MusicBrainz + Last.fm.
 *
 * Verifierar att API-anropen fungerar som 04-Normalizer/musicLookup.ts
 * förväntar sig. Speglar samma URL:er + headers som produktionskoden.
 *
 * Testartister — spänner över alla 3 kategorier + catch-all:
 *   Berlin Philharmonic → classical
 *   Anna Netrebko       → opera
 *   Opeth               → catch-all (metal → 'musical')
 *   Rodrigo y Gabriela  → catch-all (rock → 'musical')
 *
 * Kör: `node --env-file=.env .scratch/test-musicbrainz.mjs`
 */

import 'dotenv/config';

const MB_BASE = 'https://musicbrainz.org/ws/2/artist';
const LF_BASE = 'https://ws.audioscrobbler.com/2.0/';
const MB_UA = process.env.MUSICBRAINZ_USER_AGENT ?? 'EventPulse/1.0 (test@example.com)';
const LF_KEY = process.env.LASTFM_API_KEY;

if (!LF_KEY) {
  console.error('Saknar LASTFM_API_KEY i .env — kan inte köra Last.fm-delen.');
  process.exit(2);
}

async function mbLookup(headliner) {
  const url = `${MB_BASE}?query=artist:${encodeURIComponent(headliner)}&fmt=json&limit=5`;
  const resp = await fetch(url, { headers: { 'User-Agent': MB_UA, Accept: 'application/json' } });
  if (!resp.ok) return null;
  const body = await resp.json();
  const top = body.artists?.[0];
  if (!top || top.score < 85) return null;
  return { mbid: top.id, name: top.name, score: top.score, type: top.type };
}

async function lfTags(mbid) {
  const url = `${LF_BASE}?method=artist.getTopTags&mbid=${encodeURIComponent(mbid)}&api_key=${LF_KEY}&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const body = await resp.json();
  const tags = (body.toptags?.tag ?? [])
    .filter(t => typeof t.name === 'string' && t.count >= 5)
    .slice(0, 30);
  return tags;
}

// Enkel kopia av mapLastFmTagsToCategory-mappingen (utan import pga .mjs)
const TAG_TO_CATEGORY = {
  classical: ['classical', 'symphony', 'orchestra', 'baroque', 'chamber music', 'requiem',
              'concerto', 'sonata', 'sonic art', 'minimalism', '20th century classical',
              'contemporary classical', 'choral', 'classical music', 'quartet',
              'string quartet', 'early music', 'romantic', 'impressionist', 'piano', 'violin'],
  opera: ['opera', 'operatic', 'vocal classical'],
  musical: ['musical theatre', 'broadway', 'musical', 'musicals', 'operetta'],
};
const CATCH_ALL = new Set(['rock', 'pop', 'indie', 'jazz', 'electronic', 'house', 'techno',
  'hip-hop', 'rap', 'folk', 'metal', 'punk', 'blues']);

function mapTags(tags) {
  if (!tags?.length) return null;
  const norm = t => t.trim().toLowerCase();
  const hits = {};
  for (const t of tags) {
    for (const [cat, allowed] of Object.entries(TAG_TO_CATEGORY)) {
      if (allowed.includes(norm(t.name))) {
        if (!hits[cat]) hits[cat] = [];
        hits[cat].push({ name: norm(t.name), count: t.count });
        break;
      }
    }
  }
  const cats = Object.keys(hits);
  if (cats.length === 0) {
    if (tags.some(t => CATCH_ALL.has(norm(t.name)))) return { cat: 'musical', conf: 0.70, source: 'catch-all' };
    return null;
  }
  if (cats.length === 1) {
    const cat = cats[0];
    const list = hits[cat];
    if (list.length >= 2 || (list.length === 1 && list[0].count >= 100)) {
      return { cat, conf: 0.95, source: list.length >= 2 ? 'multi-tag' : 'strong-single' };
    }
    return null;
  }
  return null; // ambiguous
}

const TESTS = [
  { headliner: 'Berlin Philharmonic', expect: 'classical' },
  { headliner: 'Anna Netrebko', expect: 'opera' },
  { headliner: 'Opeth', expect: 'catch-all' },
  { headliner: 'Rodrigo y Gabriela', expect: 'catch-all' },
];

let pass = 0, fail = 0;

for (const { headliner, expect } of TESTS) {
  console.log(`\n━━━ ${headliner}  (förväntat: ${expect}) ━━━`);

  const mb = await mbLookup(headliner);
  if (!mb) { console.log(`  ✗ MusicBrainz: ingen match`); fail++; continue; }
  console.log(`  ✓ MusicBrainz: ${mb.name}  MBID=${mb.mbid}  score=${mb.score}  type=${mb.type}`);

  const lf = await lfTags(mb.mbid);
  if (!lf) { console.log(`  ✗ Last.fm: inga taggar`); fail++; continue; }
  console.log(`  ✓ Last.fm: ${lf.length} taggar`);
  console.log(`    topp-5: ${lf.slice(0, 5).map(t => `${t.name}(${t.count})`).join(', ')}`);

  const mapped = mapTags(lf);
  if (mapped) {
    console.log(`  ✓ mapTags: ${mapped.cat}  conf=${mapped.conf}  via=${mapped.source}`);
    pass++;
  } else {
    console.log(`  ⚠ mapTags: null (tvetydigt eller ingen signal)`);
    pass++;
  }

  await new Promise(r => setTimeout(r, 1100));
}

console.log(`\n━━━ SAMMANFATTNING ━━━`);
console.log(`  OK: ${pass}/${TESTS.length}`);
console.log(`  FAIL: ${fail}/${TESTS.length}`);
if (fail > 0) process.exit(1);