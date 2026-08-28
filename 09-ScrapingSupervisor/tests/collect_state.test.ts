/**
 * Tests for collect_state — pure read function for the scraping supervisor.
 *
 * Strategy: build a temp directory shaped like the project root
 * (sources/*.jsonl + runtime/*.jsonl + 02-Ingestion/C-htmlGate/reports/batch-NNN/batch-traces.jsonl)
 * and assert on the structured SupervisorState output.
 *
 * No writes are made outside the per-test tmpdir. No mocks of fs — we use
 * real tmpdirs because that exercises the actual read path.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';

import { collectState } from '../tools/collect_state';

// ─── Helpers ────────────────────────────────────────────────────────────────

interface Fixture {
  projectRoot: string;
  sources: { id: string; city: string; preferredPath?: string }[];
}

function makeProjectRoot(): Fixture {
  const projectRoot = mkdtempSync(join(tmpdir(), 'supervisor-fixture-'));
  // sources dir
  mkdirSync(resolve(projectRoot, 'sources'), { recursive: true });
  // runtime dir
  mkdirSync(resolve(projectRoot, 'runtime'), { recursive: true });
  // batch reports dir
  mkdirSync(
    resolve(projectRoot, '02-Ingestion', 'C-htmlGate', 'reports'),
    { recursive: true }
  );
  return { projectRoot, sources: [] };
}

function addSource(fix: Fixture, id: string, city: string, preferredPath?: string): void {
  const record: Record<string, unknown> = { id, city };
  if (preferredPath) record.preferredPath = preferredPath;
  writeFileSync(
    resolve(fix.projectRoot, 'sources', `${id}.jsonl`),
    JSON.stringify(record) + '\n'
  );
  fix.sources.push({ id, city, preferredPath });
}

function addArchiveDir(fix: Fixture): void {
  mkdirSync(resolve(fix.projectRoot, 'sources', '_archive'), { recursive: true });
  // an underscore-prefixed file that loadSourceTruth should skip
  writeFileSync(
    resolve(fix.projectRoot, 'sources', '_archive_marker.jsonl'),
    JSON.stringify({ id: 'should-be-skipped', city: 'Stockholm' }) + '\n'
  );
}

function appendStatus(fix: Fixture, sourceId: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ sourceId, ...fields });
  writeFileSync(
    resolve(fix.projectRoot, 'runtime', 'sources_status.jsonl'),
    line + '\n',
    { flag: 'a' }
  );
}

function appendPriority(fix: Fixture, sourceId: string, priority: number, reason: string): void {
  const line = JSON.stringify({ sourceId, priority, reason });
  writeFileSync(
    resolve(fix.projectRoot, 'runtime', 'sources_priority_queue.jsonl'),
    line + '\n',
    { flag: 'a' }
  );
}

function makeBatchDir(fix: Fixture, num: number): string {
  const name = `batch-${String(num).padStart(3, '0')}`;
  const dir = resolve(fix.projectRoot, '02-Ingestion', 'C-htmlGate', 'reports', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function appendTrace(fix: Fixture, num: number, trace: Record<string, unknown>): void {
  const dir = makeBatchDir(fix, num);
  const line = JSON.stringify(trace);
  writeFileSync(resolve(dir, 'batch-traces.jsonl'), line + '\n', { flag: 'a' });
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let fix: Fixture;

beforeEach(() => {
  fix = makeProjectRoot();
});

afterEach(() => {
  rmSync(fix.projectRoot, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('collectState — empty project', () => {
  it('returns zeroed totals when no sources exist', () => {
    const state = collectState({ projectRoot: fix.projectRoot });

    expect(state.totals.sources).toBe(0);
    expect(state.totals.stockholm).toBe(0);
    expect(state.deadSources).toEqual([]);
    expect(state.workingSources).toEqual([]);
    expect(state.untouchedSources).toEqual([]);
    expect(state.batchStats).toEqual([]);
    expect(state.schemaDriftSignals).toEqual([]);
    expect(state.priorityQueueHead).toEqual([]);
    expect(state.failureModes).toEqual({});
  });

  it('returns a valid ISO timestamp', () => {
    const state = collectState({ projectRoot: fix.projectRoot });
    expect(() => new Date(state.timestamp).toISOString()).not.toThrow();
    expect(state.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('collectState — Stockholm filter', () => {
  it('counts only sources whose city === "Stockholm"', () => {
    addSource(fix, 'sthlm-working', 'Stockholm');
    addSource(fix, 'sthlm-dead', 'Stockholm');
    addSource(fix, 'gothenburg-1', 'Göteborg');
    addSource(fix, 'malmo-1', 'Malmö');

    // Working source: one trace with eventsFound > 0
    appendTrace(fix, 100, { sourceId: 'sthlm-working', success: true, eventsFound: 5, exitReason: null });
    // Dead source: trace exists, but success=false, eventsFound=0
    appendTrace(fix, 100, { sourceId: 'sthlm-dead', success: false, eventsFound: 0, exitReason: 'NO_JSONLD' });

    const state = collectState({ projectRoot: fix.projectRoot });

    expect(state.totals.sources).toBe(4);
    expect(state.totals.stockholm).toBe(2);
    expect(state.workingSources.map((s) => s.sourceId)).toEqual(['sthlm-working']);
    expect(state.deadSources.map((s) => s.sourceId)).toEqual(['sthlm-dead']);
  });

  it('treats city case-insensitively', () => {
    addSource(fix, 'lower', 'stockholm');
    addSource(fix, 'upper', 'STOCKHOLM');
    addSource(fix, 'mixed', 'StOcKhOlM');

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.totals.stockholm).toBe(3);
  });

  it('skips archive files (underscore-prefixed) in sources/', () => {
    addArchiveDir(fix);
    addSource(fix, 'real', 'Stockholm');

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.totals.sources).toBe(1);
  });
});

describe('collectState — dead / working / untouched classification', () => {
  it('places source in untouchedSources when it has no trace', () => {
    addSource(fix, 'never-run', 'Stockholm');
    appendStatus(fix, 'never-run', { status: 'fail', consecutiveFailures: 5 });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.untouchedSources).toHaveLength(1);
    expect(state.untouchedSources[0].sourceId).toBe('never-run');
    expect(state.untouchedSources[0].consecutiveFailures).toBe(5);
  });

  it('places source in workingSources when trace has success=true and eventsFound>0', () => {
    addSource(fix, 'good', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'good', success: true, eventsFound: 3, exitReason: null });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.workingSources).toHaveLength(1);
    expect(state.deadSources).toHaveLength(0);
    expect(state.untouchedSources).toHaveLength(0);
  });

  it('places source in deadSources when trace exists but success=false', () => {
    addSource(fix, 'bad', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'bad', success: false, eventsFound: 0, exitReason: 'C2_UNCLEAR' });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.deadSources).toHaveLength(1);
    expect(state.deadSources[0].sourceId).toBe('bad');
    expect(state.deadSources[0].lastRoutingReason).toBeNull();
  });

  it('uses most-recent batch when multiple traces exist (latest wins)', () => {
    addSource(fix, 'oscillating', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'oscillating', success: true, eventsFound: 4, exitReason: null });
    appendTrace(fix, 102, { sourceId: 'oscillating', success: false, eventsFound: 0, exitReason: 'C2_UNCLEAR' });

    const state = collectState({ projectRoot: fix.projectRoot });
    // batch-102 is more recent than batch-100 → should classify as dead
    expect(state.deadSources.map((s) => s.sourceId)).toEqual(['oscillating']);
    expect(state.workingSources).toHaveLength(0);
  });

  it('sorts deadSources by consecutiveFailures desc', () => {
    addSource(fix, 'a', 'Stockholm');
    addSource(fix, 'b', 'Stockholm');
    addSource(fix, 'c', 'Stockholm');
    appendStatus(fix, 'a', { consecutiveFailures: 2 });
    appendStatus(fix, 'b', { consecutiveFailures: 10 });
    appendStatus(fix, 'c', { consecutiveFailures: 5 });
    for (const id of ['a', 'b', 'c']) {
      appendTrace(fix, 100, { sourceId: id, success: false, eventsFound: 0, exitReason: 'X' });
    }

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.deadSources.map((s) => s.sourceId)).toEqual(['b', 'c', 'a']);
  });
});

describe('collectState — SourceHealth fields', () => {
  it('merges status fields from runtime/sources_status.jsonl', () => {
    addSource(fix, 'rich', 'Stockholm', 'html');
    appendTrace(fix, 100, { sourceId: 'rich', success: false, eventsFound: 0, exitReason: 'X' });
    appendStatus(fix, 'rich', {
      status: 'fail',
      consecutiveFailures: 7,
      lastRoutingReason: 'toolA: no-jsonld-or-no-events',
      lastPathUsed: 'jsonld',
      outcomeType: 'fail',
    });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.deadSources[0]).toMatchObject({
      sourceId: 'rich',
      status: 'fail',
      consecutiveFailures: 7,
      lastRoutingReason: 'toolA: no-jsonld-or-no-events',
      lastPathUsed: 'jsonld',
      outcomeType: 'fail',
      preferredPath: 'html',
      city: 'Stockholm',
    });
  });

  it('nulls missing status fields (no defaults invented)', () => {
    addSource(fix, 'bare', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'bare', success: false, eventsFound: 0, exitReason: 'X' });
    // no status record appended

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.deadSources[0]).toMatchObject({
      sourceId: 'bare',
      status: null,
      consecutiveFailures: 0,
      lastRoutingReason: null,
      lastPathUsed: null,
      outcomeType: null,
    });
  });
});

describe('collectState — batch stats', () => {
  it('computes successRate and avgEventsFound per batch', () => {
    addSource(fix, 'a', 'Stockholm');
    addSource(fix, 'b', 'Stockholm');
    addSource(fix, 'c', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'a', success: true, eventsFound: 6, exitReason: null });
    appendTrace(fix, 100, { sourceId: 'b', success: true, eventsFound: 4, exitReason: null });
    appendTrace(fix, 100, { sourceId: 'c', success: false, eventsFound: 0, exitReason: 'X' });

    const state = collectState({ projectRoot: fix.projectRoot });
    const stat = state.batchStats.find((b) => b.batch === 'batch-100');
    expect(stat).toBeDefined();
    expect(stat!.totalSources).toBe(3);
    expect(stat!.successes).toBe(2);
    expect(stat!.successRate).toBeCloseTo(2 / 3);
    expect(stat!.avgEventsFound).toBeCloseTo((6 + 4 + 0) / 3);
  });

  it('skips batch directories that have no trace file (no batchStats row)', () => {
    makeBatchDir(fix, 200); // empty batch dir — no batch-traces.jsonl
    const state = collectState({ projectRoot: fix.projectRoot });
    const stat = state.batchStats.find((b) => b.batch === 'batch-200');
    expect(stat).toBeUndefined();
    expect(state.batchStats).toHaveLength(0);
  });

  it('emits batchStats for a batch with a trace file but zero trace records', () => {
    // batch-200 has the file but it's empty
    const dir = makeBatchDir(fix, 200);
    writeFileSync(resolve(dir, 'batch-traces.jsonl'), '');
    const state = collectState({ projectRoot: fix.projectRoot });
    const stat = state.batchStats.find((b) => b.batch === 'batch-200');
    expect(stat).toBeDefined();
    expect(stat!.totalSources).toBe(0);
    expect(stat!.successRate).toBe(0);
    expect(stat!.avgEventsFound).toBe(0);
  });

  it('limits scan to recent N batches (default 5)', () => {
    // Make 8 batches: 100..107
    addSource(fix, 'a', 'Stockholm');
    for (let n = 100; n < 108; n++) {
      appendTrace(fix, n, { sourceId: 'a', success: true, eventsFound: 1, exitReason: null });
    }

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.batchStats).toHaveLength(5);
    // Most recent 5 by num: 107, 106, 105, 104, 103
    expect(state.batchStats.map((b) => b.batch)).toEqual([
      'batch-107', 'batch-106', 'batch-105', 'batch-104', 'batch-103',
    ]);
  });

  it('respects custom recentBatches option', () => {
    addSource(fix, 'a', 'Stockholm');
    for (let n = 100; n < 110; n++) {
      appendTrace(fix, n, { sourceId: 'a', success: true, eventsFound: 1, exitReason: null });
    }

    const state = collectState({ projectRoot: fix.projectRoot, recentBatches: 2 });
    expect(state.batchStats.map((b) => b.batch)).toEqual(['batch-109', 'batch-108']);
  });

  it('ignores non-batch directories (regex /^(batch-\\d{3,})$/)', () => {
    addSource(fix, 'a', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'a', success: true, eventsFound: 1, exitReason: null });

    // Create decoy dirs that should be ignored
    const reportsDir = resolve(fix.projectRoot, '02-Ingestion', 'C-htmlGate', 'reports');
    mkdirSync(resolve(reportsDir, 'batch-state.jsonl.OLD'), { recursive: true });
    writeFileSync(resolve(reportsDir, 'batch-state.jsonl.OLD', 'batch-traces.jsonl'),
      JSON.stringify({ sourceId: 'decoy', success: true, eventsFound: 999 }) + '\n'
    );
    mkdirSync(resolve(reportsDir, 'archive'), { recursive: true });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.batchStats).toHaveLength(1);
    expect(state.batchStats[0].batch).toBe('batch-100');
    expect(state.batchStats[0].totalSources).toBe(1); // decoy NOT counted
  });
});

describe('collectState — schema drift signals', () => {
  it('flags exitReason when it affects 3+ sources', () => {
    addSource(fix, 'a', 'Stockholm');
    addSource(fix, 'b', 'Stockholm');
    addSource(fix, 'c', 'Stockholm');
    addSource(fix, 'd', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'a', success: false, eventsFound: 0, exitReason: 'NO_JSONLD' });
    appendTrace(fix, 100, { sourceId: 'b', success: false, eventsFound: 0, exitReason: 'NO_JSONLD' });
    appendTrace(fix, 100, { sourceId: 'c', success: false, eventsFound: 0, exitReason: 'NO_JSONLD' });
    appendTrace(fix, 100, { sourceId: 'd', success: false, eventsFound: 0, exitReason: 'REDIRECT_LOOP' });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.schemaDriftSignals).toHaveLength(1);
    expect(state.schemaDriftSignals[0].exitReason).toBe('NO_JSONLD');
    expect(state.schemaDriftSignals[0].count).toBe(3);
    expect(state.schemaDriftSignals[0].affectedSourceIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('does NOT flag when exactly 2 sources share an exitReason', () => {
    addSource(fix, 'a', 'Stockholm');
    addSource(fix, 'b', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'a', success: false, eventsFound: 0, exitReason: 'C2_UNCLEAR' });
    appendTrace(fix, 100, { sourceId: 'b', success: false, eventsFound: 0, exitReason: 'C2_UNCLEAR' });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.schemaDriftSignals).toHaveLength(0);
  });

  it('sorts schemaDriftSignals by count desc', () => {
    addSource(fix, 'a', 'Stockholm');
    addSource(fix, 'b', 'Stockholm');
    addSource(fix, 'c', 'Stockholm');
    addSource(fix, 'd', 'Stockholm');
    addSource(fix, 'e', 'Stockholm');
    // X: 3 sources
    appendTrace(fix, 100, { sourceId: 'a', success: false, eventsFound: 0, exitReason: 'X' });
    appendTrace(fix, 100, { sourceId: 'b', success: false, eventsFound: 0, exitReason: 'X' });
    appendTrace(fix, 100, { sourceId: 'c', success: false, eventsFound: 0, exitReason: 'X' });
    // Y: 5 sources
    appendTrace(fix, 100, { sourceId: 'a', success: false, eventsFound: 0, exitReason: 'Y' });
    appendTrace(fix, 100, { sourceId: 'b', success: false, eventsFound: 0, exitReason: 'Y' });
    appendTrace(fix, 100, { sourceId: 'c', success: false, eventsFound: 0, exitReason: 'Y' });
    appendTrace(fix, 100, { sourceId: 'd', success: false, eventsFound: 0, exitReason: 'Y' });
    appendTrace(fix, 100, { sourceId: 'e', success: false, eventsFound: 0, exitReason: 'Y' });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.schemaDriftSignals[0].exitReason).toBe('Y');
    expect(state.schemaDriftSignals[0].count).toBe(5);
    expect(state.schemaDriftSignals[1].exitReason).toBe('X');
    expect(state.schemaDriftSignals[1].count).toBe(3);
  });
});

describe('collectState — failure modes aggregate', () => {
  it('counts all exitReasons across recent batches (no 3-source threshold)', () => {
    addSource(fix, 'a', 'Stockholm');
    addSource(fix, 'b', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'a', success: false, eventsFound: 0, exitReason: 'X' });
    appendTrace(fix, 100, { sourceId: 'b', success: false, eventsFound: 0, exitReason: 'X' });
    appendTrace(fix, 100, { sourceId: 'a', success: false, eventsFound: 0, exitReason: 'Y' });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.failureModes).toEqual({ X: 2, Y: 1 });
  });

  it('skips null exitReasons (success path)', () => {
    addSource(fix, 'a', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'a', success: true, eventsFound: 3, exitReason: null });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.failureModes).toEqual({});
  });
});

describe('collectState — priority queue head', () => {
  it('returns top 10 priority entries', () => {
    for (let i = 0; i < 15; i++) {
      appendPriority(fix, `src-${i}`, 100 - i, `reason ${i}`);
    }

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.priorityQueueHead).toHaveLength(10);
    expect(state.priorityQueueHead[0]).toMatchObject({ sourceId: 'src-0', priority: 100, reason: 'reason 0' });
    expect(state.priorityQueueHead[9].sourceId).toBe('src-9');
  });

  it('filters out entries without a sourceId field', () => {
    appendPriority(fix, 'good', 50, 'ok');
    writeFileSync(
      resolve(fix.projectRoot, 'runtime', 'sources_priority_queue.jsonl'),
      JSON.stringify({ priority: 99, reason: 'no-id' }) + '\n',
      { flag: 'a' }
    );

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.priorityQueueHead).toHaveLength(1);
    expect(state.priorityQueueHead[0].sourceId).toBe('good');
  });
});

describe('collectState — malformed input handling', () => {
  it('skips malformed JSONL lines without throwing', () => {
    addSource(fix, 'good', 'Stockholm');
    writeFileSync(
      resolve(fix.projectRoot, 'runtime', 'sources_status.jsonl'),
      'not-valid-json\n' + JSON.stringify({ sourceId: 'good', consecutiveFailures: 3 }) + '\n',
      { flag: 'a' }
    );

    expect(() => collectState({ projectRoot: fix.projectRoot })).not.toThrow();
    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.deadSources).toHaveLength(0);
    expect(state.untouchedSources).toHaveLength(1);
    expect(state.untouchedSources[0].consecutiveFailures).toBe(3);
  });

  it('skips sources records with non-string id', () => {
    writeFileSync(
      resolve(fix.projectRoot, 'sources', 'broken.jsonl'),
      JSON.stringify({ id: 42, city: 'Stockholm' }) + '\n'
    );
    addSource(fix, 'real', 'Stockholm');

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.totals.sources).toBe(1);
  });

  it('handles empty source file (just whitespace)', () => {
    writeFileSync(
      resolve(fix.projectRoot, 'sources', 'empty.jsonl'),
      '   \n\n  \n'
    );

    expect(() => collectState({ projectRoot: fix.projectRoot })).not.toThrow();
    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.totals.sources).toBe(0);
  });
});

describe('collectState — non-string exitReason coercion', () => {
  it('ignores non-string exitReason in traces', () => {
    addSource(fix, 'a', 'Stockholm');
    appendTrace(fix, 100, { sourceId: 'a', success: false, eventsFound: 0, exitReason: 12345 });
    appendTrace(fix, 100, { sourceId: 'a', success: false, eventsFound: 0, exitReason: null });

    const state = collectState({ projectRoot: fix.projectRoot });
    expect(state.failureModes).toEqual({});
    expect(state.deadSources).toHaveLength(1);
  });
});