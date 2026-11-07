/**
 * Regressionstester för källhälsans klassificering.
 *
 * Bakgrund (2026-11-07): dashboardens "failed"-bucket innehöll 122 av 163
 * källor, men 121 av dem hade successRate=1 och consecutiveFailures=0 —
 * de hade ALDRIG haft ett fel. Orsaken: `classifyHealth` returnerade 'failed'
 * när lastSuccess var äldre än 7 dagar. "Failed" betydde alltså "inte körd på
 * >7 dagar", inte "fel".
 *
 * Andra felet: `lastError` fylldes från `lastRoutingReason` (en routingnotering,
 * t.ex. "C-htmlGate: 21 events") — 106 av 163 rader bar alltså framgångsmeddelanden
 * som felmeddelanden. Det FAKTA felet ligger i fältet `lastError`.
 *
 * Dessa tester låser den nya semantiken:
 *   - FEL   → 'failed'   (status='fail' | consecutiveFailures>0 | lastError)
 *   - GAMLA → 'stale'    (lastSuccess >7 dagar sedan, inget fel)
 *   - NYA   → 'healthy'  (≤24 h), 'irregular' (1-7 d), 'never_run' (aldrig körd)
 *   - TYSKT TOM → outcome 'empty' (kördes men 0 events)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  collectSourceHealth,
  classifyFreshness,
  classifyOutcome,
  classifySourceHealth,
} from './server';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

let tmpRoot: string;
const NOW = Date.parse('2026-11-07T04:00:00.000Z');

function hoursAgo(h: number): string {
  return new Date(NOW - h * 3600_000).toISOString();
}

function writeStatusRows(rows: Array<Record<string, unknown>>): void {
  mkdirSync(resolve(tmpRoot, 'runtime'), { recursive: true });
  writeFileSync(
    resolve(tmpRoot, 'runtime/sources_status.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf-8',
  );
}

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'source-health-test-'));
  mkdirSync(resolve(tmpRoot, 'runtime'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('classifySourceHealth — FEL och GAMMALHET är olika saker', () => {
  it('kallar en källa med gammal lastSuccess "stale", inte "failed"', () => {
    const status = classifySourceHealth(
      { status: 'success', consecutiveFailures: 0, lastError: null },
      24 * 30,
    );
    expect(status).toBe('stale');
  });

  it('kallar en källa med riktigt fel "failed" även om den kördes nyligen', () => {
    const status = classifySourceHealth(
      { status: 'fail', consecutiveFailures: 1, lastError: 'C-htmlGate: FETCH_ERROR — fetch error:' },
      1,
    );
    expect(status).toBe('failed');
  });

  it('kallar en källa "failed" på consecutiveFailures även utan status=fail', () => {
    const status = classifySourceHealth(
      { status: 'success', consecutiveFailures: 2, lastError: null },
      1,
    );
    expect(status).toBe('failed');
  });

  it('kallar en källa "failed" när lastError finns', () => {
    const status = classifySourceHealth(
      { status: 'success', consecutiveFailures: 0, lastError: 'boom' },
      1,
    );
    expect(status).toBe('failed');
  });

  it('kallar en aldrig körd källa "never_run" (aldrig "failed")', () => {
    const status = classifySourceHealth(
      { status: 'success', consecutiveFailures: 0, lastError: null },
      null,
    );
    expect(status).toBe('never_run');
  });

  it('kallar en färsk källa "healthy" och en 3 dagar gammal "irregular"', () => {
    expect(
      classifySourceHealth({ status: 'success', consecutiveFailures: 0, lastError: null }, 2),
    ).toBe('healthy');
    expect(
      classifySourceHealth({ status: 'success', consecutiveFailures: 0, lastError: null }, 72),
    ).toBe('irregular');
  });
});

describe('classifyFreshness / classifyOutcome', () => {
  it('färskhet: fresh ≤24h, recent ≤7d, stale >7d, never saknar lastSuccess', () => {
    expect(classifyFreshness(2)).toBe('fresh');
    expect(classifyFreshness(72)).toBe('recent');
    expect(classifyFreshness(24 * 30)).toBe('stale');
    expect(classifyFreshness(null)).toBe('never');
  });

  it('utfall: failed vid fel, empty vid 0 events, ok annars', () => {
    expect(classifyOutcome({ status: 'fail', consecutiveFailures: 1, lastError: 'x', lastEventsFound: 0 })).toBe('failed');
    expect(classifyOutcome({ status: 'success', consecutiveFailures: 0, lastError: null, lastEventsFound: 0 })).toBe('empty');
    expect(classifyOutcome({ status: 'success', consecutiveFailures: 0, lastError: null, lastEventsFound: 12 })).toBe('ok');
    expect(classifyOutcome({ status: 'success', consecutiveFailures: 0, lastError: null, lastEventsFound: null })).toBe('ok');
  });
});

describe('collectSourceHealth — riktiga raddata', () => {
  it('behandlar EN routingnotering som fel — det fanns 106 sådana rader', () => {
    writeStatusRows([
      {
        sourceId: 'konserthuset-2',
        status: 'success',
        lastSuccess: hoursAgo(1),
        lastRun: hoursAgo(1),
        lastRoutingReason: 'C-htmlGate: 21 events',
        consecutiveFailures: 0,
        attempts: 5,
        lastEventsFound: 21,
      },
    ]);

    const report = collectSourceHealth(tmpRoot, NOW);
    const row = report.sources[0];

    expect(row.status).toBe('healthy');
    expect(row.lastError).toBeNull();
    expect(row.lastRoutingReason).toBe('C-htmlGate: 21 events');
    expect(row.lastErrorCategory).toBeNull();
    expect(report.summary.failed).toBe(0);
    expect(report.errorCategories).toEqual({});
  });

  it('plockar upp det FAKTA lastError-fältet när ett fel finns', () => {
    writeStatusRows([
      {
        sourceId: 'cms-konserthuset-se-en-programme-calendar',
        status: 'fail',
        lastSuccess: null,
        lastRun: hoursAgo(50),
        lastError: 'C-htmlGate: FETCH_ERROR — fetch error:',
        lastRoutingReason: 'C-htmlGate: FETCH_ERROR — fetch error:',
        consecutiveFailures: 1,
        attempts: 3,
        lastEventsFound: 0,
      },
    ]);

    const report = collectSourceHealth(tmpRoot, NOW);
    const row = report.sources[0];

    expect(row.status).toBe('failed');
    expect(row.outcome).toBe('failed');
    expect(row.lastError).toBe('C-htmlGate: FETCH_ERROR — fetch error:');
    expect(row.lastErrorCategory).not.toBeNull();
    expect(report.summary.failed).toBe(1);
    expect(report.summary.eventsZero).toBe(1);
  });

  it('räknar gammalhet som stale och aldrig-körd som never_run — inte failed', () => {
    writeStatusRows([
      { sourceId: 'gammal', status: 'success', lastSuccess: hoursAgo(24 * 30), consecutiveFailures: 0, attempts: 3, lastEventsFound: 10 },
      { sourceId: 'ny', status: 'success', lastSuccess: hoursAgo(2), consecutiveFailures: 0, attempts: 3, lastEventsFound: 4 },
      { sourceId: 'aldrig', status: 'success', lastSuccess: null, lastRun: hoursAgo(5), consecutiveFailures: 0, attempts: 1, lastEventsFound: 0 },
    ]);

    const report = collectSourceHealth(tmpRoot, NOW);

    expect(report.summary.failed).toBe(0);
    expect(report.summary.stale).toBe(1);
    expect(report.summary.healthy).toBe(1);
    expect(report.summary.neverRun).toBe(1);
    expect(report.summary.silentEmpty).toBe(1);
    expect(report.summary.fresh).toBe(1);
    expect(report.summary.eventsTotal).toBe(14);
    expect(report.summary.eventsZero).toBe(1);
  });

  it('buckets summerar till totalen (inga rader försvinner mellan bucketarna)', () => {
    writeStatusRows([
      { sourceId: 'a', status: 'success', lastSuccess: hoursAgo(1), consecutiveFailures: 0, attempts: 1, lastEventsFound: 3 },
      { sourceId: 'b', status: 'success', lastSuccess: hoursAgo(72), consecutiveFailures: 0, attempts: 1, lastEventsFound: 3 },
      { sourceId: 'c', status: 'success', lastSuccess: hoursAgo(400), consecutiveFailures: 0, attempts: 1, lastEventsFound: 3 },
      { sourceId: 'd', status: 'fail', lastSuccess: null, lastError: 'boom', consecutiveFailures: 1, attempts: 1, lastEventsFound: 0 },
      { sourceId: 'e', status: 'success', lastSuccess: hoursAgo(2), consecutiveFailures: 0, attempts: 1, lastEventsFound: 0 },
    ]);

    const s = collectSourceHealth(tmpRoot, NOW).summary;

    expect(s.total).toBe(5);
    expect(s.healthy + s.irregular + s.stale + s.neverRun + s.failed).toBe(5);
  });

  it('tom fil → inga fel, noll summeringar (ingen krasch)', () => {
    writeStatusRows([]);
    const report = collectSourceHealth(tmpRoot, NOW);
    expect(report.summary.total).toBe(0);
    expect(report.summary.failed).toBe(0);
    expect(report.sources).toEqual([]);
  });
});
