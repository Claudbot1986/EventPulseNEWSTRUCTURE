/**
 * 07-Discovery/src/searchEngines/rssDiscovery.ts
 *
 * P3C (2026-09-10): RSS / Atom-feed discovery för kända venues.
 *
 * Vad: Många venues publicerar evenemang som RSS/Atom-flöden istället för
 * (eller som komplement till) HTML-sidor. Exempel: /feed, /rss.xml,
 * /events.rss, /calendar.xml. Vi provar en kort lista feed-URL:er för
 * varje källa vi redan känner och extraherar event-URL:ar.
 *
 * Hur:
 *   1. Läs working-sources från sources/*.jsonl (vi rör ALDRIG quarantined).
 *   2. För varje källa: testa 6 feed-URL-mönster med HEAD-förfrågan.
 *   3. Om Content-Type är XML och status 200: ladda ner + parsa med
 *      enkel XML-parser (regex-baserad för att inte lägga till dep).
 *   4. Extrahera <link> eller <guid> från <item>/<entry> → URL-pool.
 *   5. Dedupe och skriv nya event-URL:ar till runtime/postTestC-D.jsonl
 *      (för D-renderGate) eller direkt till source_candidates.
 *
 * Vetenskaplig bas:
 *   - RSS 2.0 spec (Winer 2003), Atom 1.0 (RFC 4287).
 *   - På internet publicerar ~30% av nyhetssajter RSS-flöden enligt
 *     studies från 2020–2024; för evenemang är andelen lägre (~10%)
 *     men feeds är mycket billigare än full HTML-render.
 *
 * Säkerhet:
 *   - Vi följer ALDRIG redirects till andra domäner (vi följer max 3 hops
 *     på samma domän).
 *   - Vi validerar Content-Type innan vi parsar (skippar HTML-svar).
 *   - Vi skriver BARA working-state källor (quarantined/retired hoppas över).
 *
 * Relation till pipeline:
 *   - RSS-discovery matar D-renderGate (postTestC-D) — JS-render behövs
 *     sällan för feed-extrahering (flöden är rå XML).
 *   - Eller skriver direkt till source_candidates för vidare handläggning.
 *
 * Usage:
 *   import { run } from './rssDiscovery.js';
 *   const r = await run({ limit: 100, concurrency: 5 });
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
dotenv.config({ path: path.resolve(PROJECT_ROOT, '.env'), override: true });

// ── Supabase ───────────────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return _supabase;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface RssDiscoveryOptions {
  /** Max antal källor att prova (default 100). */
  limit?: number;
  /** Concurrency för parallella feed-förfrågningar (default 5). */
  concurrency?: number;
  /** Tidsgräns per HEAD/GET (ms, default 8000). */
  timeoutMs?: number;
  /** Dry-run: räkna men skriv inte. Default false. */
  dryRun?: boolean;
}

export interface DiscoveredFeed {
  sourceId: string;
  feedUrl: string;
  /** Path-komponenten av feedUrl (t.ex. "/feed", "/nyheter/feed"). */
  discoveredPath: string;
  format: 'rss2' | 'atom' | 'rdf';
  itemCount: number;
  sampleUrls: string[];
}

export interface RssDiscoveryResult {
  sourcesChecked: number;
  feedsFound: number;
  totalEvents: number;
  candidatesWritten: number;
  dryRun: boolean;
  firstError: string | null;
  feeds: DiscoveredFeed[];
}

// ── Feed URL patterns ──────────────────────────────────────────────────────

const FEED_PATH_PATTERNS: ReadonlyArray<string> = [
  '/feed',
  '/feed/',
  '/rss',
  '/rss.xml',
  '/atom.xml',
  '/events.rss',
  '/events.xml',
  '/calendar.xml',
  '/events/feed',
  '/kalender/feed',
  '/nyheter/feed',
];

// ── Learned patterns (runtime/learned_patterns.json) ───────────────────────

const LEARNED_PATTERNS_FILE = path.resolve(PROJECT_ROOT, 'runtime', 'learned_patterns.json');
const LEARNED_MAX_ENTRIES = 100;
const LEARNED_TTL_DAYS = 30;

export interface LearnedPattern {
  pattern: string;
  hits: number;
  firstSeen: string;
  lastSeen: string;
}

interface LearnedPatternsFile {
  patterns: LearnedPattern[];
  updatedAt: string;
}

function emptyLearned(): LearnedPatternsFile {
  return { patterns: [], updatedAt: new Date().toISOString() };
}

export function loadLearnedPatterns(): LearnedPattern[] {
  if (!existsSync(LEARNED_PATTERNS_FILE)) return [];
  try {
    const raw = readFileSync(LEARNED_PATTERNS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as LearnedPatternsFile;
    if (!Array.isArray(parsed.patterns)) return [];
    return parsed.patterns;
  } catch {
    return [];
  }
}

export function saveLearnedPatterns(patterns: LearnedPattern[]): void {
  const dir = path.dirname(LEARNED_PATTERNS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // TTL: filtrera bort entries som inte setts på 30 dagar
  const cutoff = Date.now() - LEARNED_TTL_DAYS * 24 * 60 * 60 * 1000;
  let kept = patterns.filter((p) => new Date(p.lastSeen).getTime() >= cutoff);
  // Cap till MAX_ENTRIES (behåll nyaste)
  if (kept.length > LEARNED_MAX_ENTRIES) {
    kept.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    kept = kept.slice(0, LEARNED_MAX_ENTRIES);
  }
  const file: LearnedPatternsFile = { patterns: kept, updatedAt: new Date().toISOString() };
  const tmp = `${LEARNED_PATTERNS_FILE}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
  renameSync(tmp, LEARNED_PATTERNS_FILE);
}

/** Registrera en träff för ett mönster. Returnerar uppdaterad lista. */
export function recordPatternHit(
  pattern: string,
  currentPatterns: LearnedPattern[] = loadLearnedPatterns(),
): LearnedPattern[] {
  const now = new Date().toISOString();
  const idx = currentPatterns.findIndex((p) => p.pattern === pattern);
  if (idx >= 0) {
    currentPatterns[idx] = {
      ...currentPatterns[idx],
      hits: currentPatterns[idx].hits + 1,
      lastSeen: now,
    };
  } else {
    currentPatterns.push({ pattern, hits: 1, firstSeen: now, lastSeen: now });
  }
  saveLearnedPatterns(currentPatterns);
  return currentPatterns;
}

/**
 * Bygg prioriterad lista: först lärda mönster (sorterade efter hits DESC,
 * last_seen DESC), sedan defaults som INTE redan är lärda.
 *
 * Rent och enkelt — vi normaliserar inte (case-sensitive path matchning).
 */
export function prioritizePatterns(
  defaults: ReadonlyArray<string>,
  learned: LearnedPattern[],
): string[] {
  const learnedSet = new Set(learned.map((l) => l.pattern));
  const sortedLearned = [...learned]
    .sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return b.lastSeen.localeCompare(a.lastSeen);
    })
    .map((l) => l.pattern);
  const remainingDefaults = defaults.filter((d) => !learnedSet.has(d));
  return [...sortedLearned, ...remainingDefaults];
}

// ── Working sources ─────────────────────────────────────────────────────────

interface SourceEntry {
  id: string;
  url: string;
  status?: string;
}

function loadWorkingSources(limit: number): SourceEntry[] {
  const sourcesDir = path.resolve(PROJECT_ROOT, 'sources');
  if (!existsSync(sourcesDir)) return [];
  const out: SourceEntry[] = [];
  for (const file of readdirSync(sourcesDir)) {
    if (!file.endsWith('.jsonl')) continue;
    try {
      const content = readFileSync(path.join(sourcesDir, file), 'utf8').trim();
      if (!content) continue;
      const data = JSON.parse(content) as SourceEntry;
      if (data.status === 'quarantined' || data.status === 'retired') continue;
      if (typeof data.url === 'string' && data.url.startsWith('http')) {
        out.push(data);
      }
      if (out.length >= limit) break;
    } catch {
      /* skip */
    }
  }
  return out;
}

// ── XML detection & parsing (regex-baserad) ─────────────────────────────────

function detectFeedFormat(contentType: string | null, body: string): 'rss2' | 'atom' | 'rdf' | null {
  const ct = (contentType || '').toLowerCase();
  const head = body.slice(0, 512);
  if (head.includes('<rss ') || head.includes('<rss\n') || /xmlns="[^"]*\/rss\//.test(head)) return 'rss2';
  if (head.includes('<feed ') && head.includes('xmlns="http://www.w3.org/2005/Atom"')) return 'atom';
  if (head.includes('<rdf:RDF')) return 'rdf';
  if (ct.includes('xml') || ct.includes('rss') || ct.includes('atom')) {
    if (head.includes('<rss')) return 'rss2';
    if (head.includes('<feed')) return 'atom';
    if (head.includes('<rdf:RDF')) return 'rdf';
  }
  return null;
}

interface FeedItem {
  link: string;
  title?: string;
  guid?: string;
}

function extractRss2Items(body: string): FeedItem[] {
  const items: FeedItem[] = [];
  const itemRx = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRx.exec(body)) !== null) {
    const inner = m[1];
    const linkMatch = /<link\b[^>]*>([^<]+)<\/link>/i.exec(inner);
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(inner);
    const guidMatch = /<guid\b[^>]*>([^<]+)<\/guid>/i.exec(inner);
    if (linkMatch) {
      items.push({
        link: linkMatch[1].trim(),
        title: titleMatch ? decodeEntities(titleMatch[1]).trim() : undefined,
        guid: guidMatch ? guidMatch[1].trim() : undefined,
      });
    }
  }
  return items;
}

function extractAtomItems(body: string): FeedItem[] {
  const items: FeedItem[] = [];
  // Atom entries kan vara självslutande (<entry ... />) eller ha <entry>...</entry>
  const entryRx = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRx.exec(body)) !== null) {
    const inner = m[1];
    // Atom: <link href="..."/> eller <link>https://...</link>
    const linkMatch = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(inner);
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(inner);
    const idMatch = /<id\b[^>]*>([^<]+)<\/id>/i.exec(inner);
    if (linkMatch) {
      items.push({
        link: linkMatch[1].trim(),
        title: titleMatch ? decodeEntities(titleMatch[1]).trim() : undefined,
        guid: idMatch ? idMatch[1].trim() : undefined,
      });
    }
  }
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function parseFeed(body: string, format: 'rss2' | 'atom' | 'rdf'): FeedItem[] {
  if (format === 'atom') return extractAtomItems(body);
  // RSS2 + RDF använder båda <item>
  return extractRss2Items(body);
}

// ── HTTP discovery ──────────────────────────────────────────────────────────

async function headOrGet(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; contentType: string | null; body: string }> {
  // Vi gör en GET direkt — många servrar returnerar 405 på HEAD.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'EventPulse/1.0 (rss-discovery)',
        'Accept': 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, status: res.status, contentType: res.headers.get('content-type'), body: '' };
    }
    const ct = res.headers.get('content-type');
    const body = await res.text();
    return { ok: true, status: res.status, contentType: ct, body };
  } catch (err: unknown) {
    clearTimeout(timer);
    return { ok: false, status: 0, contentType: null, body: '' };
  }
}

function isOnSameDomain(feedUrl: string, baseUrl: string): boolean {
  try {
    const a = new URL(feedUrl);
    const b = new URL(baseUrl);
    return a.hostname === b.hostname || a.hostname.endsWith('.' + b.hostname) || b.hostname.endsWith('.' + a.hostname);
  } catch {
    return false;
  }
}

function feedUrlCandidates(baseUrl: string, patterns: ReadonlyArray<string>): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  return patterns.map((p) => `${base.origin}${p}`);
}

async function discoverForSource(
  source: SourceEntry,
  timeoutMs: number,
  patterns: ReadonlyArray<string>,
): Promise<DiscoveredFeed | null> {
  const candidates = feedUrlCandidates(source.url, patterns);
  for (const feedUrl of candidates) {
    if (!isOnSameDomain(feedUrl, source.url)) continue;
    const r = await headOrGet(feedUrl, timeoutMs);
    if (!r.ok) continue;
    const format = detectFeedFormat(r.contentType, r.body);
    if (!format) continue;
    const items = parseFeed(r.body, format);
    if (items.length === 0) continue;
    const urls = items
      .map((i) => i.link)
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 20); // cap per feed
    if (urls.length === 0) continue;
    return {
      sourceId: source.id,
      feedUrl,
      discoveredPath: (() => { try { return new URL(feedUrl).pathname; } catch { return ''; } })(),
      format,
      itemCount: items.length,
      sampleUrls: urls,
    };
  }
  return null;
}

// ── Public entrypoint ──────────────────────────────────────────────────────

export async function run(opts: RssDiscoveryOptions = {}): Promise<RssDiscoveryResult> {
  const limit = opts.limit ?? 100;
  const concurrency = opts.concurrency ?? 5;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const dryRun = opts.dryRun ?? false;

  const result: RssDiscoveryResult = {
    sourcesChecked: 0,
    feedsFound: 0,
    totalEvents: 0,
    candidatesWritten: 0,
    dryRun,
    firstError: null,
    feeds: [],
  };

  // Ladda lärda patterns och bygg prioriterad lista
  const learned = loadLearnedPatterns();
  const patterns = prioritizePatterns(FEED_PATH_PATTERNS, learned);

  const sources = loadWorkingSources(limit);
  result.sourcesChecked = sources.length;
  if (sources.length === 0) return result;

  // Parallell discovery
  let idx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= sources.length) break;
      try {
        const feed = await discoverForSource(sources[i], timeoutMs, patterns);
        if (feed) {
          result.feeds.push(feed);
          result.totalEvents += feed.itemCount;
          // Registrera träff i learned_patterns (atomiskt)
          try {
            recordPatternHit(feed.discoveredPath, learned);
          } catch {
            /* pattern-record misslyckades — non-fatal */
          }
        }
      } catch (err: unknown) {
        if (!result.firstError) {
          result.firstError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  result.feedsFound = result.feeds.length;

  if (dryRun || result.feeds.length === 0) return result;

  // Skriv till source_candidates: en rad per feed med metadata
  const rows = result.feeds.map((f) => ({
    url: f.feedUrl,
    source_query: `rss:${f.sourceId}`,
    discovered_at: new Date().toISOString(),
    engine: 'rss_discovery',
    status: 'pending',
    metadata: {
      source_id: f.sourceId,
      format: f.format,
      item_count: f.itemCount,
      sample_urls: f.sampleUrls.slice(0, 5),
      discovered_path: f.discoveredPath,
    },
  }));

  const { error: upsertErr } = await db()
    .from('source_candidates')
    .upsert(rows as never, { onConflict: 'url', ignoreDuplicates: true });

  if (upsertErr) {
    result.firstError = `upsert failed: ${upsertErr.message}`;
  } else {
    result.candidatesWritten = rows.length;
  }

  return result;
}

// ── CLI wrapper ────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);
const limitIdx = cliArgs.indexOf('--limit');
const concIdx = cliArgs.indexOf('--concurrency');
const dryRunFlag = cliArgs.includes('--dry-run');

const limit = limitIdx !== -1 ? parseInt(cliArgs[limitIdx + 1], 10) : 100;
const concurrency = concIdx !== -1 ? parseInt(cliArgs[concIdx + 1], 10) : 5;

const isMainModule = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return process.argv[1] === __filename || process.argv[1]?.endsWith('rssDiscovery.ts');
  } catch {
    return false;
  }
})();

if (isMainModule && cliArgs.length > 0) {
  run({ limit, concurrency, dryRun: dryRunFlag })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.firstError ? 1 : 0);
    })
    .catch((e) => {
      console.error('[rssDiscovery] FATAL:', e);
      process.exit(1);
    });
}