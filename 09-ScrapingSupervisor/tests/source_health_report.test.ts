/**
 * Unit tests for `source_health_report.ts`.
 *
 * Coverage:
 *   - generateSourceHealthReport:
 *       - Empty log → "0 proposals emitted"
 *       - Today's activity block: count auto-applied vs pending-review
 *       - Pending review table only renders when entries exist
 *       - Outcome tracking table joins changes with sources_status.jsonl
 *       - All numbers come from real reads — no invented counts
 *   - appendOrReplaceSourceReviewSection:
 *       - Appends to a vault note that doesn't have the section yet
 *       - Replaces existing section in place (idempotent at marker level)
 *       - Does not throw when the vault note doesn't exist
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  generateSourceHealthReport,
  appendOrReplaceSourceReviewSection,
} from '../tools/source_health_report';
import { appendChange, makeChange } from '../tools/source_changes';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'health-report-test-'));
  mkdirSync(resolve(tmpRoot, 'runtime'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const FIXED_DATES = {
  d1: new Date('2026-08-19T08:00:00.000Z'),
  d2: new Date('2026-08-18T08:00:00.000Z'),
};

function writeStatusRows(rows: Array<Record<string, unknown>>): void {
  writeFileSync(
    resolve(tmpRoot, 'runtime/sources_status.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf-8',
  );
}

describe('generateSourceHealthReport', () => {
  it('renders header + zeros when log is empty', () => {
    writeStatusRows([]);
    const r = generateSourceHealthReport({ projectRoot: tmpRoot, date: '2026-08-19' });
    expect(r.markdown).toMatch(/^## Source Review \(AI\)/);
    expect(r.markdown).toContain('0** proposals emitted');
    expect(r.markdown).toContain('0** auto-applied');
    expect(r.markdown).toContain('0** queued for human review');
    expect(r.appliedCount).toBe(0);
    expect(r.pendingCount).toBe(0);
  });

  it('counts auto-applied vs pending-review correctly', () => {
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
          sourceId: 'bar',
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'medium',
          appliedBy: 'ai-reviewer',
          reviewStatus: 'pending-review',
        },
        FIXED_DATES.d1,
      ),
    );
    writeStatusRows([]);

    const r = generateSourceHealthReport({ projectRoot: tmpRoot, date: '2026-08-19' });
    expect(r.appliedCount).toBe(1);
    expect(r.pendingCount).toBe(1);
    expect(r.markdown).toContain('2** proposals emitted');
    expect(r.markdown).toContain('1** auto-applied');
    expect(r.markdown).toContain('1** queued for human review');
    expect(r.markdown).toContain('archive-dead=1');
    expect(r.markdown).toContain('mark-review-needed=1');
    expect(r.markdown).toContain('high=1');
    expect(r.markdown).toContain('medium=1');
  });

  it('renders pending review table when there are pending entries', () => {
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'review-1',
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale: 'Needs human URL review',
          evidence: 'e',
          confidence: 'medium',
          appliedBy: 'ai-reviewer',
          reviewStatus: 'pending-review',
        },
        FIXED_DATES.d1,
      ),
    );
    writeStatusRows([]);
    const r = generateSourceHealthReport({ projectRoot: tmpRoot, date: '2026-08-19' });
    expect(r.markdown).toContain('### Pending human review');
    expect(r.markdown).toContain('review-1');
    expect(r.markdown).toContain('Needs human URL review');
  });

  it('joins recent changes with sources_status.jsonl for outcome tracking', () => {
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'dns-1',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d2,
      ),
    );
    writeStatusRows([
      {
        sourceId: 'dns-1',
        status: 'fail',
        consecutiveFailures: 15,
        lastEventsFound: 0,
      },
    ]);

    const r = generateSourceHealthReport({ projectRoot: tmpRoot, date: '2026-08-19' });
    expect(r.markdown).toContain('### Outcome tracking');
    expect(r.markdown).toContain('dns-1');
    expect(r.markdown).toContain('cf_after');
    expect(r.markdown).toContain('15');
  });

  it('falls back to "archived" status for archive-dead when status row missing', () => {
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'no-row',
          action: 'archive-dead',
          before: {},
          after: {},
          rationale: 'r',
          evidence: 'e',
          confidence: 'high',
          appliedBy: 'auto-rule',
          reviewStatus: 'auto-applied',
        },
        FIXED_DATES.d2,
      ),
    );
    writeStatusRows([]);
    const r = generateSourceHealthReport({ projectRoot: tmpRoot, date: '2026-08-19' });
    expect(r.markdown).toContain('archived');
  });

  it('escapes pipe characters in sourceId/rationale cells', () => {
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'with|pipe',
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale: 'r|with|pipe',
          evidence: 'e',
          confidence: 'medium',
          appliedBy: 'ai-reviewer',
          reviewStatus: 'pending-review',
        },
        FIXED_DATES.d1,
      ),
    );
    writeStatusRows([]);
    const r = generateSourceHealthReport({ projectRoot: tmpRoot, date: '2026-08-19' });
    expect(r.markdown).toContain('with\\|pipe');
    expect(r.markdown).toContain('r\\|with\\|pipe');
  });

  it('truncates long rationale to 80 chars', () => {
    const longRationale = 'x'.repeat(200);
    appendChange(
      tmpRoot,
      makeChange(
        {
          sourceId: 'long',
          action: 'mark-review-needed',
          before: {},
          after: {},
          rationale: longRationale,
          evidence: 'e',
          confidence: 'medium',
          appliedBy: 'ai-reviewer',
          reviewStatus: 'pending-review',
        },
        FIXED_DATES.d1,
      ),
    );
    writeStatusRows([]);
    const r = generateSourceHealthReport({ projectRoot: tmpRoot, date: '2026-08-19' });
    expect(r.markdown).toContain('…');
    expect(r.markdown).not.toContain(longRationale);
  });

  it('reports source failure count from sources_status.jsonl', () => {
    writeStatusRows([
      { sourceId: 'a', status: 'fail', consecutiveFailures: 12, lastEventsFound: 0 },
      { sourceId: 'b', status: 'fail', consecutiveFailures: 5, lastEventsFound: 0 },
      { sourceId: 'c', status: 'ok', consecutiveFailures: 0, lastEventsFound: 3 },
    ]);
    const r = generateSourceHealthReport({ projectRoot: tmpRoot, date: '2026-08-19' });
    expect(r.markdown).toContain('### Pattern signal');
    expect(r.markdown).toContain('2 sources currently in `status: fail`');
  });
});

describe('appendOrReplaceSourceReviewSection', () => {
  it('appends section to a vault note that does not have it yet', () => {
    const vaultNote = resolve(tmpRoot, 'note.md');
    writeFileSync(vaultNote, '# Daily note\n\n## Summary\nSome content.\n', 'utf-8');

    const md = '## Source Review (AI)\n\nNew content.\n';
    appendOrReplaceSourceReviewSection(vaultNote, md);

    const text = readFileSync(vaultNote, 'utf-8');
    expect(text).toContain('# Daily note');
    expect(text).toContain('## Summary');
    expect(text).toContain('## Source Review (AI)');
    expect(text).toContain('New content.');
  });

  it('replaces existing section (idempotent when section is at end)', () => {
    const vaultNote = resolve(tmpRoot, 'note.md');
    writeFileSync(
      vaultNote,
      '# Daily note\n\n## Summary\nSome content.\n\n## Source Review (AI)\n\nOld content.\n',
      'utf-8',
    );

    const newMd = '## Source Review (AI)\n\nNew content.\n';
    appendOrReplaceSourceReviewSection(vaultNote, newMd);

    const text = readFileSync(vaultNote, 'utf-8');
    expect(text).toContain('# Daily note');
    expect(text).toContain('## Summary');
    expect(text).toContain('## Source Review (AI)');
    expect(text).toContain('New content.');
    expect(text).not.toContain('Old content.');
  });

  it('second-call replaces the section from the first call', () => {
    const vaultNote = resolve(tmpRoot, 'note.md');
    writeFileSync(vaultNote, '# Daily note\n\nSome content.\n', 'utf-8');

    const firstMd = '## Source Review (AI)\n\nFirst call.\n';
    const secondMd = '## Source Review (AI)\n\nSecond call.\n';
    appendOrReplaceSourceReviewSection(vaultNote, firstMd);
    appendOrReplaceSourceReviewSection(vaultNote, secondMd);

    const text = readFileSync(vaultNote, 'utf-8');
    expect(text).toContain('Second call.');
    expect(text).not.toContain('First call.');
  });

  it('does NOT throw when the vault note does not exist', () => {
    const vaultNote = resolve(tmpRoot, 'nonexistent.md');
    expect(() =>
      appendOrReplaceSourceReviewSection(vaultNote, '## Source Review (AI)\n\nContent.\n'),
    ).not.toThrow();
    expect(existsSync(vaultNote)).toBe(false);
  });
});
