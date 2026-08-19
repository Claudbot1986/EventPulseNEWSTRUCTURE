/**
 * Unit tests for `source_changes.ts` — append-only audit log.
 *
 * Coverage:
 *   - appendChange writes one line per change
 *   - appendChange is idempotent on (date, sourceId, action)
 *   - readChanges filters by sourceId / reviewStatus / since / until / limit
 *   - statsFor produces correct counts per dimension
 *   - recordOutcome patches the latest matching change
 *   - errors-as-data: missing file → empty reads, no throws
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  appendChange,
  readChanges,
  recordOutcome,
  makeChange,
  statsFor,
} from '../tools/source_changes';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'src-changes-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const FIXED_DATES = {
  d1: new Date('2026-08-17T08:00:00.000Z'),
  d2: new Date('2026-08-18T08:00:00.000Z'),
  d3: new Date('2026-08-19T08:00:00.000Z'),
};

describe('appendChange', () => {
  it('writes one line per change to the audit log', () => {
    const c = makeChange(
      {
        sourceId: 'foo',
        action: 'archive-dead',
        before: { url: 'https://foo.example' },
        after: {},
        rationale: 'r',
        evidence: 'e',
        confidence: 'high',
        appliedBy: 'auto-rule',
        reviewStatus: 'auto-applied',
      },
      FIXED_DATES.d1,
    );
    appendChange(tmpRoot, c);

    const all = readChanges(tmpRoot);
    expect(all).toHaveLength(1);
    expect(all[0].sourceId).toBe('foo');
    expect(all[0].action).toBe('archive-dead');
    expect(all[0].timestamp).toBe('2026-08-17T08:00:00.000Z');
    expect(all[0].date).toBe('2026-08-17');
  });

  it('is idempotent on (date, sourceId, action) — overwrites prior entry', () => {
    const c1 = makeChange(
      {
        sourceId: 'foo',
        action: 'archive-dead',
        before: { url: 'a' },
        after: {},
        rationale: 'first',
        evidence: 'e1',
        confidence: 'high',
        appliedBy: 'auto-rule',
        reviewStatus: 'auto-applied',
      },
      FIXED_DATES.d1,
    );
    const c2 = makeChange(
      {
        sourceId: 'foo',
        action: 'archive-dead',
        before: { url: 'a' },
        after: {},
        rationale: 'second',
        evidence: 'e2',
        confidence: 'high',
        appliedBy: 'auto-rule',
        reviewStatus: 'auto-applied',
      },
      FIXED_DATES.d1,
    );
    appendChange(tmpRoot, c1);
    appendChange(tmpRoot, c2);

    const all = readChanges(tmpRoot);
    expect(all).toHaveLength(1);
    expect(all[0].rationale).toBe('second');
  });

  it('keeps distinct entries for different (date, sourceId, action) triples', () => {
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'foo',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: 'r1',
          evidence: 'e1',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d1,
      ),
    );
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'foo',
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale: 'r2',
          evidence: 'e2',
          confidence: 'medium',
          appliedBy: 'ai-reviewer',
          reviewStatus: 'pending-review',
        },
        FIXED_DATES.d1,
      ),
    );
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'bar',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: 'r3',
          evidence: 'e3',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d2,
      ),
    );

    const all = readChanges(tmpRoot);
    expect(all).toHaveLength(3);
  });
});

describe('readChanges', () => {
  beforeEach(() => {
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'foo',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d1,
      ),
    );
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'foo',
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'medium',
          appliedBy: 'ai-reviewer',
          reviewStatus: 'pending-review',
        },
        FIXED_DATES.d2,
      ),
    );
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'bar',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d3,
      ),
    );
  });

  it('returns all changes sorted by timestamp', () => {
    const all = readChanges(tmpRoot);
    expect(all).toHaveLength(3);
    expect(all.map((c) => c.sourceId)).toEqual(['foo', 'foo', 'bar']);
  });

  it('filters by sourceId', () => {
    const foo = readChanges(tmpRoot, { sourceId: 'foo' });
    expect(foo).toHaveLength(2);
    expect(foo.every((c) => c.sourceId === 'foo')).toBe(true);
  });

  it('filters by reviewStatus', () => {
    const pending = readChanges(tmpRoot, { reviewStatus: 'pending-review' });
    expect(pending).toHaveLength(1);
    expect(pending[0].sourceId).toBe('foo');
    expect(pending[0].action).toBe('mark-review-needed');
  });

  it('filters by since/until', () => {
    const range = readChanges(tmpRoot, { since: '2026-08-18', until: '2026-08-18' });
    expect(range).toHaveLength(1);
    expect(range[0].sourceId).toBe('foo');
    expect(range[0].action).toBe('mark-review-needed');
  });

  it('applies limit to the filtered result', () => {
    const limited = readChanges(tmpRoot, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.map((c) => c.sourceId)).toEqual(['foo', 'bar']);
  });

  it('returns empty array when log file does not exist', () => {
    const empty = readChanges('/tmp/this-path-should-not-exist-' + Date.now());
    expect(empty).toEqual([]);
  });
});

describe('recordOutcome', () => {
  it('patches the latest matching change for a sourceId', () => {
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'foo',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d1,
      ),
    );
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'foo',
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'medium',
          appliedBy: 'ai-reviewer',
          reviewStatus: 'pending-review',
        },
        FIXED_DATES.d2,
      ),
    );

    const ok = recordOutcome(tmpRoot, 'foo', {
      cfAfter: 0,
      eventsFoundAfter: 0,
      statusAfter: 'archived',
      measuredAt: '2026-08-19T12:00:00.000Z',
    });
    expect(ok).toBe(true);

    const all = readChanges(tmpRoot);
    const patched = all.find((c) => c.outcome)?.outcome;
    expect(patched).toBeDefined();
    expect(patched?.cfAfter).toBe(0);
    expect(patched?.statusAfter).toBe('archived');
  });

  it('returns false when no matching change exists', () => {
    const ok = recordOutcome(tmpRoot, 'nonexistent', { cfAfter: 0 });
    expect(ok).toBe(false);
  });

  it('does not overwrite an already-recorded outcome', () => {
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'foo',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d1,
      ),
    );

    recordOutcome(tmpRoot, 'foo', { cfAfter: 5, statusAfter: 'first' });
    recordOutcome(tmpRoot, 'foo', { cfAfter: 10, statusAfter: 'second' });

    const all = readChanges(tmpRoot);
    const outcome = all.find((c) => c.outcome)?.outcome;
    expect(outcome?.cfAfter).toBe(5);
    expect(outcome?.statusAfter).toBe('first');
  });
});

describe('statsFor', () => {
  it('produces correct counts per action / status / confidence', () => {
    const changes = [
      makeChange(
        {
          sourceId: 'a',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: '',
          evidence: '',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d1,
      ),
      makeChange(
        {
          sourceId: 'b',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: '',
          evidence: '',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d2,
      ),
      makeChange(
        {
          sourceId: 'c',
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale: '',
          evidence: '',
          confidence: 'medium',
          appliedBy: 'ai-reviewer',
          reviewStatus: 'pending-review',
        },
        FIXED_DATES.d3,
      ),
    ];
    const s = statsFor(changes);
    expect(s.total).toBe(3);
    expect(s.byAction['archive-dead']).toBe(2);
    expect(s.byAction['mark-review-needed']).toBe(1);
    expect(s.byReviewStatus['auto-applied']).toBe(2);
    expect(s.byReviewStatus['pending-review']).toBe(1);
    expect(s.byConfidence['high']).toBe(2);
    expect(s.byConfidence['medium']).toBe(1);
    expect(s.pendingReviewCount).toBe(1);
  });
});

describe('makeChange', () => {
  it('auto-fills timestamp and date from now', () => {
    const now = new Date('2026-08-19T12:00:00.000Z');
    const c = makeChange(
      {
        sourceId: 'foo',
        action: 'archive-dead',
        before: {},
        after: {},
        rationale: '',
        evidence: '',
        confidence: 'high',
        appliedBy: 'auto-rule',
        reviewStatus: 'auto-applied',
      },
      now,
    );
    expect(c.timestamp).toBe('2026-08-19T12:00:00.000Z');
    expect(c.date).toBe('2026-08-19');
  });
});
