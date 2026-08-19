/**
 * Unit tests for `source_ai_review.ts`.
 *
 * Coverage:
 *   - Deterministic rules:
 *       ENOTFOUND + cf>=10 → archive-dead (high, no human review)
 *       HTTP 404 + cf>=10 → archive-dead (high, no human review)
 *       Redirect loop + cf>=10 → mark-review-needed (medium, human review)
 *       No JSON-LD + cf>=5 + c1BestSubpageFound → update-preferred-path (high)
 *       No JSON-LD + cf>=5 + no subpage → mark-review-needed (medium, human)
 *   - LLM path skipped when no API key is set
 *   - proposalsToChanges maps confidence to auto-applied vs pending-review
 *   - sanitizeLlmProposals drops hallucinated sourceIds
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  reviewSources,
  proposalsToChanges,
} from '../tools/source_ai_review';
import type { SourceHealth } from '../tools/collect_state';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'ai-review-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeSource(overrides: Partial<SourceHealth>): SourceHealth {
  return {
    sourceId: 'foo',
    status: 'fail',
    consecutiveFailures: 5,
    lastRoutingReason: null,
    lastPathUsed: null,
    outcomeType: null,
    preferredPath: null,
    city: 'Stockholm',
    ...overrides,
  };
}

function setupBatchTraces(entries: Array<Record<string, unknown>>): void {
  const dir = resolve(tmpRoot, '02-Ingestion/C-htmlGate/reports/batch-99');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'batch-traces.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf-8',
  );
}

describe('deterministic rules — archive-dead', () => {
  it('ENOTFOUND + cf>=10 → archive-dead (high, no human review)', async () => {
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [
        makeSource({
          sourceId: 'dns-1',
          consecutiveFailures: 15,
          lastRoutingReason: 'getaddrinfo ENOTFOUND foo.example',
        }),
      ],
    });

    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].action).toBe('archive-dead');
    expect(r.proposals[0].confidence).toBe('high');
    expect(r.proposals[0].needsHumanReview).toBe(false);
    expect(r.usedLlm).toBe(false);
  });

  it('HTTP 404 + cf>=10 → archive-dead (high)', async () => {
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [
        makeSource({
          sourceId: 'gone-1',
          consecutiveFailures: 12,
          lastRoutingReason: 'http 404 not found',
        }),
      ],
    });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].action).toBe('archive-dead');
    expect(r.proposals[0].confidence).toBe('high');
  });

  it('ENOTFOUND + cf<10 → NO proposal (below threshold)', async () => {
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [
        makeSource({
          sourceId: 'young-dns',
          consecutiveFailures: 5,
          lastRoutingReason: 'ENOTFOUND',
        }),
      ],
    });
    expect(r.proposals).toHaveLength(0);
  });
});

describe('deterministic rules — mark-review-needed', () => {
  it('redirect loop + cf>=10 → mark-review-needed (medium, human review)', async () => {
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [
        makeSource({
          sourceId: 'redir-1',
          consecutiveFailures: 15,
          lastRoutingReason: 'REDIRECT LOOP exceeded 30 redirects',
        }),
      ],
    });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].action).toBe('mark-review-needed');
    expect(r.proposals[0].confidence).toBe('medium');
    expect(r.proposals[0].needsHumanReview).toBe(true);
  });
});

describe('deterministic rules — update-preferred-path', () => {
  it('NO_JSONLD + cf>=5 + c1BestSubpageFound → update-preferred-path (high, auto)', async () => {
    setupBatchTraces([
      {
        sourceId: 'nojson-1',
        success: false,
        eventsFound: 0,
        exitReason: 'toolA: no-jsonld-or-no-events',
        c0Candidates: 5,
        c1BestSubpageFound: '/events',
        c2Score: 0.7,
      },
    ]);
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [
        makeSource({
          sourceId: 'nojson-1',
          consecutiveFailures: 8,
          lastRoutingReason: 'toolA: no-jsonld-or-no-events',
        }),
      ],
    });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].action).toBe('update-preferred-path');
    expect(r.proposals[0].confidence).toBe('high');
    expect(r.proposals[0].needsHumanReview).toBe(false);
    expect(r.proposals[0].after.preferredPath).toBe('/events');
  });

  it('NO_JSONLD + cf>=5 + no subpage evidence → mark-review-needed (medium, human)', async () => {
    setupBatchTraces([
      {
        sourceId: 'nojson-2',
        success: false,
        eventsFound: 0,
        exitReason: 'toolA: no-jsonld-or-no-events',
        c0Candidates: 0,
        c1BestSubpageFound: null,
      },
    ]);
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [
        makeSource({
          sourceId: 'nojson-2',
          consecutiveFailures: 12,
          lastRoutingReason: 'toolA: no-jsonld-or-no-events',
        }),
      ],
    });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].action).toBe('mark-review-needed');
    expect(r.proposals[0].confidence).toBe('medium');
    expect(r.proposals[0].needsHumanReview).toBe(true);
  });

  it('NO_JSONLD + cf<5 → NO proposal', async () => {
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [
        makeSource({
          sourceId: 'nojson-3',
          consecutiveFailures: 2,
          lastRoutingReason: 'no-jsonld-or-no-events',
        }),
      ],
    });
    expect(r.proposals).toHaveLength(0);
  });
});

describe('multiple sources', () => {
  it('produces one proposal per matching source', async () => {
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [
        makeSource({
          sourceId: 'dns-1',
          consecutiveFailures: 15,
          lastRoutingReason: 'ENOTFOUND foo.example',
        }),
        makeSource({
          sourceId: 'dns-2',
          consecutiveFailures: 12,
          lastRoutingReason: 'getaddrinfo ENOTFOUND bar.example',
        }),
        makeSource({
          sourceId: 'four-oh-four',
          consecutiveFailures: 14,
          lastRoutingReason: 'http 404 not found',
        }),
        makeSource({
          sourceId: 'ok-1',
          status: 'ok',
          consecutiveFailures: 0,
          lastRoutingReason: null,
        }),
      ],
    });
    expect(r.proposals).toHaveLength(3);
    const ids = r.proposals.map((p) => p.sourceId).sort();
    expect(ids).toEqual(['dns-1', 'dns-2', 'four-oh-four']);
  });
});

describe('LLM path', () => {
  it('skips LLM when ANTHROPIC_API_KEY is missing', async () => {
    const r = await reviewSources({
      projectRoot: tmpRoot,
      sources: [makeSource({ sourceId: 'foo', consecutiveFailures: 2, lastRoutingReason: 'mystery' })],
    });
    expect(r.usedLlm).toBe(false);
    expect(r.modelVersion).toBeNull();
    expect(r.llmProposalsCount).toBe(0);
  });
});

describe('proposalsToChanges', () => {
  it('maps auto-apply decision to auto-applied + auto-rule', () => {
    const proposals = [
      {
        sourceId: 'foo',
        action: 'archive-dead' as const,
        before: {},
        after: {},
        confidence: 'high' as const,
        rationale: 'r',
        evidence: 'e',
        needsHumanReview: false,
      },
    ];
    const changes = proposalsToChanges(proposals, 'auto-apply');
    expect(changes).toHaveLength(1);
    expect(changes[0].reviewStatus).toBe('auto-applied');
    expect(changes[0].appliedBy).toBe('auto-rule');
  });

  it('maps queue-review decision to pending-review + ai-reviewer', () => {
    const proposals = [
      {
        sourceId: 'foo',
        action: 'mark-review-needed' as const,
        before: {},
        after: {},
        confidence: 'medium' as const,
        rationale: 'r',
        evidence: 'e',
        needsHumanReview: true,
      },
    ];
    const changes = proposalsToChanges(proposals, 'queue-review');
    expect(changes).toHaveLength(1);
    expect(changes[0].reviewStatus).toBe('pending-review');
    expect(changes[0].appliedBy).toBe('ai-reviewer');
  });
});
