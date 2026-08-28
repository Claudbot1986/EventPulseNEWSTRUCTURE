/**
 * Tests for analyze_with_llm — batch-level pattern detector.
 *
 * Mirrors the 08-Agent/llmRouter.test.ts pattern: lazy `getClient()` is mocked
 * to throw so the live SDK is never invoked. Deterministic fallback is the
 * default path the tests exercise.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeWithLlm,
  deterministicAnalysis,
  filterSourceIds,
  buildUserMessage,
  parseAnalysisJson,
  LLM_MODEL,
} from '../tools/analyze_with_llm';
import type { SupervisorState, SourceHealth } from '../tools/collect_state';

// Mock the SDK so accidental network calls fail loudly
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class BoomClient {
      messages = { create: async () => { throw new Error('mock: should not reach SDK'); } };
    },
  };
});

const originalKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function health(over: Partial<SourceHealth> & { sourceId: string }): SourceHealth {
  return {
    sourceId: over.sourceId,
    status: over.status ?? null,
    consecutiveFailures: over.consecutiveFailures ?? 0,
    lastRoutingReason: over.lastRoutingReason ?? null,
    lastPathUsed: over.lastPathUsed ?? null,
    outcomeType: over.outcomeType ?? null,
    preferredPath: over.preferredPath ?? null,
    city: over.city ?? 'Stockholm',
  };
}

function makeState(over: Partial<SupervisorState> = {}): SupervisorState {
  return {
    timestamp: '2026-08-19T10:00:00Z',
    totals: { sources: 0, stockholm: 0, dead: 0, working: 0, untouched: 0 },
    failureModes: {},
    batchStats: [],
    schemaDriftSignals: [],
    deadSources: [],
    workingSources: [],
    untouchedSources: [],
    priorityQueueHead: [],
    ...over,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('filterSourceIds (anti-hallucination)', () => {
  it('keeps only ids in the allowed set, preserves order', () => {
    const allowed = new Set(['a', 'b', 'c']);
    expect(filterSourceIds(['a', 'x', 'b', 'y', 'c'], allowed)).toEqual(['a', 'b', 'c']);
  });

  it('drops duplicates while preserving first occurrence', () => {
    const allowed = new Set(['a', 'b']);
    expect(filterSourceIds(['a', 'b', 'a', 'b', 'a'], allowed)).toEqual(['a', 'b']);
  });

  it('drops non-string entries', () => {
    const allowed = new Set(['a']);
    expect(filterSourceIds(['a', 1, null, undefined, {}, 'a'], allowed)).toEqual(['a']);
  });

  it('drops empty strings', () => {
    const allowed = new Set(['a']);
    expect(filterSourceIds(['', 'a', ''], allowed)).toEqual(['a']);
  });

  it('returns empty when allowed set is empty', () => {
    expect(filterSourceIds(['a', 'b'], new Set())).toEqual([]);
  });

  it('returns empty when input is not an array', () => {
    expect(filterSourceIds('a-b-c', new Set(['a']))).toEqual([]);
    expect(filterSourceIds(null, new Set(['a']))).toEqual([]);
    expect(filterSourceIds({ '0': 'a' }, new Set(['a']))).toEqual([]);
  });
});

describe('parseAnalysisJson', () => {
  it('parses plain JSON', () => {
    const text = '{"findings": [], "suggestedActions": []}';
    expect(parseAnalysisJson(text)).toEqual({ findings: [], suggestedActions: [] });
  });

  it('strips ```json fences', () => {
    const text = 'Here is the JSON:\n```json\n{"findings":[]}\n```\nDone.';
    expect(parseAnalysisJson(text)).toEqual({ findings: [] });
  });

  it('strips ``` fences without language tag', () => {
    const text = '```\n{"x":1}\n```';
    expect(parseAnalysisJson(text)).toEqual({ x: 1 });
  });

  it('returns null when no JSON object present', () => {
    expect(parseAnalysisJson('no json here')).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    expect(parseAnalysisJson('{ "findings": [')).toBeNull();
  });

  it('returns null on non-object root', () => {
    expect(parseAnalysisJson('"a string"')).toBeNull();
    expect(parseAnalysisJson('123')).toBeNull();
    expect(parseAnalysisJson('null')).toBeNull();
  });

  it('extracts first object when multiple present', () => {
    const text = 'noise {"a":1} more noise {"c":3}';
    expect(parseAnalysisJson(text)).toEqual({ a: 1 });
  });
});

describe('buildUserMessage', () => {
  it('includes totals, failureModes, and signals', () => {
    const state = makeState({
      totals: { sources: 100, stockholm: 50, dead: 30, working: 5, untouched: 15 },
      failureModes: { NO_JSONLD: 20, REDIRECT_LOOP: 5 },
    });
    const msg = buildUserMessage(state);
    const parsed = JSON.parse(msg.split('[VALID_SOURCE_IDS]')[0]);
    expect(parsed.totals.dead).toBe(30);
    expect(parsed.failureModes.NO_JSONLD).toBe(20);
    expect(msg).toContain('[VALID_SOURCE_IDS]');
  });

  it('emits VALID_SOURCE_IDS list of every source across all categories', () => {
    const state = makeState({
      deadSources: [health({ sourceId: 'd1' }), health({ sourceId: 'd2' })],
      workingSources: [health({ sourceId: 'w1' })],
      untouchedSources: [health({ sourceId: 'u1' }), health({ sourceId: 'u2' })],
    });
    const msg = buildUserMessage(state);
    const tail = msg.split('[VALID_SOURCE_IDS]')[1].trim();
    expect(tail.split(',').sort()).toEqual(['d1', 'd2', 'u1', 'u2', 'w1']);
  });

  it('caps topDead / topUntouched at 10 entries', () => {
    const dead = Array.from({ length: 30 }, (_, i) => health({ sourceId: `d${i}` }));
    const untouched = Array.from({ length: 30 }, (_, i) => health({ sourceId: `u${i}` }));
    const state = makeState({ deadSources: dead, untouchedSources: untouched });
    const msg = buildUserMessage(state);
    const parsed = JSON.parse(msg.split('[VALID_SOURCE_IDS]')[0]);
    expect(parsed.topDeadByConsecutiveFailures).toHaveLength(10);
    expect(parsed.topUntouchedByConsecutiveFailures).toHaveLength(10);
  });
});

describe('deterministicAnalysis (no LLM)', () => {
  it('returns zero findings for empty state', () => {
    const result = deterministicAnalysis(makeState());
    expect(result.findings).toEqual([]);
    expect(result.suggestedActions).toEqual([]);
    expect(result.inputSourceCount).toBe(0);
  });

  it('emits a schema-drift finding per drift signal', () => {
    const state = makeState({
      schemaDriftSignals: [
        { exitReason: 'NO_JSONLD', count: 5, affectedSourceIds: ['a', 'b', 'c', 'd', 'e'] },
      ],
    });
    const result = deterministicAnalysis(state);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe('schema-drift');
    expect(result.findings[0].sourceIds).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.findings[0].severity).toBe('high'); // count=5 → high
  });

  it('marks count=3 as medium, count=2 as low (if it ever appears)', () => {
    const state = makeState({
      schemaDriftSignals: [
        { exitReason: 'X3', count: 3, affectedSourceIds: ['a', 'b', 'c'] },
      ],
    });
    expect(deterministicAnalysis(state).findings[0].severity).toBe('medium');

    const state2 = makeState({
      schemaDriftSignals: [
        { exitReason: 'X2', count: 2, affectedSourceIds: ['a', 'b'] },
      ],
    });
    // count=2 doesn't appear in input (collect_state filters <3), but if it
    // somehow gets here, severity should still be 'low'.
    expect(deterministicAnalysis(state2).findings[0].severity).toBe('low');
  });

  it('suggests gl-fix-404.py when 404/serverdown cluster present', () => {
    const state = makeState({
      schemaDriftSignals: [
        { exitReason: '404_NOT_FOUND', count: 4, affectedSourceIds: ['a', 'b', 'c', 'd'] },
      ],
    });
    const actions = deterministicAnalysis(state).suggestedActions;
    expect(actions.some((a) => a.target === '03-Queue/gl-fix-404.py')).toBe(true);
  });

  it('suggests gl-fix-500.py when 500 cluster present', () => {
    const state = makeState({
      schemaDriftSignals: [
        { exitReason: 'error500', count: 4, affectedSourceIds: ['a', 'b', 'c', 'd'] },
      ],
    });
    const actions = deterministicAnalysis(state).suggestedActions;
    expect(actions.some((a) => a.target === '03-Queue/gl-fix-500.py')).toBe(true);
  });

  it('emits untouched-staleness finding when consecutiveFailures >= 10', () => {
    const state = makeState({
      untouchedSources: [
        health({ sourceId: 'u1', consecutiveFailures: 11 }),
        health({ sourceId: 'u2', consecutiveFailures: 12 }),
        health({ sourceId: 'u3', consecutiveFailures: 5 }), // below threshold
      ],
    });
    const result = deterministicAnalysis(state);
    const finding = result.findings.find((f) => f.kind === 'untouched-staleness');
    expect(finding).toBeDefined();
    expect(finding!.sourceIds).toEqual(['u1', 'u2']);
    expect(finding!.severity).toBe('medium'); // 2 sources → not high

    const runManual = result.suggestedActions.find((a) => a.kind === 'run-manual');
    expect(runManual).toBeDefined();
    expect(runManual!.target).toBe('u1,u2');
  });

  it('marks untouched-staleness as high when >= 10 stale sources', () => {
    const untouched = Array.from({ length: 12 }, (_, i) =>
      health({ sourceId: `u${i}`, consecutiveFailures: 10 + i })
    );
    const result = deterministicAnalysis(makeState({ untouchedSources: untouched }));
    const finding = result.findings.find((f) => f.kind === 'untouched-staleness');
    expect(finding!.severity).toBe('high');
  });

  it('emits monoculture finding when all working sources use one path', () => {
    const working = [
      health({ sourceId: 'w1', preferredPath: 'jsonld' }),
      health({ sourceId: 'w2', preferredPath: 'jsonld' }),
      health({ sourceId: 'w3', lastPathUsed: 'jsonld' }),
      health({ sourceId: 'w4', preferredPath: 'jsonld' }),
      health({ sourceId: 'w5', preferredPath: 'jsonld' }),
    ];
    const result = deterministicAnalysis(makeState({ workingSources: working }));
    const m = result.findings.find((f) => f.kind === 'monoculture');
    expect(m).toBeDefined();
    expect(m!.summary).toContain('5 working sources');
  });

  it('does NOT emit monoculture when paths are diverse', () => {
    const working = [
      health({ sourceId: 'w1', preferredPath: 'jsonld' }),
      health({ sourceId: 'w2', preferredPath: 'html' }),
      health({ sourceId: 'w3', preferredPath: 'render' }),
      health({ sourceId: 'w4', preferredPath: 'network' }),
      health({ sourceId: 'w5', preferredPath: 'jsonld' }),
    ];
    expect(
      deterministicAnalysis(makeState({ workingSources: working })).findings.some(
        (f) => f.kind === 'monoculture'
      )
    ).toBe(false);
  });

  it('does NOT emit monoculture when working count < 5', () => {
    const working = [
      health({ sourceId: 'w1', preferredPath: 'jsonld' }),
      health({ sourceId: 'w2', preferredPath: 'jsonld' }),
      health({ sourceId: 'w3', preferredPath: 'jsonld' }),
    ];
    expect(
      deterministicAnalysis(makeState({ workingSources: working })).findings.some(
        (f) => f.kind === 'monoculture'
      )
    ).toBe(false);
  });

  it('emits archive-candidate action for ENOTFOUND dead sources', () => {
    const state = makeState({
      deadSources: [health({ sourceId: 'd1', lastRoutingReason: 'getaddrinfo ENOTFOUND', consecutiveFailures: 15 })],
    });
    const result = deterministicAnalysis(state);
    const archive = result.suggestedActions.find((a) => a.kind === 'archive-candidate');
    expect(archive).toBeDefined();
    expect(archive!.target).toBe('d1');
    expect(archive!.riskLevel).toBe('low');
  });

  it('emits archive-candidate for 404 with consecutiveFailures >= 10', () => {
    const state = makeState({
      deadSources: [health({ sourceId: 'd1', lastRoutingReason: 'http 404', consecutiveFailures: 12 })],
    });
    const result = deterministicAnalysis(state);
    expect(result.suggestedActions.some((a) => a.kind === 'archive-candidate')).toBe(true);
  });

  it('does NOT archive 404 with consecutiveFailures < 10', () => {
    const state = makeState({
      deadSources: [health({ sourceId: 'd1', lastRoutingReason: 'http 404', consecutiveFailures: 5 })],
    });
    expect(
      deterministicAnalysis(state).suggestedActions.some((a) => a.kind === 'archive-candidate')
    ).toBe(false);
  });

  it('inputSourceCount sums all categories', () => {
    const state = makeState({
      deadSources: [health({ sourceId: 'd1' }), health({ sourceId: 'd2' })],
      workingSources: [health({ sourceId: 'w1' })],
      untouchedSources: [health({ sourceId: 'u1' }), health({ sourceId: 'u2' }), health({ sourceId: 'u3' })],
    });
    expect(deterministicAnalysis(state).inputSourceCount).toBe(6);
  });
});

describe('analyzeWithLlm — fallback path (no API key)', () => {
  it('returns usedLlm=false and modelVersion=null when key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const state = makeState();
    const result = await analyzeWithLlm(state);
    expect(result.usedLlm).toBe(false);
    expect(result.modelVersion).toBeNull();
  });

  it('returns the deterministic output when key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const state = makeState({
      schemaDriftSignals: [
        { exitReason: 'NO_JSONLD', count: 4, affectedSourceIds: ['a', 'b', 'c', 'd'] },
      ],
    });
    const result = await analyzeWithLlm(state);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe('schema-drift');
  });
});

describe('analyzeWithLlm — SDK mocked to throw → fallback', () => {
  it('falls back to deterministic when SDK errors', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const state = makeState({
      schemaDriftSignals: [
        { exitReason: 'NO_JSONLD', count: 3, affectedSourceIds: ['a', 'b', 'c'] },
      ],
    });
    // The vi.mock above makes any SDK call throw → fallback path
    const result = await analyzeWithLlm(state);
    expect(result.usedLlm).toBe(false);
    expect(result.findings).toHaveLength(1); // from deterministicAnalysis
  });
});

describe('LLM_MODEL constant', () => {
  it('is claude-haiku-4-5 (matches 08-Agent/llmRouter)', () => {
    expect(LLM_MODEL).toBe('claude-haiku-4-5-20251001');
  });
});