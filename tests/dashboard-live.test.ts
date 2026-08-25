import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  collectPreUIEventsSourceIds,
  formatDiscoveryUiRows,
  formatHorizontalQueueCountTable,
  getChildProcessKillTarget,
  getOperationalQueueNames,
  getQueueNames,
  getUiPromoteMoveArgs,
  parseDiscoveryUiRows,
  summarizeDiscoveryUiRows,
  inferE2ePathFromEvidence,
  isPreUIEventsSourceQueue,
  isActualExtractedEvent,
} from '../dashboard-live.js';

describe('dashboard runtime e2ePath evidence', () => {
  it('does not classify queue location as an extracted path without actual events', () => {
    expect(
      inferE2ePathFromEvidence({ home: 'postA', rootEvents: 0, cEvents: 0, dEvents: 0 })
    ).toBe('pending');
    expect(
      inferE2ePathFromEvidence({ home: 'postTestC-UI', rootEvents: 0, cEvents: 0, dEvents: 0 })
    ).toBe('pending');
    expect(
      inferE2ePathFromEvidence({ home: 'postD-UI', rootEvents: 0, cEvents: 0, dEvents: 0 })
    ).toBe('pending');
    expect(
      inferE2ePathFromEvidence({ home: 'preUI', rootEvents: 0, cEvents: 0, dEvents: 0 })
    ).toBe('pending');
  });

  it('classifies paths only from actual extracted event evidence', () => {
    expect(
      inferE2ePathFromEvidence({ home: 'postA', rootEvents: 2, cEvents: 0, dEvents: 0 })
    ).toBe('api-network');
    expect(
      inferE2ePathFromEvidence({ home: 'postB', rootEvents: 2, cEvents: 0, dEvents: 0 })
    ).toBe('api-network');
    expect(
      inferE2ePathFromEvidence({ home: 'postTestC-UI', rootEvents: 0, cEvents: 2, dEvents: 0 })
    ).toBe('html');
    expect(
      inferE2ePathFromEvidence({ home: 'postD-UI', rootEvents: 0, cEvents: 0, dEvents: 2 })
    ).toBe('render');
  });

  it('rejects synthetic extracted rows as event evidence', () => {
    expect(
      isActualExtractedEvent({
        title: 'Synthetic event',
        date: '2026-06-01',
        confidence: { signals: ['synthetic', 'dead_domain'] },
      })
    ).toBe(false);

    expect(
      isActualExtractedEvent({
        title: 'Real event',
        date: '2026-06-01',
        confidence: { signals: ['html-swedish-relative-date'] },
      })
    ).toBe(true);
  });
});

describe('dashboard preUI queue count table', () => {
  it('renders queue names on one row and source counts below them', () => {
    expect(
      formatHorizontalQueueCountTable(
        ['postA', 'postB', 'postTestC-UI', 'post10-UI', 'postD-UI', 'preUI', 'EVENTPULSE-APP'],
        {
          postA: 1,
          postB: 23,
          'postTestC-UI': 456,
          'post10-UI': 7,
          'postD-UI': 89,
          preUI: 10,
          'EVENTPULSE-APP': 11,
        }
      )
    ).toEqual([
      'postA  postB  postTestC-UI  post10-UI  postD-UI  preUI  EVENTPULSE-APP',
      '    1     23           456          7        89     10              11',
    ]);
  });

  it('limits the preUI events histogram to UI queues plus EVENTPULSE-APP', () => {
    for (const queueName of [
      'postA',
      'postB',
      'postTestC-UI',
      'post10-UI',
      'postD-UI',
      'preUI',
      'EVENTPULSE-APP',
    ]) {
      expect(isPreUIEventsSourceQueue(queueName)).toBe(true);
    }

    for (const queueName of ['preA', 'preB', 'postB-preC', 'postD-man']) {
      expect(isPreUIEventsSourceQueue(queueName)).toBe(false);
    }
  });

  it('collects histogram sourceIds only from allowed UI queues', () => {
    expect(
      collectPreUIEventsSourceIds([
        { queueName: 'postA', sourceId: 'from-post-a' },
        { queueName: 'postB', sourceId: 'from-post-b' },
        { queueName: 'postTestC-UI', sourceId: 'from-c-ui' },
        { queueName: 'post10-UI', sourceId: 'from-post10-ui' },
        { queueName: 'postD-UI', sourceId: 'from-d-ui' },
        { queueName: 'preUI', sourceId: 'from-pre-ui' },
        { queueName: 'EVENTPULSE-APP', sourceId: 'from-app' },
        { queueName: 'preA', sourceId: 'from-pre-a' },
        { queueName: 'postB-preC', sourceId: 'from-post-b-prec' },
        { queueName: 'postD-man', sourceId: 'from-post-d-man' },
      ]).sort()
    ).toEqual([
      'from-app',
      'from-c-ui',
      'from-d-ui',
      'from-post-a',
      'from-post-b',
      'from-post10-ui',
      'from-pre-ui',
    ]);
  });
});

describe('dashboard Discovery-UI queue', () => {
  it('registers Discovery-UI as a visible queue', () => {
    expect(getQueueNames()).toContain('Discovery-UI');
    expect(getOperationalQueueNames()).not.toContain('Discovery-UI');
  });

  it('formats promoted discovery sources for the dashboard table', () => {
    expect(
      formatDiscoveryUiRows([
        {
          sourceId: 'example-events',
          sourceCandidateId: 'candidate-1',
          testRunId: 'run-1',
          name: 'Example Events',
          url: 'https://example.test/events',
          city: 'Stockholm',
          promotedAt: '2026-04-27T17:44:00.000Z',
          preferredPath: 'html',
          evidenceSummary: '5 persisted events',
          status: 'promoted_to_sources',
        },
      ])
    ).toEqual([
      'sourceId              path     status               promotedAt',
      'example-events        html     promoted_to_sources  2026-04-27T17:44:00.000Z',
    ]);
  });

  it('skips malformed Discovery-UI rows while keeping valid promoted rows', () => {
    expect(parseDiscoveryUiRows('{bad json\n{"sourceId":"valid-source","preferredPath":"html","status":"promoted_to_sources"}\n')).toEqual([
      {
        sourceId: 'valid-source',
        preferredPath: 'html',
        status: 'promoted_to_sources',
      },
    ]);
  });

  it('summarizes Discovery-UI rows by status', () => {
    expect(
      summarizeDiscoveryUiRows([
        { sourceId: 'a', status: 'promoted_to_sources' },
        { sourceId: 'b', status: 'promoted_to_sources' },
        { sourceId: 'c', status: 'queued_for_review' },
      ])
    ).toEqual([
      'total 3',
      'promoted_to_sources 2',
      'queued_for_review 1',
    ]);
  });
});

describe('dashboard UI promote command', () => {
  it('moves only the requested UI-ready queues into EVENTPULSE-APP', () => {
    expect(getUiPromoteMoveArgs()).toEqual([
      ['move-all', 'postA', 'EVENTPULSE-APP'],
      ['move-all', 'postB', 'EVENTPULSE-APP'],
      ['move-all', 'postTestC-UI', 'EVENTPULSE-APP'],
      ['move-all', 'post10-UI', 'EVENTPULSE-APP'],
      ['move-all', 'postD-UI', 'EVENTPULSE-APP'],
      ['move-all', 'preUI', 'EVENTPULSE-APP'],
    ]);
  });

  it('uses only queues supported by queue-mem.py', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const queueMem = fs.readFileSync(path.join(testDir, '..', 'queue-mem.py'), 'utf8');
    const supportedQueues = new Set(
      [...queueMem.matchAll(/^\s*"([^"]+)":\s*"[^"]+",?$/gm)].map((match) => match[1])
    );

    for (const [, fromQueue, toQueue] of getUiPromoteMoveArgs()) {
      expect(supportedQueues.has(fromQueue), fromQueue).toBe(true);
      expect(supportedQueues.has(toQueue), toQueue).toBe(true);
    }
  });
});

describe('dashboard child process cleanup', () => {
  it('targets the child process group on POSIX so nested E2E children are stopped too', () => {
    expect(getChildProcessKillTarget(1234, 'darwin')).toBe(-1234);
    expect(getChildProcessKillTarget(1234, 'linux')).toBe(-1234);
  });

  it('targets the child process directly on Windows where negative pids are unsupported', () => {
    expect(getChildProcessKillTarget(1234, 'win32')).toBe(1234);
  });
});
