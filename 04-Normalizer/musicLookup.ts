/**
 * musicLookup.ts — MusicBrainz + Last.fm API wrappers.
 *
 * Two free public APIs that together provide authoritative music metadata
 * for event categorization:
 *
 *   1. **MusicBrainz** (`musicbrainz.org/ws/2/artist`) — canonical artist
 *      identity. Returns the MusicBrainz ID (MBID) for a given artist name,
 *      which is the unique identifier used by every other music service.
 *      Rate limit: **1 req/sec**, strict. Free, but requires a descriptive
 *      `User-Agent` header (we use `MUSICBRAINZ_USER_AGENT`).
 *
 *   2. **Last.fm** (`ws.audioscrobbler.com/2.0/`) — community-driven genre
 *      tags per artist. Given an MBID, returns up to 100 tags with counts
 *      (e.g. `classical: 142, symphony: 89, ...`). Requires an API key
 *      (`LASTFM_API_KEY`). No strict rate limit; reasonable use is fine.
 *
 * Why both
 * --------
 * MusicBrainz alone gives identity but no genre. Last.fm alone has tags
 * but fuzzy name matching (artists named "The"). Combining them: MB gives
 * a stable MBID, then Last.fm gives us genre tags for THAT MBID. This is
 * the canonical pipeline used by MusicBrainz Picard, beets, Navidrome, etc.
 *
 * Graceful behavior
 * -----------------
 * Both functions return `null` on every failure mode (missing key, HTTP
 * error, malformed JSON, rate limit, empty results). Never throws. The
 * caller (artistResolver) treats `null` as "no signal" and falls back to
 * MiniMax-M2.7. This matches the `exaLookup.ts` pattern in
 * 09-DiscoveryAgent.
 *
 * Rate limit handling
 * -------------------
 * MusicBrainz returns 503 when we exceed 1 req/sec. We DO NOT retry — the
 * batch pipeline is sequential for MB calls (one event at a time), so we
 * shouldn't hit this in practice. If we do, returning `null` is correct
 * (we can re-run later).
 */

const MB_BASE_URL = 'https://musicbrainz.org/ws/2/artist';
const LF_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MB_LIMIT = 5;
const DEFAULT_MB_MIN_SCORE = 85; // MB returns 0-100 internally
const DEFAULT_LF_MIN_COUNT = 5;
const DEFAULT_LF_TOP_N = 30;

// ─── Types ─────────────────────────────────────────────────────────────────

export type MusicBrainzArtistType = 'Person' | 'Group' | 'Other' | 'Unknown';

export interface MusicBrainzArtist {
  /** MusicBrainz ID — UUID format. */
  mbid: string;
  /** Canonical name as listed in MusicBrainz. */
  name: string;
  /** Match score 0-100 (MusicBrainz internal relevance). */
  score: number;
  /** Person (solo artist) | Group (band) | Other | Unknown. */
  type: MusicBrainzArtistType;
  /** ISO country code if known. */
  country?: string;
  /** Disambiguation comment from MB (e.g. "Dutch composer"). */
  disambiguation?: string;
}

export interface LastFmTag {
  /** Tag name (Last.fm casing is mixed; we lowercase for lookup). */
  name: string;
  /** Number of users who applied this tag. Higher = more popular signal. */
  count: number;
}

export interface LastFmArtistTags {
  /** Echo of the MBID queried. */
  mbid: string;
  /** Tags sorted by count desc, filtered by minCount and capped to topN. */
  tags: LastFmTag[];
}

// ─── MusicBrainz ───────────────────────────────────────────────────────────

export interface MusicBrainzLookupOptions {
  /** Override score threshold (0-100). Default 85. */
  minScore?: number;
  /** Override result limit (1-100). Default 5. */
  limit?: number;
}

/**
 * Search MusicBrainz for an artist by name.
 *
 * Returns the best match if its score is ≥ minScore. Returns null on
 * missing API key, HTTP error, malformed response, or no qualifying match.
 *
 * Never throws.
 */
export async function musicBrainzLookup(
  headliner: string,
  options: MusicBrainzLookupOptions = {},
): Promise<MusicBrainzArtist | null> {
  const userAgent = (process.env.MUSICBRAINZ_USER_AGENT ?? '').trim();
  if (!userAgent) {
    return null; // MB policy: must send a descriptive User-Agent
  }
  if (!headliner.trim()) return null;

  const minScore = options.minScore ?? DEFAULT_MB_MIN_SCORE;
  const limit = Math.max(1, Math.min(100, options.limit ?? DEFAULT_MB_LIMIT));

  // MB Lucene query syntax: artist:(name) gives better signal than bare query.
  const url = `${MB_BASE_URL}?query=${encodeURIComponent(`artist:${headliner}`)}&fmt=json&limit=${limit}`;

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json',
      },
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      // 503 = rate limit. 400 = bad query. Both → null.
      return null;
    }
    const body = (await resp.json()) as unknown;
    const artist = pickBestArtist(body, headliner, minScore);
    return artist;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Pick the best matching artist from an MB search response.
 * Exported for testability (no API call needed).
 */
export function pickBestArtist(
  body: unknown,
  queryHeadliner: string,
  minScore: number,
): MusicBrainzArtist | null {
  if (!body || typeof body !== 'object') return null;
  const artists = (body as { artists?: unknown }).artists;
  if (!Array.isArray(artists)) return null;

  for (const raw of artists) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const id = typeof a.id === 'string' ? a.id : null;
    const name = typeof a.name === 'string' ? a.name : null;
    const score = typeof a.score === 'number' ? a.score : null;
    if (!id || !name || score === null) continue;
    if (score < minScore) return null; // MB returns sorted by score desc

    const type = normalizeArtistType(a.type);
    const area = a.area as Record<string, unknown> | undefined;
    // MB returns country as array like ["SE"] — extract the first element.
    const countryCodeRaw = area && area['iso-3166-1-code'];
    let country: string | undefined;
    if (Array.isArray(countryCodeRaw) && typeof countryCodeRaw[0] === 'string') {
      country = countryCodeRaw[0];
    } else if (typeof countryCodeRaw === 'string') {
      country = countryCodeRaw;
    }

    return {
      mbid: id,
      name,
      score,
      type,
      ...(country !== undefined ? { country } : {}),
      ...(typeof a.disambiguation === 'string' ? { disambiguation: a.disambiguation } : {}),
    };
  }
  return null;
}

function normalizeArtistType(raw: unknown): MusicBrainzArtistType {
  if (typeof raw !== 'string') return 'Unknown';
  const lower = raw.toLowerCase();
  if (lower === 'person') return 'Person';
  if (lower === 'group') return 'Group';
  if (lower === 'other' || lower === 'orchestra' || lower === 'choir') return 'Other';
  return 'Unknown';
}

// ─── Last.fm ───────────────────────────────────────────────────────────────

export interface LastFmGetTopTagsOptions {
  /** Drop tags below this count. Default 5 (filters out 'seen live' noise). */
  minCount?: number;
  /** Max tags to return. Default 30. */
  topN?: number;
}

/**
 * Get Last.fm community tags for an artist by MBID.
 *
 * Note: Last.fm has TWO endpoints for this — `artist.getTopTags` (tags
 * from Last.fm's internal taxonomy) and `artist.getTags` (user-submitted
 * tags). We use `getTopTags` because it's the canonical "what genre is this
 * artist" signal.
 *
 * Returns null on missing API key, HTTP error, malformed response, or
 * no qualifying tags. Never throws.
 */
export async function lastFmGetTopTags(
  mbid: string,
  options: LastFmGetTopTagsOptions = {},
): Promise<LastFmArtistTags | null> {
  const apiKey = (process.env.LASTFM_API_KEY ?? '').trim();
  if (!apiKey) return null;
  if (!mbid.trim()) return null;

  const minCount = options.minCount ?? DEFAULT_LF_MIN_COUNT;
  const topN = Math.max(1, options.topN ?? DEFAULT_LF_TOP_N);

  const params = new URLSearchParams({
    method: 'artist.getTopTags',
    mbid,
    api_key: apiKey,
    format: 'json',
  });
  const url = `${LF_BASE_URL}?${params.toString()}`;

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as unknown;
    const tags = parseLastFmTags(body, minCount, topN);
    if (!tags || tags.length === 0) return null;
    return { mbid, tags };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Parse Last.fm `artist.getTopTags` response into a sorted, filtered
 * tag list. Exported for testability.
 *
 * Response shape (typical):
 * {
 *   "toptags": {
 *     "tag": [
 *       { "name": "classical", "count": 142, "url": "..." },
 *       ...
 *     ],
 *     "@attr": { "artist": "..." }
 *   }
 * }
 */
export function parseLastFmTags(
  body: unknown,
  minCount: number,
  topN: number,
): LastFmTag[] | null {
  if (!body || typeof body !== 'object') return null;
  const toptags = (body as { toptags?: unknown }).toptags;
  if (!toptags || typeof toptags !== 'object') return null;

  const tagRaw = (toptags as { tag?: unknown }).tag;
  if (!Array.isArray(tagRaw)) return null;

  const tags: LastFmTag[] = [];
  for (const item of tagRaw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name : null;
    const count = typeof obj.count === 'number' ? obj.count : null;
    if (!name || count === null) continue;
    if (count < minCount) continue;
    tags.push({ name, count });
    if (tags.length >= topN) break;
  }

  // Last.fm returns tags in unspecified order — sort by count desc to make
  // downstream mapping deterministic.
  tags.sort((a, b) => b.count - a.count);

  return tags.length > 0 ? tags : null;
}
