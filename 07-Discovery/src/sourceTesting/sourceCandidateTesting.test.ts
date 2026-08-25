import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { decideSourceCandidateOutcome } from './decision.js';
import { appendDiscoveryUiQueueEntry } from './discoveryUiQueue.js';
import { createSandboxSource, removeSandboxSource, promoteSourceCandidate } from './sandbox.js';
import { runSourceCandidateTest } from './runner.js';
import type {
  SourceCandidate,
  SourceCandidateTestRepository,
  SourceCandidateToolRunner,
} from './types.js';

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    id: 'candidate-1',
    candidateUrl: 'https://example.test/events',
    sourceName: 'Example Events',
    city: 'Stockholm',
    priorityScore: 85,
    confidenceScore: 80,
    originPath: ['venue:debaser', 'source_candidate:example'],
    evidenceRefs: [{ evidenceType: 'graph', evidenceId: 'edge-1' }],
    ...overrides,
  };
}

function repository(overrides: Partial<SourceCandidateTestRepository> = {}): SourceCandidateTestRepository {
  return {
    claimCandidates: vi.fn(async () => []),
    insertRun: vi.fn(async () => 'run-1'),
    insertDecision: vi.fn(async () => undefined),
    updateCandidateStatus: vi.fn(async () => undefined),
    ...overrides,
  };
}

function discoveryEntry(sourceId: string, promotedAt = '2026-04-27T17:44:00.000Z') {
  return {
    sourceId,
    sourceCandidateId: `candidate-${sourceId}`,
    testRunId: `run-${sourceId}`,
    name: sourceId,
    url: `https://${sourceId}.example/events`,
    city: 'Stockholm',
    promotedAt,
    discoveredBy: 'venue_graph' as const,
    preferredPath: 'html' as const,
    evidenceSummary: '5 persisted events',
    status: 'promoted_to_sources' as const,
  };
}

describe('source candidate decision engine', () => {
  it('promotes only after smoke has persisted events with low venue risk', () => {
    const decision = decideSourceCandidateOutcome({
      candidate: candidate(),
      phase: 'smoke',
      eventsFoundTotal: 6,
      eventsAfterNormalization: 5,
      eventsPersisted: 5,
      winningPath: 'html',
      errors: [],
      riskFlags: [],
      reportComplete: true,
      duplicateCanonicalSource: false,
    });

    expect(decision.decision).toBe('promote');
    expect(decision.reason).toContain('smoke');
  });

  it('keeps promising non-smoke candidates out of canonical sources', () => {
    const decision = decideSourceCandidateOutcome({
      candidate: candidate(),
      phase: 'breadth',
      eventsFoundTotal: 8,
      eventsAfterNormalization: 0,
      eventsPersisted: 0,
      winningPath: 'network',
      errors: [],
      riskFlags: [],
      reportComplete: true,
      duplicateCanonicalSource: false,
    });

    expect(decision.decision).toBe('manual_review');
    expect(decision.reason).toContain('requires smoke');
  });

  it('rejects duplicate canonical URLs before promotion', () => {
    const decision = decideSourceCandidateOutcome({
      candidate: candidate(),
      phase: 'smoke',
      eventsFoundTotal: 5,
      eventsAfterNormalization: 5,
      eventsPersisted: 5,
      winningPath: 'jsonld',
      errors: [],
      riskFlags: [],
      reportComplete: true,
      duplicateCanonicalSource: true,
    });

    expect(decision.decision).toBe('reject');
    expect(decision.reason).toContain('duplicate');
  });
});

describe('source candidate sandbox', () => {
  it('creates and removes a temporary source without leaving canonical truth behind', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eventpulse-source-test-'));
    try {
      const source = createSandboxSource(root, candidate());
      const sourcePath = path.join(root, 'sources', `${source.sourceId}.jsonl`);

      expect(existsSync(sourcePath)).toBe(true);
      expect(JSON.parse(readFileSync(sourcePath, 'utf8'))).toMatchObject({
        id: source.sourceId,
        url: 'https://example.test/events',
        discoveredBy: 'venue_graph',
        metadata: {
          sourceCandidateId: 'candidate-1',
          sandbox: true,
        },
      });

      removeSandboxSource(root, source.sourceId);
      expect(existsSync(sourcePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('promotes only an approved candidate to canonical source and Discovery-UI', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eventpulse-source-promote-'));
    try {
      const sourceId = promoteSourceCandidate(root, candidate(), {
        preferredPath: 'html',
        preferredPathReason: 'smoke passed with persisted events',
        testRunId: 'run-1',
        evidenceSummary: '5 persisted events',
      });
      const sourcePath = path.join(root, 'sources', `${sourceId}.jsonl`);
      const discoveryUiPath = path.join(root, 'runtime', 'discovery-ui-queue.jsonl');
      const preAPath = path.join(root, 'runtime', 'preA-queue.jsonl');

      expect(JSON.parse(readFileSync(sourcePath, 'utf8'))).toMatchObject({
        id: sourceId,
        discoveredBy: 'venue_graph',
        preferredPath: 'html',
        metadata: {
          sourceCandidateId: 'candidate-1',
          testRunId: 'run-1',
        },
      });
      expect(readFileSync(discoveryUiPath, 'utf8')).toContain(sourceId);
      expect(existsSync(preAPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not duplicate Discovery-UI rows for repeated promotion', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eventpulse-source-promote-'));
    try {
      const firstSourceId = promoteSourceCandidate(root, candidate(), {
        preferredPath: 'html',
        preferredPathReason: 'smoke passed with persisted events',
        testRunId: 'run-1',
        evidenceSummary: '5 persisted events',
      });
      const secondSourceId = promoteSourceCandidate(root, candidate(), {
        preferredPath: 'html',
        preferredPathReason: 'smoke passed with persisted events',
        testRunId: 'run-1',
        evidenceSummary: '5 persisted events',
      });
      const discoveryUiPath = path.join(root, 'runtime', 'discovery-ui-queue.jsonl');
      const rows = readFileSync(discoveryUiPath, 'utf8').trim().split('\n');

      expect(secondSourceId).toBe(firstSourceId);
      expect(rows).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves malformed Discovery-UI rows without blocking promotion', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eventpulse-source-promote-'));
    try {
      const discoveryUiPath = path.join(root, 'runtime', 'discovery-ui-queue.jsonl');
      mkdirSync(path.dirname(discoveryUiPath), { recursive: true });
      const badLine = '{bad json';
      writeFileSync(discoveryUiPath, `${badLine}\n`, 'utf8');

      const sourceId = promoteSourceCandidate(root, candidate(), {
        preferredPath: 'html',
        preferredPathReason: 'smoke passed with persisted events',
        testRunId: 'run-1',
        evidenceSummary: '5 persisted events',
      });
      const rows = readFileSync(discoveryUiPath, 'utf8').trim().split('\n');

      expect(rows).toHaveLength(2);
      expect(rows[0]).toBe(badLine);
      expect(rows[1]).toContain(sourceId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('archives older Discovery-UI rows when active queue exceeds retention', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eventpulse-source-promote-'));
    try {
      appendDiscoveryUiQueueEntry(root, discoveryEntry('source-a', '2026-04-27T10:00:00.000Z'), {
        maxActiveRows: 2,
      });
      appendDiscoveryUiQueueEntry(root, discoveryEntry('source-b', '2026-04-27T11:00:00.000Z'), {
        maxActiveRows: 2,
      });
      appendDiscoveryUiQueueEntry(root, discoveryEntry('source-c', '2026-04-27T12:00:00.000Z'), {
        maxActiveRows: 2,
      });

      const activeRows = readFileSync(path.join(root, 'runtime', 'discovery-ui-queue.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const archiveRows = readFileSync(path.join(root, 'runtime', 'archive', 'discovery-ui-2026-04.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(activeRows.map((row) => row.sourceId)).toEqual(['source-b', 'source-c']);
      expect(archiveRows.map((row) => row.sourceId)).toEqual(['source-a']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('retains malformed schema rows and removes archived rows by occurrence', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eventpulse-source-promote-'));
    try {
      const discoveryUiPath = path.join(root, 'runtime', 'discovery-ui-queue.jsonl');
      mkdirSync(path.dirname(discoveryUiPath), { recursive: true });
      const duplicateLine = JSON.stringify(discoveryEntry('duplicate-source', '2026-04-27T10:00:00.000Z'));
      const malformedSchemaLine = JSON.stringify({ sourceId: 'bad-row', promotedAt: 'not-a-month' });
      writeFileSync(discoveryUiPath, `${duplicateLine}\n${duplicateLine}\n${malformedSchemaLine}\n`, 'utf8');

      appendDiscoveryUiQueueEntry(root, discoveryEntry('source-c', '2026-04-27T12:00:00.000Z'), {
        maxActiveRows: 2,
      });

      const activeRows = readFileSync(discoveryUiPath, 'utf8').trim().split('\n');
      const archiveRows = readFileSync(path.join(root, 'runtime', 'archive', 'discovery-ui-2026-04.jsonl'), 'utf8')
        .trim()
        .split('\n');

      expect(activeRows).toContain(duplicateLine);
      expect(activeRows).toContain(malformedSchemaLine);
      expect(activeRows.some((line) => line.includes('source-c'))).toBe(true);
      expect(archiveRows).toHaveLength(1);
      expect(archiveRows[0]).toBe(duplicateLine);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('source candidate runner', () => {
  it('runs real tool delegation and records measured evidence before deciding', async () => {
    const repo = repository();
    const toolRunner: SourceCandidateToolRunner = {
      run: vi.fn(async () => ({
        commandsRun: [
          ['python3', 'Alltools-E2E/e2e.py', '--from-preA', '--limit', '1'],
        ],
        toolSummaries: {
          A: { eventsFound: 0, status: 'no_events' as const },
          B: { eventsFound: 0, status: 'no_events' as const },
          C: { eventsFound: 3, status: 'success' as const },
          D: { eventsFound: 0, status: 'not_run' as const },
        },
        eventsFoundTotal: 3,
        eventsAfterNormalization: 0,
        eventsPersisted: 0,
        winningPath: 'html' as const,
        errors: [],
        reportPath: '07-Discovery/testResults/source-candidates/run-test.json',
        reportComplete: true,
        riskFlags: [],
      })),
    };

    const result = await runSourceCandidateTest({
      candidate: candidate(),
      phase: 'breadth',
      projectRoot: '/tmp/eventpulse',
      repository: repo,
      toolRunner,
    });

    expect(toolRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({ id: 'candidate-1' }),
      phase: 'breadth',
    }));
    expect(repo.insertRun).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'breadth',
      eventsFoundTotal: 3,
      winningPath: 'html',
    }));
    expect(repo.insertDecision).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'manual_review',
    }));
    expect(result.decision.decision).toBe('manual_review');
  });
});
