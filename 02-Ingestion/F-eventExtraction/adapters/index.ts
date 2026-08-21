/**
 * Site-specific adapter registry
 *
 * Each adapter is an isolated module that handles extraction quirks for
 * ONE specific source. Per CLAUDE.md Generalization Protection Rule, these
 * adapters must NOT influence C0/C1/C2 — they run as a priority step before
 * the universal extractor heuristics, only when the URL matches.
 *
 * To add a new adapter:
 *   1. Create a file in this directory (e.g. `mysource.ts`)
 *   2. Export `matches(url: string): boolean` and `extract(html, url, source)`
 *   3. Add it to the ADAPTERS array below
 *   4. Add tests in `mysource.test.ts`
 */
import * as intiman from './intiman';
import * as arkdes from './arkdes';
import * as folkoperan from './folkoperan';
import * as chinaTeatern from './china-teatern';
import * as eventbriteStockholm from './eventbriteStockholm';
import type { ParsedEvent } from '../schema';

export interface SiteAdapter {
  name: string;
  matches: (url: string) => boolean;
  extract: (
    html: string,
    url: string,
    source?: string
  ) => { showUrls: string[]; events: ParsedEvent[]; method: string };
}

export const ADAPTERS: SiteAdapter[] = [
  {
    name: 'intiman',
    matches: intiman.matches,
    extract: intiman.extract,
  },
  {
    name: 'arkdes',
    matches: arkdes.matches,
    extract: arkdes.extract,
  },
  {
    name: 'folkoperan',
    matches: folkoperan.matches,
    extract: folkoperan.extract,
  },
  {
    name: 'china-teatern',
    matches: chinaTeatern.matches,
    extract: chinaTeatern.extract,
  },
  {
    name: 'eventbriteStockholm',
    matches: eventbriteStockholm.matches,
    extract: eventbriteStockholm.extract,
  },
];

export function runAdapters(
  html: string,
  url: string,
  source?: string
): { adapter: string; showUrls: string[]; events: ParsedEvent[] } | null {
  for (const adapter of ADAPTERS) {
    if (!adapter.matches(url)) continue;
    const result = adapter.extract(html, url, source);
    if (result.showUrls.length > 0 || result.events.length > 0) {
      return { adapter: adapter.name, showUrls: result.showUrls, events: result.events };
    }
  }
  return null;
}
