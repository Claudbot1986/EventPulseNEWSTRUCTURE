/**
 * Kö mot en DÖD Redis — 2026-10-28.
 *
 * Det här är beviset på att nattet 26 okt inte kan upprepas:
 *
 *   - 583 KB logg (en rad per event, plus åtta rader stacktrace per fel)
 *   - exit 0 = "klart", fast ingenting kom in
 *
 * Testet kör den RIKTIGA kodenvägen: en riktig BullMQ-kö mot en port där
 * inget lyssnar. Inget mockas — add() rejectar för att servern inte
 * svarar, precis som nattet.
 *
 * Negativa kontroller:
 *   - ingen rå stacktrace i loggen (det var 8 rader per fel)
 *   - högst MAX_SAMPLES provrader (loggen får inte växa med antalet fel)
 *   - exit 69 när inget kunde köas
 */

import { describe, it, expect } from 'vitest';
import { createBullQueue } from '../../03-Queue/redisClient.mjs';
import { createQueueErrorTracker, MAX_SAMPLES } from './queue-errors.mjs';

/** Död port — inget lyssnar där. */
const DEAD_REDIS_URL = 'redis://127.0.0.1:6399';

/** Hur många events vi försöker köa. */
const ATTEMPTS = 50;

describe('kö mot död Redis', () => {
  it('rejectar, rapporterar ärligt och håller loggen takad', async () => {
    const originalUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = DEAD_REDIS_URL;

    const stderr: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    };

    const tracker = createQueueErrorTracker();
    let queued = 0;
    try {
      const queue = createBullQueue('test_dead_redis');
      for (let i = 0; i < ATTEMPTS; i += 1) {
        try {
          await queue.add(`job-${i}`, {
            title: 'testevent',
            start_time: '2026-01-01T00:00:00.000Z',
          } as never);
          queued += 1;
        } catch (error) {
          tracker.record(error, `job-${i}`);
        }
      }
      tracker.printSummary('test');
      await queue.close();
    } finally {
      console.error = originalError;
      if (originalUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = originalUrl;
    }

    // Inget kom in — men skriptet SÄGER det.
    expect(queued).toBe(0);
    expect(tracker.count).toBe(ATTEMPTS);
    expect(tracker.errorClass).toBe('transport');
    expect(tracker.exitCode(queued)).toBe(69);

    // Loggen är takad: högst MAX_SAMPLES provrader + rubrik + rest-rad.
    const provrader = stderr.filter((line) => line.trim().startsWith('- '));
    expect(provrader.length).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(stderr.join('\n')).toContain('50 köfel');

    // NIGATIV KONTROLL — ingen rå stacktrace. Före fixen skrev BullMQ:s
    // fel-event åtta rader stacktrace per fel (56 rader för ett enda add).
    expect(stderr.join('\n')).not.toContain('at TCPConnectWrap');
    expect(stderr.join('\n')).not.toContain('errno:');
  });
});
