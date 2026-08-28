/**
 * URLBank — Source Discovery via Temporal Productivity Signals
 *
 * Vetenskaplig grund: Meltwater URLBank (WWW 2026).
 * Produktivitet = events per URL senaste X dagar.
 * Stabilitet = hur persistent URL:en är (återkommer i extraherade events).
 * Greedy budget-optimering — vi väljer URLs som maximerar marginal event-yield.
 *
 * BACKLOG: "source-candidate auto-promotion" är DO NOT BUILD YET.
 * Därför skriver denna modul kandidater till runtime/discovery-candidates.jsonl
 * som SENARE granskas manuellt (eller via supervisor) innan auto-promo.
 *
 * Indata (lokalt, ingen Supabase-dependency):
 *   - sources/{id}.jsonl           → source metadata (url, etc.)
 *   - 03-Queue/03-extractedevents/{gate}/{id}.jsonl → faktiska events per URL
 *   - runtime/sources_status.jsonl → senaste körning + historik
 *
 * Output:
 *   - runtime/discovery-candidates.jsonl  → {sourceId, candidateUrl, score, productivity, stability, ...}
 *
 * Användning:
 *   import { scoreUrlProductivity, findCandidateUrls, generateCandidatesForSource } from './urlbank.js';
 */

import * as cheerio from 'cheerio';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fetchHtml } from '../tools/fetchTools.js';

// ─── Paths ────────────────────────────────────────────────────────────────────
// Repo layout: 02-Ingestion/G-universalScout/urlbank.ts → repo root is 2 levels up.
// import.meta.url har URL-encodad path (t.ex. %20 för mellanslag) — vi måste
// avkoda innan path.resolve används för att undvika missmatch mot filsystemet.
const _herePath = decodeURIComponent(new URL('.', import.meta.url).pathname);
const REPO_ROOT = path.resolve(_herePath, '../..');
const SOURCES_DIR = path.join(REPO_ROOT, 'sources');
const EXTRACTED_DIR = path.join(REPO_ROOT, '03-Queue', '03-extractedevents');
const RUNTIME_DIR = path.join(REPO_ROOT, 'runtime');
const STATUS_FILE = path.join(RUNTIME_DIR, 'sources_status.jsonl');
const OUTPUT_FILE = path.join(RUNTIME_DIR, 'discovery-candidates.jsonl');

const PRODUCTIVITY_WINDOW_DAYS = 30;
const MAX_CANDIDATES_PER_SOURCE = 10;
const MAX_LINKS_TO_PROBE = 15;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UrlScore {
  productivity: number;    // events per URL senaste X dagar (raw count)
  stability: number;       // 0..1 — hur ofta URL återkommer (andelar av körningar)
  score: number;           // greedy composite score
}

export interface DiscoveryCandidate {
  sourceId: string;
  candidateUrl: string;
  score: number;
  productivity: number;
  stability: number;
  discoveredAt: string;
  reason: string;
  evidence?: {
    region?: string;
    matchedConcepts?: string[];
    rootUrl?: string;
    hrefPath?: string;
    isoDateCount?: number;
  };
}

export interface SourceStatus {
  sourceId: string;
  url?: string;
  status?: string;
  lastSuccess?: string | null;
  lastEventsFound?: number;
  consecutiveFailures?: number;
  lastPathUsed?: string;
  attempts?: number;
}

// ─── Swedish event patterns (lokalt — samma som scout.ts) ────────────────────

const SWEDISH_PATTERNS = [
  '/evenemang', '/events', '/kalender', '/program', '/schema', '/kalendarium',
  '/aktiviteter', '/aktivitet', '/biljetter', '/tickets', '/boka', '/booking',
  '/utstallningar', '/utstallningar', '/exhibition', '/exhibitions', '/visa',
  '/scen', '/teater', '/repertoar', '/forestallningar', '/forestallingar',
  '/konserter', '/konsert', '/musik',
  '/matcher', '/spelprogram', '/arena', '/hall',
  '/kultur', '/fritid', '/besok',
  '/arkiv',
];

const IGNORE_PATTERNS = [
  'nyheter', 'nyhet', 'press', 'kontakt', 'om-oss', 'om-os', 'login', 'logga-in',
  'policy', 'privacy', 'cookies', 'gdpr', 'social', 'facebook', 'instagram',
  'twitter', 'linkedin', 'youtube', 'spotify', 'soundcloud',
  'lediga-tjanster', 'jobb', 'jobbannonser',
  'bli-medlem', 'medlemskap', 'prenumerera',
  'foretag', 'handlare',
];

// ─── URL helpers ─────────────────────────────────────────────────────────────

function getBaseUrl(url: string): string {
  try { return new URL(url).origin; } catch { return ''; }
}

function getPathDepth(url: string, base: string): number {
  try {
    const u = new URL(url);
    const b = new URL(base);
    const pathA = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const pathB = b.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return Math.max(0, pathA.length - pathB.length);
  } catch { return 99; }
}

function shouldIgnore(href: string, anchorText: string): boolean {
  const combined = (href + ' ' + anchorText).toLowerCase();
  return IGNORE_PATTERNS.some(p => combined.includes(p));
}

function resolveUrl(href: string, base: string): string | null {
  try {
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) return new URL(href, base).href;
    return null;
  } catch { return null; }
}

function normalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    let pathname = u.pathname.replace(/\/+$/, '') || '/';
    u.pathname = pathname;
    return u.href;
  } catch {
    return url;
  }
}

function isSameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

// ─── Productivity scoring ────────────────────────────────────────────────────

/**
 * Räknar hur många events `baseUrl` har gett senaste PRODUCTIVITY_WINDOW_DAYS dagar.
 * Datakälla: 03-Queue/03-extractedevents/{gate}/{sourceId}.jsonl (lokalt).
 *
 * Returnerar productivity (raw count), stability (0..1), score (composite).
 */
export function scoreUrlProductivity(
  sourceId: string,
  baseUrl: string,
): UrlScore {
  let productivity = 0;

  const gates = ['C', 'A', 'B', 'D'];
  const now = Date.now();
  const cutoff = now - PRODUCTIVITY_WINDOW_DAYS * 24 * 3600 * 1000;

  const normalizedBase = normalizeUrlForDedup(baseUrl);

  for (const gate of gates) {
    const eventFile = path.join(EXTRACTED_DIR, gate, `${sourceId}.jsonl`);
    if (!fs.existsSync(eventFile)) continue;
    try {
      const content = fs.readFileSync(eventFile, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed) as Record<string, unknown>;
          const evUrl = (ev.sourceUrl as string) || (ev.url as string) || '';
          if (!evUrl) continue;
          const normEv = normalizeUrlForDedup(evUrl);
          if (normEv === normalizedBase || normEv.startsWith(normalizedBase)) {
            const evDate = (ev.date as string) || (ev.start_time as string) || (ev.startTime as string) || '';
            const ts = Date.parse(evDate);
            if (!isNaN(ts)) {
              if (ts >= cutoff) productivity++;
            } else {
              productivity++;
            }
          }
        } catch { /* skip malformed line */ }
      }
    } catch { /* skip unreadable file */ }
  }

  const stability = productivity > 0
    ? Math.min(1, 0.5 + Math.log10(1 + productivity) * 0.2)
    : 0;

  const score = stability * Math.log(1 + productivity);

  return { productivity, stability, score };
}

// ─── Candidate link discovery ────────────────────────────────────────────────

const CONCEPT_KEYWORDS: [string[], number][] = [
  [['event', 'evenemang', 'events', 'kalender', 'calendar', 'kalendarium', 'aktiviteter', 'aktivitet'], 3],
  [['program', 'programme', 'schema', 'spelprogram', 'repertoar', 'forestallningar', 'forestallingar'], 3],
  [['konsert', 'konserter', 'musik', 'live', 'scen', 'teater', 'show'], 2],
  [['biljett', 'biljetter', 'ticket', 'tickets', 'kop', 'kopa', 'boka', 'booking'], 2],
  [['festival', 'festivaler', 'massa', 'massor'], 1],
  [['sport', 'match', 'matcher', 'arena', 'hall'], 1],
];

function conceptScore(text: string): { score: number; matched: string[] } {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let score = 0;
  for (const [keywords, weight] of CONCEPT_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { matched.push(kw); score += weight; }
    }
  }
  return { score, matched };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyRegion(el: any): string {
  const attribs = el.attribs || {};
  const classes = (attribs.class || '').toLowerCase();
  const id = (attribs.id || '').toLowerCase();
  const tag = el.name || '';
  if (tag === 'nav' || classes.includes('nav') || id.includes('nav')) return 'nav';
  if (classes.includes('menu') || id.includes('menu') || classes.includes('submenu')) return 'submenu';
  if (classes.includes('sidebar') || id.includes('sidebar')) return 'sidebar';
  if (tag === 'footer' || classes.includes('footer')) return 'footer';
  if (classes.includes('header') || id.includes('header')) return 'menu';
  return 'content';
}

export interface CandidateLink {
  url: string;
  href: string;
  region: string;
  matchedConcepts: string[];
  isoDateCount: number;
  htmlSize: number;
}

/**
 * Hämtar root-sidan för en källa och extraherar alla event-liknande interna länkar.
 * Filtrerar bort redan-kända URLs.
 */
export async function findCandidateUrls(
  sourceId: string,
  rootUrl: string,
  alreadyKnown: Set<string> = new Set(),
): Promise<CandidateLink[]> {
  const baseUrl = getBaseUrl(rootUrl);
  if (!baseUrl) return [];

  const result = await fetchHtml(rootUrl, { timeout: 15000 });
  if (!result.success || !result.html) return [];

  const $ = cheerio.load(result.html);
  const seen = new Set<string>();
  const candidates: CandidateLink[] = [];

  $('a[href]').each((_, el) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attribs = (el as any).attribs || {};
    const href = attribs.href || '';
    const anchorText = $(el).text().trim();

    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (shouldIgnore(href, anchorText)) return;

    const fullUrl = resolveUrl(href, baseUrl);
    if (!fullUrl) return;
    if (!isSameOrigin(fullUrl, baseUrl)) return;
    if (seen.has(fullUrl)) return;

    const depth = getPathDepth(fullUrl, baseUrl);
    if (depth > 3) return;

    const { score, matched } = conceptScore(href + ' ' + anchorText);
    if (score === 0) return;

    seen.add(fullUrl);
    const region = classifyRegion(el);

    candidates.push({
      url: fullUrl,
      href,
      region,
      matchedConcepts: matched,
      isoDateCount: 0,
      htmlSize: 0,
    });
  });

  for (const pattern of SWEDISH_PATTERNS) {
    const candidateUrl = (() => {
      try { return new URL(pattern, rootUrl).href; } catch { return null; }
    })();
    if (!candidateUrl) continue;
    if (seen.has(candidateUrl)) continue;
    seen.add(candidateUrl);

    candidates.push({
      url: candidateUrl,
      href: pattern,
      region: 'swedish-pattern',
      matchedConcepts: [pattern.replace('/', '')],
      isoDateCount: 0,
      htmlSize: 0,
    });
  }

  const fresh = candidates.filter(c => {
    const norm = normalizeUrlForDedup(c.url);
    if (alreadyKnown.has(norm)) return false;
    if (normalizeUrlForDedup(c.url) === normalizeUrlForDedup(rootUrl)) return false;
    return true;
  });

  const regionBoost = (r: string) =>
    r === 'nav' ? 5 : r === 'menu' ? 4 : r === 'submenu' ? 3 : r === 'content' ? 2 : 0;

  fresh.sort((a, b) =>
    (b.matchedConcepts.length * 3 + regionBoost(b.region)) -
    (a.matchedConcepts.length * 3 + regionBoost(a.region)),
  );

  const topProbes = fresh.slice(0, MAX_LINKS_TO_PROBE);

  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < topProbes.length) {
      const idx = cursor++;
      const c = topProbes[idx];
      try {
        const r = await fetchHtml(c.url, { timeout: 8000 });
        if (r.success && r.html) {
          const $$ = cheerio.load(r.html);
          const body = $$.root().text();
          const isoRx = /\d{4}-\d{2}-\d{2}/g;
          c.isoDateCount = (body.match(isoRx) || []).length;
          c.htmlSize = r.html.length;
        }
      } catch {
        c.isoDateCount = 0;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const viable = fresh.filter(c =>
    c.isoDateCount > 0 ||
    c.region === 'swedish-pattern' ||
    c.matchedConcepts.length >= 2,
  );

  return viable;
}

// ─── Source loading helpers ──────────────────────────────────────────────────

export function loadSourcesStatus(): Map<string, SourceStatus> {
  const map = new Map<string, SourceStatus>();
  if (!fs.existsSync(STATUS_FILE)) return map;
  try {
    const content = fs.readFileSync(STATUS_FILE, 'utf-8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const s = JSON.parse(t) as SourceStatus;
        if (s && s.sourceId) {
          map.set(s.sourceId, s);
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* skip unreadable */ }
  return map;
}

export function getSourceRootUrl(sourceId: string, status?: SourceStatus): string | null {
  const sourcesFile = path.join(SOURCES_DIR, `${sourceId}.jsonl`);
  if (fs.existsSync(sourcesFile)) {
    try {
      const content = fs.readFileSync(sourcesFile, 'utf-8');
      for (const line of content.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const entry = JSON.parse(t) as Record<string, unknown>;
          if (entry.url && typeof entry.url === 'string') return entry.url;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  if (status?.url && typeof status.url === 'string' && /^https?:\/\//.test(status.url)) {
    return status.url;
  }

  return null;
}

export function getKnownUrlsForSource(sourceId: string): Set<string> {
  const known = new Set<string>();
  const gates = ['C', 'A', 'B', 'D'];
  for (const gate of gates) {
    const eventFile = path.join(EXTRACTED_DIR, gate, `${sourceId}.jsonl`);
    if (!fs.existsSync(eventFile)) continue;
    try {
      const content = fs.readFileSync(eventFile, 'utf-8');
      for (const line of content.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const ev = JSON.parse(t) as Record<string, unknown>;
          const u = (ev.sourceUrl as string) || (ev.url as string) || '';
          if (u) known.add(normalizeUrlForDedup(u));
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return known;
}

// ─── Main per-source candidate generation ─────────────────────────────────────

export interface GenerateOptions {
  minScore?: number;
  maxCandidates?: number;
}

export async function generateCandidatesForSource(
  sourceId: string,
  status: SourceStatus | undefined,
  options: GenerateOptions = {},
): Promise<DiscoveryCandidate[]> {
  const rootUrl = getSourceRootUrl(sourceId, status);
  if (!rootUrl) return [];

  const alreadyKnown = getKnownUrlsForSource(sourceId);

  const candidateLinks = await findCandidateUrls(sourceId, rootUrl, alreadyKnown);

  if (candidateLinks.length === 0) return [];

  const minScore = options.minScore ?? 0.05;
  const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES_PER_SOURCE;

  const scored: DiscoveryCandidate[] = [];

  for (const c of candidateLinks) {
    const urlScore = scoreUrlProductivity(sourceId, c.url);
    const rootScore = scoreUrlProductivity(sourceId, rootUrl);
    const marginal = urlScore.productivity - rootScore.productivity;

    const densityBoost = Math.min(c.isoDateCount / 10, 1) * 0.3;
    const conceptBoost = Math.min(c.matchedConcepts.length / 4, 1) * 0.2;
    const regionBoost = c.region === 'nav' ? 0.1
      : c.region === 'menu' || c.region === 'submenu' ? 0.07
      : c.region === 'swedish-pattern' ? 0.05
      : 0;

    const finalScore = Math.max(
      0,
      urlScore.score + densityBoost + conceptBoost + regionBoost + (marginal > 0 ? marginal * 0.05 : 0),
    );

    if (finalScore < minScore) continue;

    const reasons: string[] = [];
    if (urlScore.productivity > 0) reasons.push(`productivity=${urlScore.productivity}`);
    if (c.isoDateCount > 0) reasons.push(`isoDateCount=${c.isoDateCount}`);
    if (c.region === 'swedish-pattern') reasons.push(`swedish-pattern match`);
    if (c.matchedConcepts.length > 0) reasons.push(`concepts: ${c.matchedConcepts.slice(0, 3).join(',')}`);
    if (reasons.length === 0) reasons.push('event-link heuristic match');

    scored.push({
      sourceId,
      candidateUrl: c.url,
      score: Number(finalScore.toFixed(3)),
      productivity: urlScore.productivity,
      stability: Number(urlScore.stability.toFixed(3)),
      discoveredAt: new Date().toISOString(),
      reason: reasons.join('; '),
      evidence: {
        region: c.region,
        matchedConcepts: c.matchedConcepts,
        rootUrl,
        hrefPath: c.href,
        isoDateCount: c.isoDateCount,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCandidates);
}

// ─── Bulk discovery ──────────────────────────────────────────────────────────

export interface RunDiscoveryOptions {
  sourceId?: string;
  limit?: number;
  minScore?: number;
  onlySuccess?: boolean;
  onProgress?: (msg: string) => void;
}

export async function runDiscovery(
  options: RunDiscoveryOptions = {},
): Promise<DiscoveryCandidate[]> {
  const log = options.onProgress ?? ((m: string) => console.log(m));
  const statusMap = loadSourcesStatus();

  const allSources: Array<{ id: string; status: SourceStatus }> = [];
  for (const [id, status] of statusMap.entries()) {
    if (options.sourceId && id !== options.sourceId) continue;
    if (options.onlySuccess !== false && status.status !== 'success') continue;
    allSources.push({ id, status });
  }

  const limit = options.limit ?? allSources.length;

  log(`[urlbank] ${allSources.length} sources with status=success${options.sourceId ? ` (filter: ${options.sourceId})` : ''}, processing up to ${limit}`);

  const results: DiscoveryCandidate[] = [];
  let processed = 0;
  let withCandidates = 0;

  for (const { id, status } of allSources.slice(0, limit)) {
    processed++;
    try {
      const candidates = await generateCandidatesForSource(id, status, {
        minScore: options.minScore ?? 0.05,
        maxCandidates: MAX_CANDIDATES_PER_SOURCE,
      });
      if (candidates.length > 0) {
        withCandidates++;
        results.push(...candidates);
        log(`[urlbank] ${id}: ${candidates.length} candidates (top: ${candidates[0].candidateUrl} @ ${candidates[0].score})`);
      } else {
        log(`[urlbank] ${id}: no candidates above minScore`);
      }
    } catch (e) {
      log(`[urlbank] ${id}: ERROR ${(e as Error).message}`);
    }
  }

  log(`[urlbank] done. processed=${processed}, with-candidates=${withCandidates}, total-candidates=${results.length}`);
  return results;
}

// ─── Output writer ───────────────────────────────────────────────────────────

export function writeCandidates(candidates: DiscoveryCandidate[]): number {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }

  const existing = new Map<string, DiscoveryCandidate>();
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const content = fs.readFileSync(OUTPUT_FILE, 'utf-8');
      for (const line of content.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const c = JSON.parse(t) as DiscoveryCandidate;
          if (c.sourceId && c.candidateUrl) {
            existing.set(`${c.sourceId}::${c.candidateUrl}`, c);
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  let written = 0;
  for (const c of candidates) {
    const key = `${c.sourceId}::${c.candidateUrl}`;
    if (!existing.has(key)) written++;
    existing.set(key, c);
  }

  const lines: string[] = [];
  for (const c of existing.values()) {
    lines.push(JSON.stringify(c));
  }

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n') + '\n', 'utf-8');

  return written;
}