/**
 * Tests for daiHook.ts — D-AI queue + auto-trigger logic
 *
 * Tests:
 * 1. enqueueDAI: adds new entry, idempotent on duplicate
 * 2. dequeueDAI: removes existing entry, false on missing
 * 3. readDaiQueue: parses jsonl, tolerates empty file
 * 4. runDaiForQueue: respects cap, skips existing adapters, removes success from queue
 *
 * NOTE: We mock all external side-effects (runPipeline, saveAdapter, loadAdapter,
 * appendManifest, getSource) so the test NEVER touches production runtime files.
 * This is critical because daiHook.ts resolves PROJECT_ROOT relative to its own
 * import.meta.url — without mocking, queue writes would land in real
 * runtime/adapters/_dai-queue.jsonl.
 *
 * Run: npx vitest run 02-Ingestion/A-directAPI-networkGate/daiHook.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Setup: mock all external dependencies BEFORE importing daiHook ──────────

vi.mock('../D-renderGate/constrainedAgent.js', () => ({
  runPipeline: vi.fn(async ({ sourceId }: { sourceId: string }) => ({
    config: {
      type: 'list',
      sourceId,
      seedUrl: `https://${sourceId}.test/`,
      selectors: { eventContainer: '.item', title: 'h2', date: 'time' },
      rateLimitMs: 1500,
      aiConfidence: 0.9,
      generatedAt: new Date().toISOString(),
      generatedBy: 'mock',
      generatorVersion: 'test-1.0',
      validationPassed: true,
      validationNotes: 'mock-pass',
    },
    promptTokens: 100,
    responseTokens: 50,
    iterations: 1,
    validationPassed: true,
    validationNotes: 'mock-pass',
  })),
  saveAdapter: vi.fn((cfg: { sourceId: string }) => `/mock/path/${cfg.sourceId}.json`),
  loadAdapter: vi.fn(() => null), // default: no existing adapter
  appendManifest: vi.fn(),
}));

vi.mock('../tools/sourceRegistry.js', () => ({
  getSource: vi.fn((id: string) => ({ id, url: `https://${id}.test/` })),
}));

// Mock fs så att daiHook inte skriver till production runtime
const mockFiles: Record<string, string> = {};
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((p: string) => Boolean(mockFiles[p])),
    readFileSync: vi.fn((p: string) => {
      if (!(p in mockFiles)) {
        const err: NodeJS.ErrnoException = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return mockFiles[p];
    }),
    writeFileSync: vi.fn((p: string, data: string) => {
      mockFiles[p] = data;
    }),
    appendFileSync: vi.fn((p: string, data: string) => {
      mockFiles[p] = (mockFiles[p] ?? '') + data;
    }),
    mkdirSync: vi.fn(),
  };
});

const daiHook = await import('./daiHook.ts');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('daiHook — queue I/O', () => {
  beforeEach(() => {
    // reset mock fs state between tests
    for (const k of Object.keys(mockFiles)) delete mockFiles[k];
  });

  it('enqueueDAI adds a new entry to an empty queue', () => {
    const entry = daiHook.enqueueDAI('src-a', 'https://a.test/', 'no-jsonld-or-no-events', 'runA');
    expect(entry.sourceId).toBe('src-a');
    expect(entry.attempts).toBe(0);
    expect(entry.reason).toBe('no-jsonld-or-no-events');
    expect(entry.enqueuedBy).toBe('runA');
    const queue = daiHook.readDaiQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].sourceId).toBe('src-a');
  });

  it('enqueueDAI is idempotent — duplicate increments attempts, no second row', () => {
    daiHook.enqueueDAI('src-b', 'https://b.test/', 'no-jsonld-or-no-events', 'runA');
    daiHook.enqueueDAI('src-b', 'https://b.test/', 'manual', 'manual');
    const queue = daiHook.readDaiQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].reason).toBe('manual'); // reason updated to newest
  });

  it('dequeueDAI removes an entry, returns true', () => {
    daiHook.enqueueDAI('src-c', 'https://c.test/', 'no-jsonld-or-no-events', 'runA');
    expect(daiHook.dequeueDAI('src-c')).toBe(true);
    expect(daiHook.readDaiQueue()).toHaveLength(0);
  });

  it('dequeueDAI returns false when sourceId not in queue', () => {
    expect(daiHook.dequeueDAI('not-present')).toBe(false);
  });

  it('readDaiQueue on missing file returns empty array', () => {
    expect(daiHook.readDaiQueue()).toEqual([]);
  });
});

describe('daiHook — runDaiForQueue orchestration', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockFiles)) delete mockFiles[k];
  });

  it('returns empty array when queue is empty', async () => {
    const results = await daiHook.runDaiForQueue({ cap: 5 });
    expect(results).toEqual([]);
  });

  it('processes up to cap items, removes successful ones from queue', async () => {
    daiHook.enqueueDAI('src-1', 'https://1.test/', 'no-jsonld-or-no-events', 'runA');
    daiHook.enqueueDAI('src-2', 'https://2.test/', 'no-jsonld-or-no-events', 'runA');
    daiHook.enqueueDAI('src-3', 'https://3.test/', 'no-jsonld-or-no-events', 'runA');
    daiHook.enqueueDAI('src-4', 'https://4.test/', 'no-jsonld-or-no-events', 'runA');

    const results = await daiHook.runDaiForQueue({ cap: 2 });

    expect(results).toHaveLength(2);
    expect(results[0].validationPassed).toBe(true);
    const remaining = daiHook.readDaiQueue();
    expect(remaining).toHaveLength(2); // 2 successful removed, 2 still queued
    expect(remaining.map(e => e.sourceId).sort()).toEqual(['src-3', 'src-4']);
  });

  it('skips sourceId when adapter already exists (loadAdapter returns truthy)', async () => {
    // Override loadAdapter mock for this test
    const { loadAdapter } = await import('../D-renderGate/constrainedAgent.js');
    vi.mocked(loadAdapter).mockImplementation((id: string) =>
      id === 'exists' ? ({ sourceId: 'exists', type: 'list' } as never) : null
    );

    daiHook.enqueueDAI('exists', 'https://exists.test/', 'no-jsonld-or-no-events', 'runA');
    daiHook.enqueueDAI('newone', 'https://newone.test/', 'no-jsonld-or-no-events', 'runA');

    const results = await daiHook.runDaiForQueue({ cap: 5 });
    const skipped = results.filter(r => r.skipped);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0].sourceId).toBe('exists');
    expect(skipped[0].skipReason).toBe('adapter-already-exists');
  });

  it('keeps failed entries in queue with attempts incremented', async () => {
    const { runPipeline } = await import('../D-renderGate/constrainedAgent.js');
    vi.mocked(runPipeline).mockRejectedValueOnce(new Error('mock-pipeline-fail'));

    daiHook.enqueueDAI('fail-1', 'https://fail.test/', 'no-jsonld-or-no-events', 'runA');

    const results = await daiHook.runDaiForQueue({ cap: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].error).toBe('mock-pipeline-fail');

    const queue = daiHook.readDaiQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].lastError).toBe('mock-pipeline-fail');
  });
});
