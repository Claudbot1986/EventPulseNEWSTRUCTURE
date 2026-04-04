/**
 * ScoutResult — Unified output format for sourceScout
 *
 * Every scouting pass produces exactly one of these.
 * Used for both human readability and AI consumption.
 */

export type ScoutStatus =
  | 'promising'      // clear event source, confidence high
  | 'maybe'          // possible but uncertain, needs more investigation
  | 'not_suitable'   // clearly not an event source or blocked
  | 'blocked'        // DNS problem, HTTP block, Cloudflare, etc.
  | 'bad_url'        // malformed URL, redirect loop, unreachable
  | 'manual_review'; // cannot auto-determine, needs human check

export type RecommendedPath =
  | 'jsonld'    // → 02-Ingestion via JSON-LD fast path
  | 'network'   // → 02-Ingestion via Network Path
  | 'html'      // → 02-Ingestion via HTML Path
  | 'render'    // → 02-Ingestion via Render Path (headless)
  | 'manual'    // → hand over to human
  | 'reject';   // → 01-Sources/scouted-not-suitable/

export interface ScoutResult {
  /** The URL that was scouted */
  url: string;
  /** Human-readable source name if derivable */
  sourceName?: string;
  /** Overall scout verdict */
  status: ScoutStatus;
  /** Which ingestion path to route to */
  recommendedPath: RecommendedPath;
  /** 0–1 confidence in the verdict */
  confidence: number;
  /** Why this verdict was reached */
  reasons: string[];
  /** Raw evidence from each pass */
  evidence: {
    urlSanity?: UrlSanityEvidence;
    jsonLd?: JsonLdEvidence;
    network?: NetworkEvidence;
    html?: HtmlEvidence;
  };
  /** Plain-language next step recommendation */
  nextStep: string;
  /** ISO timestamp of this scout run */
  timestamp: string;
}

export interface UrlSanityEvidence {
  reachable: boolean;
  normalizedUrl?: string;
  redirectCount: number;
  finalUrl?: string;
  error?: string;
  statusCode?: number;
}

export interface JsonLdEvidence {
  found: boolean;
  diagnosis: string;
  eventBlocks: number;
  foundTypes: string[];
  eventsExtracted: number;
  reason: string;
}

export interface NetworkEvidence {
  verdict: string;
  signalsFound: boolean;
  openAccessible: boolean;
  likelyApis: number;
  possibleApis: number;
  reason: string;
}

export interface HtmlEvidence {
  fetchable: boolean;
  categorization: string;
  timeTags: number;
  datesFound: number;
  headings: number;
  venueMarkers: number;
  priceMarkers: number;
  listItemCount: number;
  reason: string;
}

/** ISO timestamp for filenames */
export function scoutTimestamp(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}:${min}`;
}

/** Slugify a description for use in filename */
export function slugify(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
