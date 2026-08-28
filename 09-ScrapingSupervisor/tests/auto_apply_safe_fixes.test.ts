/**
 * Tests for auto_apply_safe_fixes — bounded deterministic archiver.
 *
 * Real tmpdirs (no fs mocking) because the function's behavior is fundamentally
 * about moving files between directories. We use mkdtempSync/rmSync to isolate
 * from production and from each test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autoApplySafeFixes,
  previewAutoApplySafeFixes,
  classifyForAutoArchive,
  summarizeApplyResult,
} from '../tools/auto_apply_safe_fixes';
import type { SourceHealth } from '../tools/collect_state';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function health(over: Partial<SourceHealth> & { sourceId: string }): SourceHealth {
  return {
    sourceId: over.sourceId,
    status: over.status ?? 'fail',
    consecutiveFailures: over.consecutiveFailures ?? 0,
    lastRoutingReason: over.lastRoutingReason ?? null,
    lastPathUsed: over.lastPathUsed ?? null,
    outcomeType: over.outcomeType ?? null,
    preferredPath: over.preferredPath ?? null,
    city: over.city ?? 'Stockholm',
  };
}

// ─── Temp dir lifecycle ──────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'sup-fix-test-'));
  mkdirSync(resolve(tmpRoot, 'sources'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'runtime'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeSource(id: string, body: string = '{"test":true}\n'): void {
  writeFileSync(resolve(tmpRoot, 'sources', `${id}.jsonl`), body, 'utf-8');
}

function readLog(): Array<Record<string, unknown>> {
  const logPath = resolve(tmpRoot, 'runtime/scraping-supervisor/applied-fixes.log');
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ─── classifyForAutoArchive (pure) ───────────────────────────────────────────

describe('classifyForAutoArchive (pure whitelist)', () => {
  it('ENOTFOUND always matches (no failure threshold check)', () => {
    expect(classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'getaddrinfo ENOTFOUND', consecutiveFailures: 1 }))).toBe('enotfound');
    expect(classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 999 }))).toBe('enotfound');
  });

  it('http 404 with cf >= 10 → persistent-404', () => {
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'http 404', consecutiveFailures: 10 }))
    ).toBe('persistent-404');
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'http 404 not found', consecutiveFailures: 50 }))
    ).toBe('persistent-404');
  });

  it('http 404 with cf < 10 → null (still under threshold)', () => {
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'http 404', consecutiveFailures: 9 }))
    ).toBeNull();
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'http 404', consecutiveFailures: 0 }))
    ).toBeNull();
  });

  it('"not found" alone (lowercase, no "http 404") with cf >= 10 → persistent-404', () => {
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'page not found', consecutiveFailures: 10 }))
    ).toBe('persistent-404');
  });

  it('null lastRoutingReason → null', () => {
    expect(classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: null, consecutiveFailures: 100 }))).toBeNull();
  });

  it('redirect loop / serverdown / 500 → null (NOT in whitelist)', () => {
    expect(classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'REDIRECT_LOOP', consecutiveFailures: 50 }))).toBeNull();
    expect(classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'serverdown', consecutiveFailures: 50 }))).toBeNull();
    expect(classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'error500', consecutiveFailures: 50 }))).toBeNull();
  });

  it('honors custom minFailuresFor404 parameter', () => {
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'http 404', consecutiveFailures: 5 }), 3)
    ).toBe('persistent-404'); // 5 >= 3
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'http 404', consecutiveFailures: 5 }), 10)
    ).toBeNull(); // 5 < 10
  });

  it('case-insensitive matching', () => {
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'HTTP 404', consecutiveFailures: 10 }))
    ).toBe('persistent-404');
    expect(
      classifyForAutoArchive(health({ sourceId: 'a', lastRoutingReason: 'GetAddrInfo ENOTFOUND', consecutiveFailures: 1 }))
    ).toBe('enotfound');
  });
});

// ─── autoApplySafeFixes — file moving ────────────────────────────────────────

describe('autoApplySafeFixes — file moving', () => {
  it('moves ENOTFOUND source to archive/dead-{date}/', () => {
    writeSource('dns-1');
    const result = autoApplySafeFixes(
      [health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' }
    );

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].sourceId).toBe('dns-1');
    expect(result.applied[0].reason).toBe('enotfound');
    expect(result.applied[0].movedTo).toContain('dns-1.jsonl');
    expect(result.applied[0].appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.archiveDir).toContain('dead-2026-08-19');
    expect(result.dryRun).toBe(false);

    // File actually moved
    expect(existsSync(resolve(tmpRoot, 'sources/dns-1.jsonl'))).toBe(false);
    expect(existsSync(resolve(tmpRoot, 'sources/_archive/dead-2026-08-19/dns-1.jsonl'))).toBe(true);
  });

  it('moves persistent-404 source (cf >= 10)', () => {
    writeSource('four-oh-four');
    const result = autoApplySafeFixes(
      [health({ sourceId: 'four-oh-four', lastRoutingReason: 'http 404', consecutiveFailures: 12 })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' }
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].reason).toBe('persistent-404');
  });

  it('skips persistent-404 below threshold (cf < 10)', () => {
    writeSource('four-oh-four');
    const result = autoApplySafeFixes(
      [health({ sourceId: 'four-oh-four', lastRoutingReason: 'http 404', consecutiveFailures: 5 })],
      { projectRoot: tmpRoot }
    );
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('not-in-whitelist');
    expect(existsSync(resolve(tmpRoot, 'sources/four-oh-four.jsonl'))).toBe(true);
  });

  it('skips sources outside the whitelist', () => {
    writeSource('redirect-source');
    const result = autoApplySafeFixes(
      [health({ sourceId: 'redirect-source', lastRoutingReason: 'REDIRECT_LOOP', consecutiveFailures: 50 })],
      { projectRoot: tmpRoot }
    );
    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('not-in-whitelist');
    expect(existsSync(resolve(tmpRoot, 'sources/redirect-source.jsonl'))).toBe(true);
  });

  it('skips already-archived source', () => {
    writeSource('a');
    // Pre-create an archive dir with the source already there
    mkdirSync(resolve(tmpRoot, 'sources/_archive/dead-2026-08-19'), { recursive: true });
    writeFileSync(resolve(tmpRoot, 'sources/_archive/dead-2026-08-19/a.jsonl'), '{"old":true}\n', 'utf-8');

    const result = autoApplySafeFixes(
      [health({ sourceId: 'a', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' }
    );

    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('already-archived');
    // The archive file is untouched
    expect(readFileSync(resolve(tmpRoot, 'sources/_archive/dead-2026-08-19/a.jsonl'), 'utf-8')).toBe('{"old":true}\n');
  });

  it('skips when source file is missing on disk', () => {
    // No writeSource('b') — file does not exist
    const result = autoApplySafeFixes(
      [health({ sourceId: 'b', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      { projectRoot: tmpRoot }
    );
    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0].reason).toBe('file-missing');
  });

  it('appends one JSON line per applied fix to applied-fixes.log', () => {
    writeSource('dns-1');
    writeSource('dns-2');
    autoApplySafeFixes(
      [
        health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 }),
        health({ sourceId: 'dns-2', lastRoutingReason: 'http 404', consecutiveFailures: 12 }),
      ],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' }
    );

    const entries = readLog();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.sourceId).sort()).toEqual(['dns-1', 'dns-2']);
    expect(entries.map((e) => e.reason).sort()).toEqual(['enotfound', 'persistent-404']);
    expect(entries[0].appliedAt).toBeDefined();
  });

  it('mixed batch: applies whitelist matches, skips others', () => {
    writeSource('dns-1');        // enotfound → apply
    writeSource('four-oh-four'); // persistent-404 → apply
    writeSource('young-404');    // 404 cf=5 → skip (not-in-whitelist)
    writeSource('redirect');     // REDIRECT_LOOP → skip (not-in-whitelist)
    // ghost: not on disk → skip (file-missing)

    const result = autoApplySafeFixes(
      [
        health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 }),
        health({ sourceId: 'four-oh-four', lastRoutingReason: 'http 404', consecutiveFailures: 12 }),
        health({ sourceId: 'young-404', lastRoutingReason: 'http 404', consecutiveFailures: 5 }),
        health({ sourceId: 'redirect', lastRoutingReason: 'REDIRECT_LOOP', consecutiveFailures: 50 }),
        health({ sourceId: 'ghost', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 }),
      ],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' }
    );

    expect(result.applied.map((a) => a.sourceId).sort()).toEqual(['dns-1', 'four-oh-four']);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual([
      'file-missing',
      'not-in-whitelist',
      'not-in-whitelist',
    ]);

    // Disk state matches expectations
    expect(existsSync(resolve(tmpRoot, 'sources/_archive/dead-2026-08-19/dns-1.jsonl'))).toBe(true);
    expect(existsSync(resolve(tmpRoot, 'sources/_archive/dead-2026-08-19/four-oh-four.jsonl'))).toBe(true);
    expect(existsSync(resolve(tmpRoot, 'sources/young-404.jsonl'))).toBe(true);
    expect(existsSync(resolve(tmpRoot, 'sources/redirect.jsonl'))).toBe(true);
  });

  it('idempotency: re-running with same date produces no new moves', () => {
    writeSource('dns-1');
    const opts = { projectRoot: tmpRoot, archiveDate: '2026-08-19' };
    const first = autoApplySafeFixes(
      [health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      opts
    );
    expect(first.applied).toHaveLength(1);

    const second = autoApplySafeFixes(
      [health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      opts
    );
    expect(second.applied).toHaveLength(0);
    expect(second.skipped[0].reason).toBe('already-archived');
  });

  it('uses custom archiveDirName when provided', () => {
    writeSource('dns-1');
    autoApplySafeFixes(
      [health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      { projectRoot: tmpRoot, archiveDirName: 'dead-custom-bucket' }
    );
    expect(existsSync(resolve(tmpRoot, 'sources/_archive/dead-custom-bucket/dns-1.jsonl'))).toBe(true);
  });

  it('creates nested _archive directory if it does not exist', () => {
    writeSource('dns-1');
    expect(existsSync(resolve(tmpRoot, 'sources/_archive'))).toBe(false);
    autoApplySafeFixes(
      [health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' }
    );
    expect(readdirSync(resolve(tmpRoot, 'sources/_archive'))).toContain('dead-2026-08-19');
  });
});

// ─── previewAutoApplySafeFixes (dry-run) ──────────────────────────────────────

describe('previewAutoApplySafeFixes (dry-run)', () => {
  it('returns the same shape with dryRun=true', () => {
    writeSource('dns-1');
    const result = previewAutoApplySafeFixes(
      [health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' }
    );

    expect(result.dryRun).toBe(true);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].sourceId).toBe('dns-1');
    expect(result.applied[0].reason).toBe('enotfound');
    expect(result.applied[0].movedTo).toContain('dead-2026-08-19');
  });

  it('does NOT move files or write log', () => {
    writeSource('dns-1');
    previewAutoApplySafeFixes(
      [health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 })],
      { projectRoot: tmpRoot, archiveDate: '2026-08-19' }
    );

    // File still in place
    expect(existsSync(resolve(tmpRoot, 'sources/dns-1.jsonl'))).toBe(true);
    // Archive dir never created
    expect(existsSync(resolve(tmpRoot, 'sources/_archive'))).toBe(false);
    // Log never written
    expect(existsSync(resolve(tmpRoot, 'runtime/scraping-supervisor/applied-fixes.log'))).toBe(false);
  });
});

// ─── summarizeApplyResult ────────────────────────────────────────────────────

describe('summarizeApplyResult', () => {
  it('counts applied + skipped + byReason', () => {
    const result = autoApplySafeFixes(
      [
        health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 }),
        health({ sourceId: 'dns-2', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 5 }),
        health({ sourceId: 'four-oh-four', lastRoutingReason: 'http 404', consecutiveFailures: 12 }),
        health({ sourceId: 'redirect', lastRoutingReason: 'REDIRECT_LOOP', consecutiveFailures: 50 }),
      ].map((s) => {
        if (s.sourceId === 'dns-1' || s.sourceId === 'dns-2' || s.sourceId === 'four-oh-four') {
          // make files exist for first three
          writeSource(s.sourceId);
        }
        return s;
      }),
      { projectRoot: tmpRoot }
    );

    const summary = summarizeApplyResult(result);
    expect(summary.appliedCount).toBe(3);
    expect(summary.skippedCount).toBe(1);
    expect(summary.byReason).toEqual({ enotfound: 2, 'persistent-404': 1 });
  });

  it('handles zero applied', () => {
    const result = {
      applied: [],
      skipped: [],
      archiveDir: '/tmp/x',
      dryRun: true,
    };
    expect(summarizeApplyResult(result)).toEqual({
      appliedCount: 0,
      skippedCount: 0,
      byReason: { enotfound: 0, 'persistent-404': 0 },
    });
  });
});