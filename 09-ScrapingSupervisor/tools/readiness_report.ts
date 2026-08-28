/**
 * readiness_report.ts — per-source EventPulse Readiness score (0–100).
 *
 * Implements masterplan §7 (B2B readiness) as a thin layer on top of the
 * ingestion diagnostics we already collect. Each source is scored across
 * nine fields; per-field score = (events passing / total events) * weight.
 * Total score is clamped 0–100.
 *
 * Scoring fields (masterplan §7 verbatim, mapped to live `events` columns):
 *
 *   field                | weight | live signal                                  | missing fallback
 *   ---------------------|--------|----------------------------------------------|------------------
 *   eventtitel           |  15    | title_en OR title_sv non-empty               | -
 *   datum/tid            |  15    | start_time is parsable ISO AND in future     | -
 *   pris                 |  10    | is_free === true OR price_min_sek > 0        | -
 *   venue                |  15    | venue_id resolved (UUID, non-null)           | -
 *   availability         |  10    | COLUMN MISSING in current schema -> 0p       | [UNVERIFIED]
 *   canonical ID         |  10    | COLUMN MISSING -> 0p                         | [UNVERIFIED]
 *   ticket URL           |  10    | ticket_url host in TRUSTED_TICKETING_HOSTS   | -
 *   structured data      |  10    | JSON-LD detected in raw_data                 | -
 *   cancellation/status  |   5    | status is non-null                           | -
 *                       |  100    |                                              |
 *
 * Anti-hallucination rules:
 *   - All counts come from real Supabase rows read with this tool.
 *   - Missing DB columns surface as "[UNVERIFIED]" markers in the
 *     generated markdown, never silently padded to a passing score.
 *   - Source registry is read from runtime/sources_status.jsonl, not
 *     from in-memory guesses.
 *
 * Scope (Phase 0 surface):
 *   - CLI: `npx tsx 09-ScrapingSupervisor/tools/readiness_report.ts <sourceId>`
 *          `npx tsx ... --all`
 *   - Programmatic: `generateReadinessReport({ projectRoot, sourceId })`.
 *   - Output: one markdown file per source at
 *             `09-ScrapingSupervisor/reports/readiness/<sourceId>.md`.
 *
 * NOT in scope (Phase 4 only per masterplan):
 *   - Writing to a `source_readiness` table (table does not exist yet).
 *   - Auto-outreach, partner onboarding.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import 'dotenv/config';

// ─── Public types ────────────────────────────────────────────────────────────

export type ReadinessBand = 'OK' | 'delvis' | 'dåligt' | 'saknas';

export interface ReadinessFieldStat {
  field: string;
  band: ReadinessBand;
  passing: number;
  total: number;
  weight: number;
  /** Weighted points awarded for this field, 0..weight. */
  points: number;
  /** Human-readable explanation of what we measured and why. */
  note: string;
}

export interface ReadinessReport {
  sourceId: string;
  sourceName: string | null;
  eventsScanned: number;
  generatedAt: string;
  totalScore: number;
  band: ReadinessBand;
  fields: ReadinessFieldStat[];
  /** Markdown body — same content we write to disk. */
  markdown: string;
}

export interface ReadinessOptions {
  projectRoot: string;
  /** Either a single source_id, or 'all' to scan every source with rows. */
  sourceId: string;
  /** ISO timestamp injected for deterministic tests. */
  nowIso?: string;
  /** Override output directory (default: reports/readiness). */
  outputDir?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Trusted ticketing hosts — mirrors 06-UI/services/eventServiceClient.js
 *  `TRUSTED_TICKETING_HOSTS` + a couple of common SE additions. */
export const TRUSTED_TICKETING_HOSTS: ReadonlyArray<string> = [
  'ticketmaster.se',
  'ticketmaster.com',
  'eventbrite.com',
  'eventbrite.se',
  'billetto.se',
  'billetto.com',
  'kulturhusetstadsteatern.se',
  'kulturhuset.se',
  'malmolive.se',
];

export interface FieldSpec {
  field: string;
  weight: number;
}

export const FIELD_SPECS: ReadonlyArray<FieldSpec> = [
  { field: 'eventtitel', weight: 15 },
  { field: 'datum/tid', weight: 15 },
  { field: 'pris', weight: 10 },
  { field: 'venue', weight: 15 },
  { field: 'availability', weight: 10 },
  { field: 'canonical ID', weight: 10 },
  { field: 'ticket URL', weight: 10 },
  { field: 'structured data', weight: 10 },
  { field: 'cancellation/status', weight: 5 },
];

// ─── Row shape ───────────────────────────────────────────────────────────────

/** Minimum subset of `events` columns this tool reads. */
export interface ReadinessEventRow {
  id?: string;
  source?: string | null;
  source_id?: string | null;
  title_en?: string | null;
  title_sv?: string | null;
  start_time?: string | null;
  venue_id?: string | null;
  is_free?: boolean | null;
  price_min_sek?: number | null;
  ticket_url?: string | null;
  status?: string | null;
  /** Phase 4 columns (not in current schema). Always undefined today. */
  availability?: string | null;
  canonical_event_id?: string | null;
  /** Used for structured-data detection. */
  raw_data?: unknown;
}

// ─── Supabase client (lazy, errors-as-data) ──────────────────────────────────

let _client: SupabaseClient | null = null;

export function db(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

/** Reset cached client (used by tests that inject a fake env). */
export function _resetDbClient(): void {
  _client = null;
}

// ─── Pure scoring helpers (no I/O — fully unit-testable) ──────────────────────

const PLACEHOLDER_TITLES = new Set([
  'undefined', 'null', 'none', 'tba', 'tbd', 'n/a', 'na', 'saknas',
  'event', 'eventtitel', 'untitled', 'no title',
]);

export function hasRealTitle(row: ReadinessEventRow): boolean {
  const t = (row.title_en ?? row.title_sv ?? '').trim().toLowerCase();
  if (!t) return false;
  if (PLACEHOLDER_TITLES.has(t)) return false;
  return t.length >= 2;
}

export function hasFutureStart(row: ReadinessEventRow, nowIso: string): boolean {
  const raw = row.start_time;
  if (typeof raw !== 'string' || raw.length === 0) return false;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return false;
  return t > Date.parse(nowIso);
}

export function hasPrice(row: ReadinessEventRow): boolean {
  if (row.is_free === true) return true;
  return typeof row.price_min_sek === 'number' && row.price_min_sek > 0;
}

export function hasVenue(row: ReadinessEventRow): boolean {
  return typeof row.venue_id === 'string' && row.venue_id.length > 0;
}

/** Availability and canonical_event_id do not exist in the current schema.
 *  Returning false keeps the score honest. Phase 4 will plug in real columns. */
export function hasAvailability(_row: ReadinessEventRow): boolean {
  return false;
}

export function hasCanonicalId(_row: ReadinessEventRow): boolean {
  return false;
}

export function hasValidTicketUrl(row: ReadinessEventRow): boolean {
  const url = (row.ticket_url ?? '').trim();
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return TRUSTED_TICKETING_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/** JSON-LD detection — inspect raw_data for `@type: Event` or schema.org
 *  keys. Conservative: only true when we find a clear Event-flavored obj. */
export function hasStructuredData(row: ReadinessEventRow): boolean {
  const raw = row.raw_data;
  if (raw == null) return false;
  const visit = (node: unknown): boolean => {
    if (node == null) return false;
    if (Array.isArray(node)) return node.some(visit);
    if (typeof node !== 'object') return false;
    const obj = node as Record<string, unknown>;
    const typeVal = obj['@type'];
    if (typeof typeVal === 'string' && /event/i.test(typeVal)) return true;
    if (
      Array.isArray(typeVal) &&
      typeVal.some((t) => typeof t === 'string' && /event/i.test(t))
    ) {
      return true;
    }
    if (Array.isArray(obj['@graph'])) return visit(obj['@graph']);
    for (const key of ['jsonLd', 'jsonld', 'structuredData', 'structured_data']) {
      if (key in obj && visit(obj[key])) return true;
    }
    return false;
  };
  return visit(raw);
}

export function hasStatus(row: ReadinessEventRow): boolean {
  return typeof row.status === 'string' && row.status.trim().length > 0;
}

interface FieldRule {
  field: string;
  weight: number;
  predicate: (row: ReadinessEventRow, nowIso: string) => boolean;
  /** If true the field is structurally unsupported in the current DB. */
  unsupported?: boolean;
  note: string;
}

const FIELD_RULES: ReadonlyArray<FieldRule> = [
  {
    field: 'eventtitel', weight: 15, predicate: (r) => hasRealTitle(r),
    note: 'non-empty title_en/title_sv, not a placeholder',
  },
  {
    field: 'datum/tid', weight: 15,
    predicate: (r, now) => hasFutureStart(r, now),
    note: 'start_time is a parsable ISO timestamp in the future',
  },
  {
    field: 'pris', weight: 10, predicate: (r) => hasPrice(r),
    note: 'is_free=true or price_min_sek > 0',
  },
  {
    field: 'venue', weight: 15, predicate: (r) => hasVenue(r),
    note: 'venue_id resolved (UUID, non-null)',
  },
  {
    field: 'availability', weight: 10, predicate: (r) => hasAvailability(r),
    note: '[UNVERIFIED] no `availability` column in current events schema',
    unsupported: true,
  },
  {
    field: 'canonical ID', weight: 10, predicate: (r) => hasCanonicalId(r),
    note: '[UNVERIFIED] no `canonical_event_id` column in current events schema',
    unsupported: true,
  },
  {
    field: 'ticket URL', weight: 10, predicate: (r) => hasValidTicketUrl(r),
    note: 'ticket_url parses and host is in TRUSTED_TICKETING_HOSTS',
  },
  {
    field: 'structured data', weight: 10,
    predicate: (r) => hasStructuredData(r),
    note: 'JSON-LD / schema.org Event detected in raw_data',
  },
  {
    field: 'cancellation/status', weight: 5, predicate: (r) => hasStatus(r),
    note: 'status is non-null',
  },
];

export function computeReadiness(
  events: ReadonlyArray<ReadinessEventRow>,
  nowIso: string,
): { fields: ReadinessFieldStat[]; totalScore: number; band: ReadinessBand } {
  const total = events.length;
  const fields: ReadinessFieldStat[] = FIELD_RULES.map((rule) => {
    const passing = total === 0 ? 0 : events.filter((r) => rule.predicate(r, nowIso)).length;
    const ratio = total === 0 ? 0 : passing / total;
    const points = total === 0 ? 0 : Math.round(ratio * rule.weight);
    return {
      field: rule.field,
      band: bandFor(rule.unsupported === true ? 'unsupported' : ratio, passing, total),
      passing,
      total,
      weight: rule.weight,
      points,
      note: rule.note,
    };
  });

  const totalScore = Math.max(
    0,
    Math.min(100, fields.reduce((acc, f) => acc + f.points, 0)),
  );

  return { fields, totalScore, band: totalBandFor(totalScore) };
}

function bandFor(kind: 'unsupported' | number, passing: number, total: number): ReadinessBand {
  if (kind === 'unsupported') return 'saknas';
  if (total === 0) return 'saknas';
  if (passing === total) return 'OK';
  if (passing === 0) return 'saknas';
  return 'delvis';
}

function totalBandFor(score: number): ReadinessBand {
  if (score >= 80) return 'OK';
  if (score >= 40) return 'delvis';
  return 'dåligt';
}

// ─── Source registry read (filesystem) ───────────────────────────────────────

export interface StatusRow {
  sourceId: string;
  status?: string;
  ingestionStage?: string;
  lastEventsFound?: number;
  lastRun?: string | null;
}

export function readSourceRegistry(projectRoot: string): Map<string, StatusRow> {
  const path = resolve(projectRoot, 'runtime/sources_status.jsonl');
  const out = new Map<string, StatusRow>();
  if (!existsSync(path)) return out;
  const text = readFileSync(path, 'utf-8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as StatusRow;
      if (typeof row.sourceId === 'string' && row.sourceId.length > 0) {
        if (!out.has(row.sourceId)) out.set(row.sourceId, row);
      }
    } catch {
      // skip malformed lines — never invent registry data
    }
  }
  return out;
}

export function listSourceIds(projectRoot: string): string[] {
  return Array.from(readSourceRegistry(projectRoot).keys()).sort();
}

// ─── Supabase fetch (errors-as-data) ─────────────────────────────────────────

export interface FetchResult {
  ok: boolean;
  error: string | null;
  rows: ReadinessEventRow[];
}

const DB_SELECT = [
  'id',
  'source',
  'source_id',
  'title_en',
  'title_sv',
  'start_time',
  'venue_id',
  'is_free',
  'price_min_sek',
  'ticket_url',
  'status',
  'raw_data',
].join(', ');

const DB_PAGE_SIZE = 1_000;
const DB_MAX_ROWS = 5_000;

/** Paginate a source's events. Hard cap keeps the report bounded;
 *  readiness is aggregate so sampling at the cap is fine. */
export async function fetchEventsBySource(source: string): Promise<FetchResult> {
  const sb = db();
  if (!sb) {
    return { ok: false, error: 'Supabase not configured', rows: [] };
  }
  const rows: ReadinessEventRow[] = [];
  for (let offset = 0; offset < DB_MAX_ROWS; offset += DB_PAGE_SIZE) {
    const { data, error } = await sb
      .from('events')
      .select(DB_SELECT)
      .eq('source', source)
      .range(offset, offset + DB_PAGE_SIZE - 1);
    if (error) return { ok: false, error: error.message, rows };
    const batch = (data ?? []) as ReadinessEventRow[];
    rows.push(...batch);
    if (batch.length < DB_PAGE_SIZE) break;
    if (offset + DB_PAGE_SIZE >= DB_MAX_ROWS) break;
  }
  return { ok: true, error: null, rows };
}

export async function listSourceNames(): Promise<string[]> {
  const sb = db();
  if (!sb) return [];
  const { data, error } = await sb
    .from('events')
    .select('source')
    .not('source', 'is', null)
    .limit(50_000);
  if (error || !data) return [];
  const set = new Set<string>();
  for (const row of data) {
    if (typeof row.source === 'string' && row.source.length > 0) {
      set.add(row.source);
    }
  }
  return Array.from(set).sort();
}

// ─── Markdown rendering ──────────────────────────────────────────────────────

const DISPLAY_NAME: Record<string, string> = {
  ticketmaster: 'Ticketmaster',
  eventbrite: 'Eventbrite',
  billetto: 'Billetto',
  kulturhuset: 'Kulturhuset',
  malmo_live: 'Malmö Live',
  malmolive: 'Malmö Live',
};

export function sourceDisplayName(source: string, _registry: StatusRow | undefined): string {
  return DISPLAY_NAME[source] ?? source;
}

export function renderReadinessMarkdown(report: Omit<ReadinessReport, 'markdown'>): string {
  const lines: string[] = [];
  const heading = `${report.sourceName ?? report.sourceId} — EventPulse Readiness ${report.totalScore}/100`;
  lines.push(`# ${heading}`);
  lines.push('');
  lines.push(`Source id: \`${report.sourceId}\``);
  if (report.eventsScanned === 0) {
    lines.push('Events scanned: **0** — no rows in `events` for this source. Score is 0.');
  } else {
    lines.push(`Events scanned: **${report.eventsScanned}**`);
  }
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`Overall band: **${report.band}**`);
  lines.push('');
  lines.push('| field | status | passing / total | points |');
  lines.push('|-------|--------|-----------------|--------|');
  for (const f of report.fields) {
    lines.push(`| ${f.field} | ${f.band} | ${f.passing} / ${f.total} | ${f.points} / ${f.weight} |`);
  }
  lines.push('');
  lines.push('### Field notes');
  for (const f of report.fields) {
    lines.push(`- **${f.field}** (${f.points}/${f.weight}) — ${f.note}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Public entry: generate report(s) ────────────────────────────────────────

export async function generateReadinessReport(opts: ReadinessOptions): Promise<{
  reports: ReadinessReport[];
  errors: Array<{ sourceId: string; error: string }>;
}> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const registry = readSourceRegistry(opts.projectRoot);

  let targets: string[];
  if (opts.sourceId === 'all') {
    const fromDb = await listSourceNames();
    targets = Array.from(new Set([...registry.keys(), ...fromDb])).sort();
  } else {
    targets = [opts.sourceId];
  }

  const outDir = resolve(
    opts.projectRoot,
    opts.outputDir ?? '09-ScrapingSupervisor/reports/readiness',
  );
  mkdirSync(outDir, { recursive: true });

  const reports: ReadinessReport[] = [];
  const errors: Array<{ sourceId: string; error: string }> = [];

  for (const sourceId of targets) {
    const fetchResult = await fetchEventsBySource(sourceId);
    if (!fetchResult.ok) {
      errors.push({ sourceId, error: fetchResult.error ?? 'unknown fetch error' });
      continue;
    }
    const rows = fetchResult.rows;
    const { fields, totalScore, band } = computeReadiness(rows, nowIso);
    const regRow = registry.get(sourceId);
    const report: Omit<ReadinessReport, 'markdown'> = {
      sourceId,
      sourceName: sourceDisplayName(sourceId, regRow),
      eventsScanned: rows.length,
      generatedAt: nowIso,
      totalScore,
      band,
      fields,
    };
    const markdown = renderReadinessMarkdown(report);
    const fullReport: ReadinessReport = { ...report, markdown };
    reports.push(fullReport);

    const filePath = resolve(outDir, `${sourceId}.md`);
    writeFileSync(filePath, markdown, 'utf-8');
  }

  return { reports, errors };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx readiness_report.ts <sourceId> | --all');
    process.exitCode = 2;
    return;
  }
  const sourceId = arg === '--all' ? 'all' : arg;
  const projectRoot = process.cwd();
  const { reports, errors } = await generateReadinessReport({ projectRoot, sourceId });

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`[readiness] ${e.sourceId}: ${e.error}`);
    }
  }

  const indexPath = resolve(
    projectRoot,
    '09-ScrapingSupervisor/reports/readiness/INDEX.md',
  );
  const idx: string[] = ['# Readiness Index', '', `Generated: ${new Date().toISOString()}`, ''];
  idx.push('| source | score | band | events | report |');
  idx.push('|--------|-------|------|--------|--------|');
  for (const r of reports) {
    idx.push(
      `| ${r.sourceId} | ${r.totalScore}/100 | ${r.band} | ${r.eventsScanned} | ${r.sourceId}.md |`,
    );
  }
  for (const e of errors) {
    idx.push(`| ${e.sourceId} | — | error | — | (${e.error}) |`);
  }
  writeFileSync(indexPath, idx.join('\n') + '\n', 'utf-8');

  console.log(
    `[readiness] Wrote ${reports.length} report(s) to 09-ScrapingSupervisor/reports/readiness/`,
  );
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('readiness_report.ts');
if (isMain) {
  main().catch((err: unknown) => {
    console.error('[readiness] fatal:', (err as Error)?.message ?? err);
    process.exit(1);
  });
}
