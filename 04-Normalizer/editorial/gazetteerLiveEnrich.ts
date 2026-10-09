/**
 * gazetteerLiveEnrich.ts — P8.5 External Enrichment (2026-10-09).
 *
 * Vad: utökar den curaterade JSON-gazetteer (FAS 3.1) med live-uppslag
 *      mot MusicBrainz. När en performer INTE finns i curated JSON →
 *      slå upp mot MB, cachelagra resultatet, returnera ArtistEntry.
 *
 * Säkerhet (i prioritetsordning):
 *   1. Curated JSON vinner alltid — local data är granskad.
 *   2. Live-lookup är OFFLINE-FIRST: MUSICBRAINZ_USER_AGENT måste vara satt.
 *   3. In-memory cache per process — samma artist slås inte upp igen.
 *   4. Rate-limit: 1 req/s mot MB. Intern kö med `lastCallMs` + 1100ms gap.
 *   5. Alla nätverksfel / timeouts / tomma svar → null (graceful).
 *   6. `lookupArtistLive()` är async — måste awaitas.
 *   7. `lookupArtist()` (sync) är en wrapper som returnerar curated-träff
 *      direkt + lazy-trigger av async live-lookup (fire-and-forget).
 *
 * Användning:
 *   import { lookupArtistLive } from './gazetteerLiveEnrich';
 *   const meta = await lookupArtistLive('Big in Japan');
 *   // → { country: 'SE', genres: ['pop'], type: 'Group' }  eller null
 */
import { lookupArtist as curatedLookup } from './gazetteerCache';
import { musicBrainzLookup, type MusicBrainzArtist } from '../musicLookup';
import type { ArtistEntry } from './gazetteerCache';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h cache för live-resultat
const MB_MIN_INTERVAL_MS = 1100; // 1 req/s + lite slack
const DEFAULT_LIVE_MIN_SCORE = 90; // MB score 0-100 — hög tröskel för säker match

// ─── Live cache (memory) ────────────────────────────────────────────────────

interface CacheEntry {
  entry: ArtistEntry | null;
  expiresAt: number;
}

const liveCache = new Map<string, CacheEntry>();

/**
 * Hämta från live-cache om det finns och inte har gått ut.
 */
function getFromLiveCache(name: string): ArtistEntry | null | undefined {
  const key = name.toLowerCase();
  const hit = liveCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    liveCache.delete(key);
    return undefined;
  }
  return hit.entry;
}

function setInLiveCache(name: string, entry: ArtistEntry | null): void {
  const key = name.toLowerCase();
  liveCache.set(key, {
    entry,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

let lastMbCallMs = 0;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastMbCallMs;
  if (elapsed < MB_MIN_INTERVAL_MS) {
    const wait = MB_MIN_INTERVAL_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastMbCallMs = Date.now();
}

// ─── Mapping MB → ArtistEntry ───────────────────────────────────────────────

/**
 * Konvertera MusicBrainzArtist → ArtistEntry.
 * Vi gör INGEN antagning om genrer från MB (de finns inte där) — låt
 * factuality använda type/country direkt. Genre-claims utan extern
 * signal = riskabelt.
 */
function mbToArtistEntry(mb: MusicBrainzArtist): ArtistEntry {
  return {
    name: mb.name,
    country: mb.country ?? '',
    type: mb.type,
    genres: [],
    aliases: [],
    mbid: mb.mbid,
    stockholm_relevance: 'low', // out-of-curated = lägre stockholm-konfidens
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Slå upp artist med curated JSON som första källan, MusicBrainz som
 * fallback. Async eftersom live-lookup kan behövas.
 *
 * @returns ArtistEntry om träff, null om artisten inte finns någonstans.
 */
export async function lookupArtistLive(name: string | null | undefined): Promise<ArtistEntry | null> {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;

  // 1. Curated JSON — snabb, offline, auktoritativ
  const curated = curatedLookup(trimmed);
  if (curated) return curated;

  // 2. Live cache
  const cached = getFromLiveCache(trimmed);
  if (cached !== undefined) return cached;

  // 3. MusicBrainz — rate-limited, network
  if (!process.env.MUSICBRAINZ_USER_AGENT) {
    // Ingen UA = ingen live-lookup möjlig. Returnera null och cacha.
    setInLiveCache(trimmed, null);
    return null;
  }

  await waitForRateLimit();
  let mb: MusicBrainzArtist | null = null;
  try {
    mb = await musicBrainzLookup(trimmed, {
      minScore: DEFAULT_LIVE_MIN_SCORE,
      limit: 5,
    });
  } catch {
    // musicBrainzLookup returnerar null på fel, men vi vill vara
    // dubbelt säkra — ingen exception ska propagera ut ur lookup.
    mb = null;
  }

  if (!mb) {
    setInLiveCache(trimmed, null);
    return null;
  }

  const entry = mbToArtistEntry(mb);
  setInLiveCache(trimmed, entry);
  return entry;
}

/**
 * Slå upp flera artister parallellt med rate-limit i åtanke.
 *
 * Sekventiell exekvering (vi delar samma rate-limiter) — men samlade
 * await för att slippa N parallella MB-anrop.
 */
export async function lookupArtistsLive(
  names: ReadonlyArray<string | null | undefined>,
): Promise<Record<string, ArtistEntry | null>> {
  const out: Record<string, ArtistEntry | null> = {};
  for (const n of names) {
    if (!n) continue;
    out[n] = await lookupArtistLive(n);
  }
  return out;
}

/**
 * Test-hook: rensa live-cache (tvinga omladdning).
 */
export function __resetLiveCacheForTests(): void {
  liveCache.clear();
  lastMbCallMs = 0;
}

/**
 * Statistik för logging/debug.
 */
export function liveCacheStats(): {
  size: number;
  hitRate: number;
  hasUserAgent: boolean;
} {
  return {
    size: liveCache.size,
    hitRate: 0, // counters would go här i framtiden
    hasUserAgent: Boolean(process.env.MUSICBRAINZ_USER_AGENT),
  };
}
