/**
 * run-all.test.ts — Verifierar att nattlig runner:
 * - kör alla 10 pilotkällor (5 ursprungliga + 5 Stockholm-förtätning Fas F)
 * - serial ordning (deterministisk)
 * - övriga körs även om en source failar (kedjan ska inte brytas)
 *
 * 2026-10-09 — Val C fas A + fas F (Stockholm-förtätning).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as path from 'node:path';

vi.mock('./runD-pilot', () => ({
  runPilotSource: vi.fn(),
}));

vi.mock('./sourceAllowlist', () => ({
  RENDER_PILOT_SOURCES: new Set([
    'dramaten', 'hallsberg', 'jonkoping', 'djurgarden', 'jarfalla',
    // 2026-10-09 — Fas F: Stockholm-förtätning
    'fotografiska', 'stockholm-jazz-festival', 'thatsup-stockholm-events',
    'visit-stockholm', 'sparvag-city',
  ]),
}));

// Sätt CWD till runtime/d-render-pilot så logPath-lösningen fungerar
process.chdir(path.resolve(__dirname, '../../runtime/d-render-pilot'));

import { runPilotSource } from './runD-pilot';
import { runAllPilots } from './cron/run-all';

const mockRun = runPilotSource as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockRun.mockReset();
});

const successResult = (sid: string) => ({
  sourceId: sid,
  url: `https://${sid}.example.com/`,
  behavior: 'premium-only' as const,
  durationMs: 100,
  renderSuccess: true,
  htmlLength: 1000,
  creditsCharged: 25,
  usedStealthFallback: false,
  adapterHits: [],
  events: [{ title: `${sid}-event`, date: '2026-10-15' }] as any,
  universalEventsFound: 1,
  exitReason: 'ok' as const,
});

const failResult = (sid: string) => ({
  sourceId: sid,
  url: `https://${sid}.example.com/`,
  behavior: 'premium-only' as const,
  durationMs: 50,
  renderSuccess: false,
  renderError: 'mocked failure',
  htmlLength: 0,
  creditsCharged: 0,
  usedStealthFallback: false,
  adapterHits: [],
  events: [],
  universalEventsFound: 0,
  exitReason: 'render-failed' as const,
});

describe('runAllPilots — serial loop', () => {
  it('kör alla 10 pilotkällor och summerar korrekt', async () => {
    // 2026-10-09 — Fas F: 10 källor (5 ursprungliga + 5 Stockholm-förtätning)
    mockRun.mockImplementation(async (sid: string) => successResult(sid));

    const origLog = console.log;
    console.log = () => {};
    try {
      const summary = await runAllPilots();
      expect(summary.results).toHaveLength(10);
      expect(summary.totalEvents).toBe(10);
      expect(summary.totalCredits).toBe(250);
      expect(summary.successful).toBe(10);
      expect(mockRun).toHaveBeenCalledTimes(10);
    } finally {
      console.log = origLog;
    }
  });

  it('fortsätter om en source failar (kedjan ska inte brytas)', async () => {
    mockRun.mockImplementation(async (sid: string) => {
      if (sid === 'hallsberg') return failResult(sid);
      return successResult(sid);
    });

    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
      const summary = await runAllPilots();
      expect(summary.results).toHaveLength(10);
      expect(summary.successful).toBe(9);
      expect(summary.totalEvents).toBe(9);
      expect(mockRun).toHaveBeenCalledTimes(10);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }
  });

  it('serial ordning är deterministisk (sort)', async () => {
    const order: string[] = [];
    mockRun.mockImplementation(async (sid: string) => {
      order.push(sid);
      return successResult(sid);
    });

    const origLog = console.log;
    console.log = () => {};
    try {
      await runAllPilots();
      expect(order).toEqual([
        'djurgarden', 'dramaten', 'fotografiska', 'hallsberg', 'jarfalla',
        'jonkoping', 'sparvag-city', 'stockholm-jazz-festival',
        'thatsup-stockholm-events', 'visit-stockholm',
      ]);
    } finally {
      console.log = origLog;
    }
  });
});
