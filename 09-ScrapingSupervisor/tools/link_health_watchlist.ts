/**
 * link_health_watchlist.ts — flagga källor vars event-länkar varit trasiga ≥7 dagar.
 *
 * Bakgrund (2026-09-26): daily cron check_link_health.ts skriver
 * events.link_status + link_last_checked_at. Den här modulen plockar ut
 * källor som har haft broken-länkar de senaste 7 dagarna och returnerar
 * dem som en watchlist. Supervisor.ts kallar denna och inkluderar
 * listan i daily-rapporten.
 *
 * Signal-styrka:
 *   - "broken" events senaste 7 dagar → watchlist (1 signal)
 *   - För varje källa räknar vi antal events med broken och senaste check
 *   - Threshold: ≥1 broken event senaste 7 dagar (konservativ signal,
 *     inte strikt "consecutive failure" — daglig cron kan ju ha missat
 *     en dag p.g.a. timeout eller transient failure)
 *
 * Errors-as-data: returnerar tom lista vid DB-fel så supervisor-rapporten
 * aldrig kraschar p.g.a. watchlist-frågan.
 */

import { db } from '../dashboard/db';

export interface LinkHealthWatchEntry {
  source: string;
  brokenCount: number;
  lastCheckedAt: string;
  /** Äldsta kvarvarande trasiga länken i watchlist-fönstret. */
  oldestBrokenAt: string;
}

export interface LinkHealthWatchlistOptions {
  /** Look-back fönster i dagar. Default 7. */
  windowDays?: number;
  /** Minsta antal broken events för att källan ska watchlist:as. Default 1. */
  minBrokenEvents?: number;
  /** Test-injection. */
  _client?: ReturnType<typeof db>;
}

export interface LinkHealthWatchlistResult {
  generatedAt: string;
  windowDays: number;
  minBrokenEvents: number;
  entries: LinkHealthWatchEntry[];
  error: string | null;
}

export async function collectLinkHealthWatchlist(
  opts: LinkHealthWatchlistOptions = {},
): Promise<LinkHealthWatchlistResult> {
  const windowDays = opts.windowDays ?? 7;
  const minBrokenEvents = opts.minBrokenEvents ?? 1;
  const empty: LinkHealthWatchlistResult = {
    generatedAt: new Date().toISOString(),
    windowDays,
    minBrokenEvents,
    entries: [],
    error: null,
  };

  const client = opts._client !== undefined ? opts._client : db();
  if (!client) return { ...empty, error: 'supabase client not configured' };

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  // SELECT id, source, link_last_checked_at WHERE link_status='broken' AND since
  // group per source, räkna + oldest.
  // Vi använder en PostgREST-vänlig approach: hämta minimal data och aggregera i JS.
  // Förväntat ~10-100 rader per dag (trasiga källor är minoritet) — OK att ladda in.
  try {
    const { data, error } = await client
      .from('events')
      .select('source, link_last_checked_at')
      .eq('status', 'published')
      .eq('link_status', 'broken')
      .gte('link_last_checked_at', since)
      .limit(1000);

    if (error) {
      return { ...empty, error: `query failed: ${error.message}` };
    }

    const bySource = new Map<string, { count: number; latest: string; oldest: string }>();
    for (const row of data ?? []) {
      const ts = row.link_last_checked_at as string;
      const existing = bySource.get(row.source);
      if (!existing) {
        bySource.set(row.source, { count: 1, latest: ts, oldest: ts });
      } else {
        existing.count += 1;
        if (ts > existing.latest) existing.latest = ts;
        if (ts < existing.oldest) existing.oldest = ts;
      }
    }

    const entries: LinkHealthWatchEntry[] = Array.from(bySource.entries())
      .filter(([, v]) => v.count >= minBrokenEvents)
      .map(([source, v]) => ({
        source,
        brokenCount: v.count,
        lastCheckedAt: v.latest,
        oldestBrokenAt: v.oldest,
      }))
      .sort((a, b) => b.brokenCount - a.brokenCount);

    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      minBrokenEvents,
      entries,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...empty, error: msg };
  }
}