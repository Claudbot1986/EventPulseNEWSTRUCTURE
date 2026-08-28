/**
 * Unit tests for `readiness_report.ts`.
 *
 * Coverage:
 *   - Pure scoring helpers:
 *       - hasRealTitle / hasFutureStart / hasPrice / hasVenue
 *       - hasValidTicketUrl (allowlist + suffix matching)
 *       - hasStructuredData (JSON-LD shapes)
 *       - hasStatus
 *   - computeReadiness:
 *       - All-pass -> 100 + band OK
 *       - Mixed -> partial score with per-field passing/total
 *       - Empty input -> 0 + band saknas
 *       - Weight clamp: never exceeds 100
 *       - Unsupported fields (availability, canonical ID) always 0 + 'saknas'
 *   - renderReadinessMarkdown:
 *       - Masterplan sect.7-style header + table + notes block
 *   - generateReadinessReport (DB-mocked):
 *       - Errors-as-data when Supabase missing
 *       - 'all' dedupes registry + DB-discovered sources
 *   - readSourceRegistry:
 *       - Parses runtime/sources_status.jsonl, skips malformed lines
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  computeReadiness,
  generateReadinessReport,
  hasCanonicalId,
  hasAvailability,
  hasFutureStart,
  hasPrice,
  hasRealTitle,
  hasStatus,
  hasStructuredData,
  hasValidTicketUrl,
  hasVenue,
  renderReadinessMarkdown,
  readSourceRegistry,
  sourceDisplayName,
  TRUSTED_TICKETING_HOSTS,
  type ReadinessEventRow,
} from '../tools/readiness_report.js';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

let tmpRoot: string;
const NOW_ISO = '2026-08-19T12:00:00.000Z';

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'readiness-test-'));
  mkdirSync(resolve(tmpRoot, 'runtime'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeRow(overrides: Partial<ReadinessEventRow> = {}): ReadinessEventRow {
  return {
    id: 'row-1',
    source: 'ticketmaster',
    source_id: 'tm-1',
    title_en: 'Concert',
    title_sv: null,
    start_time: '2026-09-01T19:00:00.000Z',
    venue_id: 'venue-uuid-1',
    is_free: false,
    price_min_sek: 250,
    ticket_url: 'https://ticketmaster.se/event/abc',
    status: 'published',
    // Structured-data signal so the "all pass" test can hit 100.
    raw_data: { '@type': 'Event', name: 'Concert' },
    ...overrides,
  };
}

// ─── Pure predicates ────────────────────────────────────────────────────────

describe('hasRealTitle', () => {
  it('accepts a normal title', () => {
    expect(hasRealTitle({ title_en: 'Symphony Night' })).toBe(true);
  });
  it('rejects empty / placeholder titles', () => {
    expect(hasRealTitle({ title_en: '' })).toBe(false);
    expect(hasRealTitle({ title_en: 'undefined' })).toBe(false);
    expect(hasRealTitle({ title_en: 'tba' })).toBe(false);
    expect(hasRealTitle({})).toBe(false);
  });
});

describe('hasFutureStart', () => {
  it('accepts ISO > now', () => {
    expect(hasFutureStart({ start_time: '2026-12-01T19:00:00.000Z' }, NOW_ISO)).toBe(true);
  });
  it('rejects past / unparsable / null', () => {
    expect(hasFutureStart({ start_time: '2020-01-01T00:00:00.000Z' }, NOW_ISO)).toBe(false);
    expect(hasFutureStart({ start_time: 'not-a-date' }, NOW_ISO)).toBe(false);
    expect(hasFutureStart({ start_time: null }, NOW_ISO)).toBe(false);
  });
});

describe('hasPrice', () => {
  it('accepts is_free=true', () => {
    expect(hasPrice({ is_free: true, price_min_sek: 0 })).toBe(true);
  });
  it('accepts price_min_sek > 0', () => {
    expect(hasPrice({ is_free: false, price_min_sek: 150 })).toBe(true);
  });
  it('rejects 0 / null / undefined', () => {
    expect(hasPrice({ is_free: false, price_min_sek: 0 })).toBe(false);
    expect(hasPrice({ is_free: null, price_min_sek: null })).toBe(false);
  });
});

describe('hasVenue', () => {
  it('accepts non-empty UUID string', () => {
    expect(hasVenue({ venue_id: 'abc-uuid' })).toBe(true);
  });
  it('rejects null / empty', () => {
    expect(hasVenue({ venue_id: null })).toBe(false);
    expect(hasVenue({})).toBe(false);
  });
});

describe('hasAvailability / hasCanonicalId', () => {
  it('always false in current schema (Phase 4 deliverable)', () => {
    expect(hasAvailability({ availability: 'in_stock' })).toBe(false);
    expect(hasCanonicalId({ canonical_event_id: 'canon-1' })).toBe(false);
  });
});

describe('hasValidTicketUrl', () => {
  it('accepts hosts in the allowlist', () => {
    expect(hasValidTicketUrl({ ticket_url: 'https://ticketmaster.se/event/abc' })).toBe(true);
    expect(hasValidTicketUrl({ ticket_url: 'https://billetto.se/e/123' })).toBe(true);
  });
  it('accepts subdomain of allowlisted host', () => {
    expect(hasValidTicketUrl({ ticket_url: 'https://www.ticketmaster.se/e' })).toBe(true);
  });
  it('rejects unknown hosts', () => {
    expect(hasValidTicketUrl({ ticket_url: 'https://example.com/e' })).toBe(false);
  });
  it('rejects empty / malformed', () => {
    expect(hasValidTicketUrl({ ticket_url: '' })).toBe(false);
    expect(hasValidTicketUrl({ ticket_url: 'not-a-url' })).toBe(false);
  });
});

describe('hasStructuredData', () => {
  it('detects @type Event object', () => {
    expect(hasStructuredData({ raw_data: { '@type': 'Event', name: 'X' } })).toBe(true);
  });
  it('detects nested @graph with Event', () => {
    expect(
      hasStructuredData({ raw_data: { '@graph': [{ '@type': 'Event' }] } }),
    ).toBe(true);
  });
  it('detects jsonLd array with Event', () => {
    expect(hasStructuredData({ raw_data: { jsonLd: [{ '@type': 'MusicEvent' }] } })).toBe(
      true,
    );
  });
  it('rejects non-event JSON-LD', () => {
    expect(hasStructuredData({ raw_data: { '@type': 'Organization' } })).toBe(false);
    expect(hasStructuredData({ raw_data: null })).toBe(false);
    expect(hasStructuredData({})).toBe(false);
  });
});

describe('hasStatus', () => {
  it('accepts any non-null string', () => {
    expect(hasStatus({ status: 'published' })).toBe(true);
    expect(hasStatus({ status: 'cancelled' })).toBe(true);
  });
  it('rejects null / empty', () => {
    expect(hasStatus({ status: null })).toBe(false);
    expect(hasStatus({ status: '' })).toBe(false);
  });
});

// ─── computeReadiness ────────────────────────────────────────────────────────

describe('computeReadiness', () => {
  it('caps at 80 (unsupported fields) when every supported field passes', () => {
    const rows = [makeRow(), makeRow({ id: 'row-2' })];
    const r = computeReadiness(rows, NOW_ISO);
    // availability + canonical ID always 0 (no DB columns today) -> max 80.
    expect(r.totalScore).toBe(80);
    expect(r.band).toBe('OK');
    for (const f of r.fields) {
      if (f.field === 'availability' || f.field === 'canonical ID') {
        expect(f.points).toBe(0);
        expect(f.band).toBe('saknas');
        continue;
      }
      expect(f.passing).toBe(2);
      expect(f.points).toBe(f.weight);
      expect(f.band).toBe('OK');
    }
  });

  it('returns 0 + saknas for empty input (no fabricated counts)', () => {
    const r = computeReadiness([], NOW_ISO);
    expect(r.totalScore).toBe(0);
    expect(r.band).toBe('dåligt');
    for (const f of r.fields) {
      expect(f.passing).toBe(0);
      expect(f.points).toBe(0);
    }
  });

  it('awards partial points per passing ratio', () => {
    const good = makeRow();
    const bad = makeRow({
      id: 'row-bad',
      title_en: null,
      title_sv: null,
      start_time: '2020-01-01T00:00:00.000Z',
      venue_id: null,
      ticket_url: null,
      price_min_sek: 0,
      is_free: false,
      status: null,
      raw_data: null,
    });
    const r = computeReadiness([good, bad], NOW_ISO);
    const title = r.fields.find((f: { field: string }) => f.field === 'eventtitel')!;
    expect(title.passing).toBe(1);
    // 1/2 * 15 = 7.5 -> 8 (rounded).
    expect(title.points).toBe(8);
    expect(title.band).toBe('delvis');
  });

  it('clamps total score into 0..100', () => {
    const rows = [makeRow()];
    const r = computeReadiness(rows, NOW_ISO);
    expect(r.totalScore).toBeGreaterThanOrEqual(0);
    expect(r.totalScore).toBeLessThanOrEqual(100);
  });

  it('marks unsupported fields (availability, canonical ID) as saknas + 0', () => {
    const rows = [makeRow()];
    const r = computeReadiness(rows, NOW_ISO);
    for (const name of ['availability', 'canonical ID']) {
      const f = r.fields.find((x: { field: string }) => x.field === name)!;
      expect(f.points).toBe(0);
      expect(f.band).toBe('saknas');
      expect(f.note).toContain('[UNVERIFIED]');
    }
  });

  it('weights sum to exactly 100', () => {
    const r = computeReadiness([makeRow()], NOW_ISO);
    const sum = r.fields.reduce(
      (acc: number, f: { weight: number }) => acc + f.weight,
      0,
    );
    expect(sum).toBe(100);
  });
});

// ─── renderReadinessMarkdown ─────────────────────────────────────────────────

describe('renderReadinessMarkdown', () => {
  it('produces a sect.7-style markdown with header, table, notes', () => {
    const r = computeReadiness([makeRow()], NOW_ISO);
    const md = renderReadinessMarkdown({
      sourceId: 'ticketmaster',
      sourceName: 'Ticketmaster',
      eventsScanned: 1,
      generatedAt: NOW_ISO,
      totalScore: r.totalScore,
      band: r.band,
      fields: r.fields,
    });
    expect(md).toMatch(/^# Ticketmaster — EventPulse Readiness \d+\/100/m);
    expect(md).toContain('Source id: `ticketmaster`');
    expect(md).toContain('Events scanned: **1**');
    expect(md).toContain('| field | status | passing / total | points |');
    expect(md).toContain('### Field notes');
    for (const f of [
      'eventtitel',
      'datum/tid',
      'pris',
      'venue',
      'availability',
      'canonical ID',
      'ticket URL',
      'structured data',
      'cancellation/status',
    ]) {
      expect(md).toContain(f);
    }
  });

  it('renders 0-event state honestly (no fake passing counts)', () => {
    const r = computeReadiness([], NOW_ISO);
    const md = renderReadinessMarkdown({
      sourceId: 'ghost',
      sourceName: null,
      eventsScanned: 0,
      generatedAt: NOW_ISO,
      totalScore: 0,
      band: r.band,
      fields: r.fields,
    });
    expect(md).toContain('Events scanned: **0**');
    expect(md).toContain('no rows in `events` for this source');
  });
});

// ─── sourceDisplayName ──────────────────────────────────────────────────────

describe('sourceDisplayName', () => {
  it('prettifies known sources', () => {
    expect(sourceDisplayName('ticketmaster', undefined)).toBe('Ticketmaster');
    expect(sourceDisplayName('billetto', undefined)).toBe('Billetto');
  });
  it('falls back to source id', () => {
    expect(sourceDisplayName('some-random-source', undefined)).toBe('some-random-source');
  });
});

// ─── readSourceRegistry ─────────────────────────────────────────────────────

describe('readSourceRegistry', () => {
  it('parses sources_status.jsonl, first-writer wins, skips malformed', () => {
    const lines = [
      JSON.stringify({ sourceId: 'a6', status: 'success' }),
      JSON.stringify({ sourceId: 'foo', status: 'fail' }),
      'not-json',
      JSON.stringify({ no_sourceId: true }),
      '',
    ].join('\n');
    writeFileSync(resolve(tmpRoot, 'runtime/sources_status.jsonl'), lines, 'utf-8');
    const m = readSourceRegistry(tmpRoot);
    expect(m.size).toBe(2);
    expect(m.get('a6')?.status).toBe('success');
    expect(m.get('foo')?.status).toBe('fail');
  });

  it('returns empty map when file missing', () => {
    expect(readSourceRegistry(tmpRoot).size).toBe(0);
  });
});

// ─── generateReadinessReport (Supabase-mocked) ──────────────────────────────

describe('generateReadinessReport', () => {
  it('returns errors-as-data when Supabase env is not configured', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { reports, errors } = await generateReadinessReport({
      projectRoot: tmpRoot,
      sourceId: 'ticketmaster',
      nowIso: NOW_ISO,
    });
    expect(reports).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.sourceId).toBe('ticketmaster');
    expect(errors[0]?.error).toContain('Supabase not configured');
  });

  it('dedupes registry sources for --all when Supabase env is missing', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const registryRows = [
      JSON.stringify({ sourceId: 'a6' }),
      JSON.stringify({ sourceId: 'foo' }),
    ].join('\n');
    writeFileSync(resolve(tmpRoot, 'runtime/sources_status.jsonl'), registryRows, 'utf-8');

    const { reports, errors } = await generateReadinessReport({
      projectRoot: tmpRoot,
      sourceId: 'all',
      nowIso: NOW_ISO,
    });
    // Without Supabase, every fetch errors out. We must NOT fabricate
    // reports — verify the errors-as-data contract.
    expect(reports).toEqual([]);
    expect(errors.map((e: { sourceId: string }) => e.sourceId).sort()).toEqual(['a6', 'foo']);
  });
});

// ─── trust-list sanity ──────────────────────────────────────────────────────

describe('TRUSTED_TICKETING_HOSTS', () => {
  it('contains the masterplan-relevant hosts', () => {
    for (const host of [
      'ticketmaster.se',
      'ticketmaster.com',
      'eventbrite.com',
      'eventbrite.se',
      'billetto.se',
      'billetto.com',
    ]) {
      expect(TRUSTED_TICKETING_HOSTS).toContain(host);
    }
  });
});
