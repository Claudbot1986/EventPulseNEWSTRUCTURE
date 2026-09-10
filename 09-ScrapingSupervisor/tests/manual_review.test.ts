/**
 * Tests for the manual-review dashboard collector.
 *
 * Covers:
 *   - buildSourceUrlMap: three-tier fallback (extractedevents → registry →
 *     cleanup-audit). Verifies that tier-1 wins when present, tier-2 wins
 *     when tier-1 is absent, and tier-3 fills the gap for archived sources.
 *   - collectManualReview: distinct-source dedup, queuedAt-desc sort,
 *     URL resolution propagation, capped output, empty-state behavior
 *     when the queue file is missing or empty.
 *
 * No mocks of fs — uses a real tmpdir so the read path is the same as
 * production. No writes outside the tmpdir.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  buildSourceUrlMap,
  collectManualReview,
} from '../dashboard/server';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'manual-review-fixture-'));
}

function rmTmp(root: string): void {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeExtractedEvent(root: string, sourceId: string, sourceUrl: string): void {
  const dir = join(root, '03-Queue', '03-extractedevents');
  mkdirSync(dir, { recursive: true });
  const row = {
    title: 'Sample',
    date: '2026-09-09',
    url: 'https://example.com/event-1',
    sourceUrl,
    source: sourceId,
    confidence: { score: 1 },
  };
  writeFileSync(join(dir, `${sourceId}.jsonl`), JSON.stringify(row) + '\n');
}

function writeRegistrySource(root: string, sourceId: string, url: string): void {
  const dir = join(root, 'sources');
  mkdirSync(dir, { recursive: true });
  const row = { id: sourceId, url, name: sourceId, type: 'venue', city: 'Stockholm', discoveredAt: '2026-09-09' };
  writeFileSync(join(dir, `${sourceId}.jsonl`), JSON.stringify(row) + '\n');
}

function writeCleanupAudit(root: string, rows: Array<{ sourceId: string; url: string }>): void {
  const dir = join(root, 'runtime');
  mkdirSync(dir, { recursive: true });
  const lines = rows.map((r) => JSON.stringify({
    auditType: 'source-cleanup',
    date: '2026-08-19',
    sourceId: r.sourceId,
    url: r.url,
    name: r.sourceId,
    city: 'Stockholm',
    reasons: ['stale-non-sthlm'],
    status: 'fail',
  }));
  writeFileSync(join(dir, 'audit-2026-08-19-source-cleanup.jsonl'), lines.join('\n') + '\n');
}

function writeManualReviewQueue(
  root: string,
  rows: Array<{ sourceId: string; queuedAt: string; stage?: string; notes?: string; round?: number }>,
): void {
  const dir = join(root, 'runtime');
  mkdirSync(dir, { recursive: true });
  const lines = rows.map((r) => JSON.stringify({
    sourceId: r.sourceId,
    queueName: 'postTestC-manual-review',
    queuedAt: r.queuedAt,
    priority: 1,
    attempt: 1,
    queueReason: '',
    workerNotes: r.notes ?? 'C3: fail',
    winningStage: r.stage ?? 'C3',
    outcomeType: 'fail',
    routeSuggestion: 'Fail',
    roundNumber: r.round ?? 1,
    roundsParticipated: 1,
  }));
  writeFileSync(join(dir, 'postTestC-manual-review.jsonl'), lines.join('\n') + '\n');
}

// ─── buildSourceUrlMap ──────────────────────────────────────────────────────

describe('buildSourceUrlMap', () => {
  let root: string;

  beforeEach(() => { root = makeTmpRoot(); });
  afterEach(() => { rmTmp(root); });

  it('returns an empty map when no directories exist', () => {
    const m = buildSourceUrlMap(root);
    expect(m.size).toBe(0);
  });

  it('uses sourceUrl from tier-1 (extractedevents JSONL) when present', () => {
    writeExtractedEvent(root, 'aik', 'https://aik.se/from-extracted/');
    writeRegistrySource(root, 'aik', 'https://aik.se/from-registry/');
    const m = buildSourceUrlMap(root);
    expect(m.get('aik')).toBe('https://aik.se/from-extracted/');
  });

  it('falls back to registry (tier 2) when extractedevents is absent', () => {
    writeRegistrySource(root, 'konstkalendern', 'https://konstkalendern.com/');
    const m = buildSourceUrlMap(root);
    expect(m.get('konstkalendern')).toBe('https://konstkalendern.com/');
  });

  it('falls back to cleanup audit (tier 3) when both tier 1 and 2 are absent', () => {
    writeCleanupAudit(root, [{ sourceId: 'archived-source', url: 'https://archived.example.com/' }]);
    const m = buildSourceUrlMap(root);
    expect(m.get('archived-source')).toBe('https://archived.example.com/');
  });

  it('prefers tier 1 over tier 3 when both are present', () => {
    writeExtractedEvent(root, 'aik', 'https://aik.se/from-extracted/');
    writeCleanupAudit(root, [{ sourceId: 'aik', url: 'https://aik.se/from-audit/' }]);
    const m = buildSourceUrlMap(root);
    expect(m.get('aik')).toBe('https://aik.se/from-extracted/');
  });

  it('skips malformed registry rows without throwing', () => {
    writeRegistrySource(root, 'broken', 'https://broken.example.com/');
    // Append a malformed line to the registry file.
    const fs = require('fs') as typeof import('fs');
    fs.appendFileSync(join(root, 'sources', 'broken.jsonl'), '{ not valid json\n');
    const m = buildSourceUrlMap(root);
    expect(m.get('broken')).toBe('https://broken.example.com/');
  });
});

// ─── collectManualReview ────────────────────────────────────────────────────

describe('collectManualReview', () => {
  let root: string;

  beforeEach(() => { root = makeTmpRoot(); });
  afterEach(() => { rmTmp(root); });

  it('returns empty summary when the queue file is missing', () => {
    const m = buildSourceUrlMap(root);
    const r = collectManualReview(root, m);
    expect(r.count).toBe(0);
    expect(r.totalRows).toBe(0);
    expect(r.rows).toEqual([]);
  });

  it('returns empty summary when the queue file is empty', () => {
    mkdirSync(join(root, 'runtime'), { recursive: true });
    writeFileSync(join(root, 'runtime', 'postTestC-manual-review.jsonl'), '');
    const m = buildSourceUrlMap(root);
    const r = collectManualReview(root, m);
    expect(r.count).toBe(0);
    expect(r.totalRows).toBe(0);
  });

  it('deduplicates by sourceId (same source across multiple rounds counts once)', () => {
    writeManualReviewQueue(root, [
      { sourceId: 'aik', queuedAt: '2026-09-09T10:00:00.000Z', round: 1 },
      { sourceId: 'aik', queuedAt: '2026-09-08T10:00:00.000Z', round: 2 },
      { sourceId: 'konstkalendern', queuedAt: '2026-09-09T11:00:00.000Z' },
    ]);
    writeRegistrySource(root, 'aik', 'https://aik.se/');
    writeRegistrySource(root, 'konstkalendern', 'https://konstkalendern.com/');
    const m = buildSourceUrlMap(root);
    const r = collectManualReview(root, m);
    expect(r.count).toBe(2);
    expect(r.totalRows).toBe(3);
    expect(r.rows.map((x) => x.sourceId).sort()).toEqual(['aik', 'konstkalendern']);
  });

  it('sorts rows by queuedAt descending (newest first)', () => {
    writeManualReviewQueue(root, [
      { sourceId: 'old', queuedAt: '2026-09-01T10:00:00.000Z' },
      { sourceId: 'newest', queuedAt: '2026-09-09T10:00:00.000Z' },
      { sourceId: 'middle', queuedAt: '2026-09-05T10:00:00.000Z' },
    ]);
    writeRegistrySource(root, 'old', 'https://old.example.com/');
    writeRegistrySource(root, 'newest', 'https://newest.example.com/');
    writeRegistrySource(root, 'middle', 'https://middle.example.com/');
    const m = buildSourceUrlMap(root);
    const r = collectManualReview(root, m);
    expect(r.rows.map((x) => x.sourceId)).toEqual(['newest', 'middle', 'old']);
  });

  it('resolves URL from tier-1 (extractedevents) when present', () => {
    writeExtractedEvent(root, 'aik', 'https://aik.se/canonical/');
    writeManualReviewQueue(root, [
      { sourceId: 'aik', queuedAt: '2026-09-09T10:00:00.000Z' },
    ]);
    const m = buildSourceUrlMap(root);
    const r = collectManualReview(root, m);
    const row = r.rows.find((x) => x.sourceId === 'aik')!;
    expect(row.url).toBe('https://aik.se/canonical/');
    expect(row.urlResolution).toBe('ok');
  });

  it('marks urlResolution=no-url when no source URL can be resolved', () => {
    writeManualReviewQueue(root, [
      { sourceId: 'orphan-test-source', queuedAt: '2026-09-09T10:00:00.000Z' },
    ]);
    const m = buildSourceUrlMap(root);
    const r = collectManualReview(root, m);
    const row = r.rows.find((x) => x.sourceId === 'orphan-test-source')!;
    expect(row.url).toBe('');
    expect(row.urlResolution).toBe('no-url');
  });

  it('propagates winningStage, workerNotes, and roundNumber', () => {
    writeManualReviewQueue(root, [
      {
        sourceId: 'aik',
        queuedAt: '2026-09-09T10:00:00.000Z',
        stage: 'C3',
        notes: 'C3: no-jsonld',
        round: 4,
      },
    ]);
    writeRegistrySource(root, 'aik', 'https://aik.se/');
    const m = buildSourceUrlMap(root);
    const r = collectManualReview(root, m);
    const row = r.rows[0];
    expect(row.winningStage).toBe('C3');
    expect(row.workerNotes).toBe('C3: no-jsonld');
    expect(row.roundNumber).toBe(4);
  });

  it('caps rows at 500 to keep payload bounded', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      sourceId: `src-${String(i).padStart(4, '0')}`,
      queuedAt: new Date(Date.now() - i * 1000).toISOString(),
    }));
    writeManualReviewQueue(root, many);
    const m = buildSourceUrlMap(root);
    const r = collectManualReview(root, m);
    expect(r.count).toBe(500);
    expect(r.totalRows).toBe(600);
    expect(r.rows.length).toBe(500);
  });
});
