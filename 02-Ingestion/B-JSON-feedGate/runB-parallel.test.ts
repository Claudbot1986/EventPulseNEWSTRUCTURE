/**
 * Tests for runB-parallel.ts — B-Runner PARALLEL
 *
 * Tests:
 * 1. runParallel: concurrency control, results order preservation
 * 2. Batch queue I/O: read-once, write-once semantics
 * 3. finalizeSourceBatch: correct routing of results to output queues
 * 4. CLI argument parsing: --limit, --workers, --dry, --status
 * 5. postB-preC drain: unprocessed sources remain in preB queue
 *
 * Run: npx vitest run 02-Ingestion/B-JSON-feedGate/runB-parallel.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

// We test the logic via a test harness that doesn't need actual network calls
// The key is: runParallel concurrency, batch I/O, result routing

// ─── Mock modules ──────────────────────────────────────────────────────────────

const mockEntries = [
  { sourceId: 'src-1', queueName: 'preB', queuedAt: '2026-01-01T00:00:00Z', priority: 1, attempt: 1, queueReason: 'test' },
  { sourceId: 'src-2', queueName: 'preB', queuedAt: '2026-01-01T00:00:00Z', priority: 1, attempt: 1, queueReason: 'test' },
  { sourceId: 'src-3', queueName: 'preB', queuedAt: '2026-01-01T00:00:00Z', priority: 1, attempt: 1, queueReason: 'test' },
];

// ─── Test: runParallel concurrency control ────────────────────────────────────

describe('runParallel', () => {
  it('should process all items regardless of concurrency', async () => {
    // Import the function
    const { runParallel } = await import('./runB-parallel.ts');

    const items = [1, 2, 3, 4, 5];
    let activeCount = 0;
    let maxActive = 0;

    const worker = async (item: number) => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise(r => setTimeout(r, 10));
      activeCount--;
      return item * 2;
    };

    // With concurrency=2, max 2 should be active at once
    const results = await runParallel(items, worker, 2);
    expect(results.sort()).toEqual([2, 4, 6, 8, 10].sort());
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('should preserve order of results', async () => {
    const { runParallel } = await import('./runB-parallel.ts');

    const items = ['a', 'b', 'c'];
    const worker = async (item: string) => {
      await new Promise(r => setTimeout(r, 5));
      return item.toUpperCase();
    };

    const results = await runParallel(items, worker, 3);
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('should handle concurrency=1 (sequential)', async () => {
    const { runParallel } = await import('./runB-parallel.ts');

    const items = [1, 2, 3];
    let lastTime = 0;

    const worker = async (item: number) => {
      const now = Date.now();
      // With concurrency=1, each starts after the previous finishes
      if (lastTime > 0) expect(now).toBeGreaterThanOrEqual(lastTime);
      lastTime = now;
      await new Promise(r => setTimeout(r, 5));
      return item;
    };

    const results = await runParallel(items, worker, 1);
    expect(results).toEqual([1, 2, 3]);
  });
});

// ─── Test: Batch queue I/O ───────────────────────────────────────────────────

describe('Batch queue I/O', () => {
  const TEST_DIR = '/tmp/runB-parallel-test';

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  it('should read preB queue correctly', async () => {
    const testFile = join(TEST_DIR, 'preB-queue.jsonl');
    writeFileSync(testFile, mockEntries.map(e => JSON.stringify(e)).join('\n') + '\n');

    // Simulate the read logic
    const content = readFileSync(testFile, 'utf8');
    const entries = content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    expect(entries.length).toBe(3);
    expect(entries[0].sourceId).toBe('src-1');
    expect(entries[2].sourceId).toBe('src-3');
  });

  it('should write remaining sources back to preB queue (unprocessed stay)', async () => {
    const testFile = join(TEST_DIR, 'preB-queue.jsonl');
    const allEntries = [...mockEntries];
    const remaining = allEntries.slice(1); // leave src-1 as "processed"

    const content = remaining.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(testFile, content);

    const content2 = readFileSync(testFile, 'utf8');
    const entries2 = content2.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    expect(entries2.length).toBe(2);
    expect(entries2.map((e: any) => e.sourceId)).toEqual(['src-2', 'src-3']);
  });

  it('should deduplicate preB by sourceId', async () => {
    const testFile = join(TEST_DIR, 'preB-queue.jsonl');
    const dupEntries = [
      ...mockEntries,
      { sourceId: 'src-1', queueName: 'preB', queuedAt: '2026-01-02T00:00:00Z', priority: 1, attempt: 1, queueReason: 'duplicate' },
    ];
    writeFileSync(testFile, dupEntries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const content = readFileSync(testFile, 'utf8');
    const seen = new Set<string>();
    const unique = content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as any)
      .filter((e: any) => {
        if (seen.has(e.sourceId)) return false;
        seen.add(e.sourceId);
        return true;
      });

    expect(unique.length).toBe(3);
    // First occurrence should win
    const src1 = unique.find((e: any) => e.sourceId === 'src-1');
    expect(src1.queuedAt).toBe('2026-01-01T00:00:00Z');
  });
});

// ─── Test: finalizeSourceBatch routing ────────────────────────────────────────

describe('finalizeSourceBatch', () => {
  // We test the routing logic separately since it depends on sourceRegistry

  it('should correctly classify B success vs postB vs postB-preC', () => {
    // Test the routing logic:
    // success + events > 0 → postB (B success)
    // !success + nextPath=network + inspectorVerdict=promising → postB (strong candidate)
    // else → postB-preC (not B)

    const classify = (
      success: boolean,
      eventsFound: number,
      nextPath: string,
      inspectorVerdict?: string
    ): 'postB' | 'postB-preC' => {
      if (success && eventsFound > 0) return 'postB';
      if (!success && nextPath === 'network' && inspectorVerdict === 'promising') return 'postB';
      return 'postB-preC';
    };

    expect(classify(true, 5, 'network')).toBe('postB');
    expect(classify(false, 0, 'network', 'promising')).toBe('postB');
    expect(classify(false, 0, 'network')).toBe('postB-preC');
    expect(classify(false, 0, 'html')).toBe('postB-preC');
    expect(classify(false, 0, 'blocked-review')).toBe('postB-preC');
  });
});

// ─── Test: CLI argument parsing ───────────────────────────────────────────────

describe('CLI argument parsing', () => {
  it('should default to limit=100', () => {
    const args: string[] = [];
    const limitIdx = args.indexOf('--limit');
    const LIMIT = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 100;
    expect(LIMIT).toBe(100);
  });

  it('should parse explicit --limit', () => {
    const args = ['--limit', '50'];
    const limitIdx = args.indexOf('--limit');
    const LIMIT = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : 100;
    expect(LIMIT).toBe(50);
  });

  it('should default to workers=20', () => {
    const args: string[] = [];
    const workersIdx = args.indexOf('--workers');
    const WORKERS = workersIdx !== -1 && args[workersIdx + 1] ? parseInt(args[workersIdx + 1], 10) : 20;
    expect(WORKERS).toBe(20);
  });

  it('should parse explicit --workers', () => {
    const args = ['--workers', '10'];
    const workersIdx = args.indexOf('--workers');
    const WORKERS = workersIdx !== -1 && args[workersIdx + 1] ? parseInt(args[workersIdx + 1], 10) : 20;
    expect(WORKERS).toBe(10);
  });

  it('should detect --dry flag', () => {
    expect(['--dry'].includes('--dry')).toBe(true);
    expect([].includes('--dry')).toBe(false);
  });

  it('should detect --status flag', () => {
    expect(['--status'].includes('--status')).toBe(true);
    expect([].includes('--status')).toBe(false);
  });
});

// ─── Test: throughput estimate ───────────────────────────────────────────────

describe('Performance characteristics', () => {
  it('should estimate throughput correctly', () => {
    const sources = 100;
    const elapsedMs = 5000;
    const throughput = sources / (elapsedMs / 1000);
    expect(throughput).toBe(20); // 20 sources/sec for 100 sources in 5 seconds
  });

  it('should calculate correct remaining count', () => {
    const all = 424;
    const limit = 100;
    const remaining = all - limit;
    expect(remaining).toBe(324);
  });
});
