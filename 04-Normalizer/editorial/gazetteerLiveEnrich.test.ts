/**
 * gazetteerLiveEnrich.test.ts — P8.5 External Enrichment (2026-10-09).
 *
 * Verifierar: curated JSON vinner, live-cache funkar, MB-fallback
 * hanterar nätverksfel gracefully, rate-limit följs, ingen live-anrop
 * utan MUSICBRAINZ_USER_AGENT.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  lookupArtistLive,
  lookupArtistsLive,
  __resetLiveCacheForTests,
  liveCacheStats,
} from './gazetteerLiveEnrich';
import { __resetGazetteerCacheForTests } from './gazetteerCache';

// Mock musicBrainzLookup för att undvika riktiga nätverksanrop i tester.
vi.mock('../musicLookup', () => ({
  musicBrainzLookup: vi.fn(),
}));

import { musicBrainzLookup } from '../musicLookup';

const mockMB = musicBrainzLookup as unknown as ReturnType<typeof vi.fn>;

describe('gazetteerLiveEnrich', () => {
  beforeEach(() => {
    __resetLiveCacheForTests();
    __resetGazetteerCacheForTests(); // Rensa även curated-cache — live-resultat speglas hit
    mockMB.mockReset();
    // Sätt en User-Agent som default för test
    process.env.MUSICBRAINZ_USER_AGENT = 'EventPulse-test/1.0 (test@example.com)';
  });

  afterEach(() => {
    delete process.env.MUSICBRAINZ_USER_AGENT;
  });

  describe('curated JSON har förtur', () => {
    it('Donovan Woods returneras från curated JSON, INTE från MB', async () => {
      // Även om MB skulle returnera fel data → curated vinner
      mockMB.mockResolvedValue({
        mbid: 'wrong-mbid',
        name: 'Donovan Woods',
        score: 99,
        type: 'Group', // curated säger Person — curated vinner
        country: 'US',  // curated säger CA — curated vinner
      });
      const r = await lookupArtistLive('Donovan Woods');
      expect(r?.country).toBe('CA');  // curated value
      expect(r?.type).toBe('Person'); // curated value
      expect(r?.mbid).toBe('230a3e3a-bcee-4d2c-9b51-c6ea2e50d7ce'); // curated mbid
      // MB ska INTE ha anropats
      expect(mockMB).not.toHaveBeenCalled();
    });
  });

  describe('live cache', () => {
    it('cache-hit returnerar utan MB-anrop', async () => {
      mockMB.mockResolvedValue({
        mbid: 'mb-1',
        name: 'Big in Japan',
        score: 95,
        type: 'Group',
        country: 'SE',
      });
      // Första anrop — MB träff
      const r1 = await lookupArtistLive('Big in Japan');
      expect(r1?.country).toBe('SE');
      expect(mockMB).toHaveBeenCalledTimes(1);
      // Andra anrop — ska vara cache-hit
      const r2 = await lookupArtistLive('Big in Japan');
      expect(r2?.country).toBe('SE');
      expect(mockMB).toHaveBeenCalledTimes(1); // INTE ökat
    });

    it('cache-null cachelagrar misslyckad lookup så vi inte slår igen', async () => {
      mockMB.mockResolvedValue(null);
      await lookupArtistLive('Quidam');
      await lookupArtistLive('Quidam');
      expect(mockMB).toHaveBeenCalledTimes(1);
    });
  });

  describe('graceful degradation', () => {
    it('null om MUSICBRAINZ_USER_AGENT är tom sträng (efter fallback)', async () => {
      // 2026-10-13: default fallback finns i koden — tom sträng är det enda
      // sättet att stänga av live-lookup. Borttaget env triggar fallback-UA:n
      // ('EventPulse/1.0 (https://eventpulse.nu/kontakt)') så guard passerar.
      process.env.MUSICBRAINZ_USER_AGENT = '   '; // whitespace-only → trim → ''
      mockMB.mockResolvedValue({
        mbid: 'mb-1',
        name: 'Big in Japan',
        score: 95,
        type: 'Group',
        country: 'SE',
      });
      const r = await lookupArtistLive('Big in Japan');
      expect(r).toBeNull();
      expect(mockMB).not.toHaveBeenCalled();
    });

    it('default fallback-UA används om MUSICBRAINZ_USER_AGENT ej satt', async () => {
      delete process.env.MUSICBRAINZ_USER_AGENT;
      mockMB.mockResolvedValue({
        mbid: 'mb-fallback',
        name: 'Big in Japan',
        score: 95,
        type: 'Group',
        country: 'SE',
      });
      const r = await lookupArtistLive('Big in Japan');
      // Borttagen env → fallback-UA träder in → MB-anrop görs → entry returneras
      expect(r).not.toBeNull();
      expect(mockMB).toHaveBeenCalledTimes(1);
    });

    it('null om MB returnerar null (nätverksfel/tomt)', async () => {
      mockMB.mockResolvedValue(null);
      const r = await lookupArtistLive('Big in Japan');
      expect(r).toBeNull();
    });

    it('null om MB kastar (timeout, JSON-fel)', async () => {
      mockMB.mockRejectedValue(new Error('Network timeout'));
      const r = await lookupArtistLive('Big in Japan');
      expect(r).toBeNull();
    });

    it('null vid null/empty input', async () => {
      expect(await lookupArtistLive(null)).toBeNull();
      expect(await lookupArtistLive(undefined)).toBeNull();
      expect(await lookupArtistLive('')).toBeNull();
      expect(await lookupArtistLive('   ')).toBeNull();
    });
  });

  describe('MB → ArtistEntry mapping', () => {
    it('MB Group med country=SE → ArtistEntry med type=Group, country=SE', async () => {
      mockMB.mockResolvedValue({
        mbid: 'mb-abc',
        name: 'Big in Japan',
        score: 95,
        type: 'Group',
        country: 'SE',
      });
      const r = await lookupArtistLive('Big in Japan');
      expect(r).not.toBeNull();
      expect(r?.type).toBe('Group');
      expect(r?.country).toBe('SE');
      expect(r?.mbid).toBe('mb-abc');
      expect(r?.stockholm_relevance).toBe('low'); // out-of-curated
      expect(r?.genres).toEqual([]); // MB har inga genrer
    });

    it('MB utan country → ArtistEntry.country=""', async () => {
      mockMB.mockResolvedValue({
        mbid: 'mb-abc',
        name: 'Test Artist',
        score: 92,
        type: 'Person',
      });
      const r = await lookupArtistLive('Test Artist');
      expect(r?.country).toBe('');
    });
  });

  describe('rate-limit', () => {
    it('sekventiella anrop respekterar 1.1s gap', async () => {
      mockMB.mockImplementation(async (name: string) => ({
        mbid: `mb-${name}`,
        name,
        score: 95,
        type: 'Group',
        country: 'SE',
      }));
      const start = Date.now();
      await lookupArtistLive('A');
      await lookupArtistLive('B');
      const elapsed = Date.now() - start;
      // Minst 1100 ms ska ha gått mellan anropen
      expect(elapsed).toBeGreaterThanOrEqual(1100);
    });
  });

  describe('lookupArtistsLive batch', () => {
    it('blandad curated + live', async () => {
      mockMB.mockResolvedValue({
        mbid: 'mb-1',
        name: 'Big in Japan',
        score: 95,
        type: 'Group',
        country: 'SE',
      });
      const r = await lookupArtistsLive(['Donovan Woods', 'Big in Japan', null]);
      expect(r['Donovan Woods']?.country).toBe('CA'); // curated
      expect(r['Big in Japan']?.country).toBe('SE');  // live MB
      expect(r['']).toBeUndefined(); // null-filter
    });
  });

  describe('liveCacheStats', () => {
    it('rapporterar cache-storlek och User-Agent-status', () => {
      const s = liveCacheStats();
      expect(s.hasUserAgent).toBe(true);
      expect(s.size).toBe(0);
    });
  });
});
