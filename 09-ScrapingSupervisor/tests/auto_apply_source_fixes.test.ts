/**
 * Unit tests for `auto_apply_source_fixes.ts`.
 *
 * Coverage:
 *   - Safety gate: only archive-dead + update-preferred-path are auto-applied
 *   - Confidence: only 'high' auto-applies (medium/low → skipped)
 *   - needsHumanReview flag: true → skipped
 *   - archive-dead: moves sources/{id}.jsonl → sources/_archive/dead-{date}/
 *   - update-preferred-path: edits the first JSONL record only
 *   - dryRun: no file moves, returns archiveDir
 *   - missing source file: skipped with reason 'source file not found'
 *   - archive idempotency: re-archiving same source is a no-op
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  autoApplySourceFixes,
  previewAutoApplySourceFixes,
} from '../tools/auto_apply_source_fixes';
import type { SourceProposal } from '../tools/source_ai_review';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'auto-apply-test-'));
  mkdirSync(resolve(tmpRoot, 'sources'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeProposal(overrides: Partial<SourceProposal>): SourceProposal {
  return {
    sourceId: 'foo',
    action: 'archive-dead',
    before: {},
    after: {},
    confidence: 'high',
    rationale: 'r',
    evidence: 'e',
    needsHumanReview: false,
    ...overrides,
  };
}

function writeSourceFile(id: string, line: string): string {
  const p = resolve(tmpRoot, `sources/${id}.jsonl`);
  writeFileSync(p, line + '\n', 'utf-8');
  return p;
}

describe('safety gate', () => {
  it('does NOT auto-apply url-normalize', () => {
    writeSourceFile('foo', '{"id":"foo"}');
    const r = autoApplySourceFixes(
      [makeProposal({ action: 'url-normalize', sourceId: 'foo' })],
      { projectRoot: tmpRoot },
    );
    expect(r.applied).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/not auto-applyable/);
  });

  it('does NOT auto-apply mark-review-needed', () => {
    writeSourceFile('foo', '{"id":"foo"}');
    const r = autoApplySourceFixes(
      [makeProposal({ action: 'mark-review-needed', sourceId: 'foo' })],
      { projectRoot: tmpRoot },
    );
    expect(r.applied).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/not auto-applyable/);
  });

  it('does NOT auto-apply when confidence is medium', () => {
    writeSourceFile('foo', '{"id":"foo"}');
    const r = autoApplySourceFixes(
      [makeProposal({ action: 'archive-dead', confidence: 'medium' })],
      { projectRoot: tmpRoot },
    );
    expect(r.applied).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/< high/);
  });

  it('does NOT auto-apply when needsHumanReview=true', () => {
    writeSourceFile('foo', '{"id":"foo"}');
    const r = autoApplySourceFixes(
      [makeProposal({ action: 'archive-dead', needsHumanReview: true })],
      { projectRoot: tmpRoot },
    );
    expect(r.applied).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/needsHumanReview/);
  });
});

describe('archive-dead', () => {
  it('moves source file to _archive/dead-{date}/', () => {
    writeSourceFile('foo', '{"id":"foo","city":"Stockholm"}');
    const r = autoApplySourceFixes(
      [makeProposal({ sourceId: 'foo', action: 'archive-dead' })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' },
    );
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].archiveDir).toContain('dead-2026-08-19');
    expect(r.applied[0].fileEdited).toBe(true);

    expect(existsSync(resolve(tmpRoot, 'sources/foo.jsonl'))).toBe(false);
    expect(existsSync(resolve(tmpRoot, 'sources/_archive/dead-2026-08-19/foo.jsonl'))).toBe(true);
  });

  it('skips when source file does not exist', () => {
    const r = autoApplySourceFixes(
      [makeProposal({ sourceId: 'nonexistent', action: 'archive-dead' })],
      { projectRoot: tmpRoot },
    );
    expect(r.applied).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/source file not found/);
  });

  it('is idempotent — re-archiving is a no-op', () => {
    writeSourceFile('foo', '{"id":"foo"}');
    autoApplySourceFixes(
      [makeProposal({ sourceId: 'foo', action: 'archive-dead' })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' },
    );
    const r = autoApplySourceFixes(
      [makeProposal({ sourceId: 'foo', action: 'archive-dead' })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' },
    );
    expect(r.applied).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/source file not found/);
  });
});

describe('update-preferred-path', () => {
  it('edits the first JSONL record and preserves subsequent lines', () => {
    const path = writeSourceFile('foo', '{"id":"foo","preferredPath":"/old"}');
    writeFileSync(path, '{"id":"foo","preferredPath":"/old"}\n{"id":"foo","logs":[{"date":"2026-08-18"}]}\n', 'utf-8');

    const r = autoApplySourceFixes(
      [
        makeProposal({
          sourceId: 'foo',
          action: 'update-preferred-path',
          before: { preferredPath: '/old' },
          after: { preferredPath: '/new' },
        }),
      ],
      { projectRoot: tmpRoot },
    );
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].fileEdited).toBe(true);

    const text = readFileSync(path, 'utf-8');
    const lines = text.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.preferredPath).toBe('/new');
    expect(first.id).toBe('foo');
    expect(lines[1]).toContain('2026-08-18');
  });

  it('skips when proposed path is empty', () => {
    writeSourceFile('foo', '{"id":"foo"}');
    const r = autoApplySourceFixes(
      [
        makeProposal({
          sourceId: 'foo',
          action: 'update-preferred-path',
          after: { preferredPath: '' },
        }),
      ],
      { projectRoot: tmpRoot },
    );
    expect(r.applied).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/no proposed preferredPath/);
  });

  it('skips when first line id does not match sourceId', () => {
    writeSourceFile('foo', '{"id":"bar"}');
    const r = autoApplySourceFixes(
      [
        makeProposal({
          sourceId: 'foo',
          action: 'update-preferred-path',
          after: { preferredPath: '/x' },
        }),
      ],
      { projectRoot: tmpRoot },
    );
    expect(r.applied).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/edit failed/);
  });
});

describe('dryRun', () => {
  it('previewAutoApplySourceFixes reports applied without file moves', () => {
    const path = writeSourceFile('foo', '{"id":"foo","preferredPath":"/old"}');
    const r = previewAutoApplySourceFixes(
      [
        makeProposal({
          sourceId: 'foo',
          action: 'update-preferred-path',
          after: { preferredPath: '/new' },
        }),
      ],
      { projectRoot: tmpRoot },
    );
    expect(r.dryRun).toBe(true);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].fileEdited).toBe(false);
    const text = readFileSync(path, 'utf-8');
    expect(JSON.parse(text.split('\n')[0]).preferredPath).toBe('/old');
  });

  it('dryRun=true on archive-dead reports applied but does not move file', () => {
    const path = writeSourceFile('foo', '{"id":"foo"}');
    const r = autoApplySourceFixes(
      [makeProposal({ sourceId: 'foo', action: 'archive-dead' })],
      { projectRoot: tmpRoot, dryRun: true },
    );
    expect(r.dryRun).toBe(true);
    expect(r.applied).toHaveLength(1);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(resolve(tmpRoot, 'sources/_archive'))).toBe(false);
  });
});
