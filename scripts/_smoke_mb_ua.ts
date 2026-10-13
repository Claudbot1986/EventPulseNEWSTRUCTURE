/**
 * _smoke_mb_ua.ts — engångs-probe för att verifiera att
 * MUSICBRAINZ_USER_AGENT läses in, når ut till MusicBrainz,
 * och att live-resultat speglas till curated-cache (så att
 * buildEventProfile ser det via lookupArtists).
 *
 * Körs med:  npx tsx scripts/_smoke_mb_ua.ts
 */
import 'dotenv/config';
import { lookupArtistLive, liveCacheStats } from '../04-Normalizer/editorial/gazetteerLiveEnrich';
import { lookupArtists } from '../04-Normalizer/editorial/gazetteerCache';

const ARTISTS = [
  'Thåström',
  'Veronica Maggio',
  'Kent',
  'José González',
  'Loreen',
  'Sabina Ddumba',
  // venue-style (ska INTE hittas som Person/Group i MB)
  'Hovet Stockholm',
  'Globen',
];

async function main() {
  console.log('=== env-loaded MB-vars ===');
  console.log('MUSICBRAINZ_USER_AGENT:', JSON.stringify(process.env.MUSICBRAINZ_USER_AGENT ?? '<unset>'));
  console.log('MUSICBRAINZ_API_URL    :', JSON.stringify(process.env.MUSICBRAINZ_API_URL ?? '<unset>'));
  console.log('MUSICBRAINZ_APP_NAME   :', JSON.stringify(process.env.MUSICBRAINZ_APP_NAME ?? '<unset>'));
  console.log('MUSICBRAINZ_APP_VERSION:', JSON.stringify(process.env.MUSICBRAINZ_APP_VERSION ?? '<unset>'));
  console.log('MUSICBRAINZ_CONTACT    :', JSON.stringify(process.env.MUSICBRAINZ_CONTACT_EMAIL ?? '<unset>'));
  console.log('MUSICBRAINZ_RATE_LIMIT :', JSON.stringify(process.env.MUSICBRAINZ_RATE_LIMIT_MS ?? '<unset>'));
  console.log('liveCache innan:', liveCacheStats());
  console.log('---');

  for (const name of ARTISTS) {
    const t0 = Date.now();
    const entry = await lookupArtistLive(name);
    const ms = Date.now() - t0;
    if (!entry) {
      console.log(`[${name.padEnd(20)}] ❌ null  (${ms} ms)`);
      continue;
    }
    console.log(
      `[${name.padEnd(20)}] ✅ country=${entry.country || '?'} type=${entry.type} mb=${entry.mbid ?? '—'} (${ms} ms)`
    );

    // Test mirror: curated cache ska nu se samma entry
    const viaCurated = lookupArtists([name])[name];
    console.log(
      `[${name.padEnd(20)}) ] mirror→curated: ${viaCurated ? '✅ synlig i lookupArtists' : '❌ saknas i lookupArtists'}`
    );
  }

  console.log('---');
  console.log('liveCache efter:', liveCacheStats());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
