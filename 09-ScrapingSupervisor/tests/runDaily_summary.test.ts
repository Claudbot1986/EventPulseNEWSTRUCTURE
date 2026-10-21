/**
 * runDaily_summary.test.ts — verifierar att runDaily extraherar riktiga siffror
 * från subprocess-stdout istället för att skriva 0/0/0/0 till ingestion_runs.jsonl.
 *
 * Loggen `daily-2026-10-18.log` har detta mönster:
 *   [step:importToEventPulse]   [267/270] visit-vasteras: 0 events
 *   [step:importToEventPulse]   KLAR  │  1215 events till bullmq  │  0 errors
 *
 * Vi vill ha:
 *   sourcesAttempted = 270  (sista N i sista [N/M])
 *   totalEventsFound = 1215 (från KLAR-raden)
 */
import { describe, it, expect } from 'vitest';
import { parseRunStats } from '../runDaily';

describe('parseRunStats', () => {
  it('extracts sourcesAttempted + totalEventsFound from importToEventPulse output', () => {
    const stdout = `
[2026-10-18T02:00:28.175Z] [step:importToEventPulse]   [1/270] a-source: 5 events
[2026-10-18T02:00:28.175Z] [step:importToEventPulse]   [2/270] b-source: 3 events
[2026-10-18T02:00:28.175Z] [step:importToEventPulse]   [3/270] c-source: 0 events
[2026-10-18T02:00:28.175Z] [step:importToEventPulse]   [4/270] d-source: 1 events
[2026-10-18T02:00:28.175Z] [step:importToEventPulse]   [267/270] visit-vasteras: 0 events
[2026-10-18T02:00:28.176Z] [step:importToEventPulse]   [268/270] visithelsingborg: 0 events
[2026-10-18T02:00:28.176Z] [step:importToEventPulse]   [269/270] visualiseringscenter: 0 events
[2026-10-18T02:00:28.176Z] [step:importToEventPulse]   [270/270] waldemarsudde: 0 events
[2026-10-18T02:00:28.176Z] [step:importToEventPulse]   ═══════════════════════════════════════════════════════════
[2026-10-18T02:00:28.176Z] [step:importToEventPulse]     KLAR  │  1215 events till bullmq  │  0 errors
[2026-10-18T02:00:28.176Z] [step:importToEventPulse]   ═══════════════════════════════════════════════════════════
`;
    const stats = parseRunStats(stdout);
    expect(stats.sourcesAttempted).toBe(270);
    expect(stats.totalEventsFound).toBe(1215);
  });

  it('returns zeros when no recognised patterns present (graceful fallback)', () => {
    const stdout = `random log output without importToEventPulse\n`;
    const stats = parseRunStats(stdout);
    expect(stats.sourcesAttempted).toBe(0);
    expect(stats.totalEventsFound).toBe(0);
  });

  it('handles the last [N/M] as the source of truth (largest N seen)', () => {
    // If multiple steps report different totals (e.g. importToEventPulse + supervisor),
    // the highest denominator wins.
    const stdout = `
[step:supervisor]     totals: 76 working / 256 dead / 0 untouched
[step:importToEventPulse]   [5/270] x: 0 events
[step:importToEventPulse]   [270/270] y: 0 events
[step:importToEventPulse]     KLAR  │  1215 events till bullmq
`;
    const stats = parseRunStats(stdout);
    expect(stats.sourcesAttempted).toBe(270);
    expect(stats.totalEventsFound).toBe(1215);
  });
});
