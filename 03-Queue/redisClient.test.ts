/**
 * redisClient.test.ts — enhetstester för den centrala Redis-optionen.
 *
 * Dessa tester fångar den exakta regressionen som orsakade
 * två-timmars-hängningen 2026-10-26:
 *   - `enableOfflineQueue` måste vara false (annars ligger kommandon i
 *     offline-kön och väntar i evighet),
 *   - producentens `maxRetriesPerRequest` måste vara 1 (fail-fast),
 *   - workerns optioner får INTE sätta maxRetriesPerRequest (BullMQ
 *     tvingar det till null på blocking-anslutningen och kastar vid
 *     instans-varian),
 *   - REDIS_URL måste faktiskt användas.
 */

import { describe, it, expect } from 'vitest';
import {
  producerOptions,
  workerOptions,
  resolveRedisUrl,
  giveUpAfter,
  DEFAULT_REDIS_URL,
  REDIS_CONNECT_TIMEOUT_MS,
  withRedisTimeout,
} from './redisClient.mjs';

describe('resolveRedisUrl', () => {
  it('använder REDIS_URL när den finns', () => {
    expect(resolveRedisUrl({ REDIS_URL: 'redis://example.test:6380' } as NodeJS.ProcessEnv)).toBe(
      'redis://example.test:6380',
    );
  });

  it('faller tillbaka på loopback när REDIS_URL saknas', () => {
    expect(resolveRedisUrl({} as NodeJS.ProcessEnv)).toBe(DEFAULT_REDIS_URL);
  });

  it('faller tillbaka på loopback när REDIS_URL är tom', () => {
    expect(resolveRedisUrl({ REDIS_URL: '   ' } as NodeJS.ProcessEnv)).toBe(DEFAULT_REDIS_URL);
  });
});

describe('producerOptions', () => {
  const options = producerOptions({ REDIS_URL: 'redis://localhost:6379' } as NodeJS.ProcessEnv);

  it('sätter enableOfflineQueue=false (annars hänger kommandon i offline-kön)', () => {
    expect(options.enableOfflineQueue).toBe(false);
  });

  it('sätter maxRetriesPerRequest=1 (fail-fast vid uttag)', () => {
    expect(options.maxRetriesPerRequest).toBe(1);
  });

  it('har en connectTimeout', () => {
    expect(options.connectTimeout).toBe(REDIS_CONNECT_TIMEOUT_MS);
  });

  it('sätter inte tls för en vanlig redis://-URL', () => {
    expect(options.tls).toBeUndefined();
  });

  it('sätter tls för en rediss://-URL', () => {
    const tlsOptions = producerOptions({ REDIS_URL: 'rediss://localhost:6379' } as NodeJS.ProcessEnv);
    expect(tlsOptions.tls).toEqual({});
  });

  it('retryStrategy ger upp efter maxAttempts försök', () => {
    const strategy = options.retryStrategy as (times: number) => number | null;
    expect(strategy(1)).toBe(200);
    expect(strategy(5)).toBe(1000);
    // 6 > 5 → null = ge upp.
    expect(strategy(6)).toBeNull();
  });
});

describe('workerOptions', () => {
  const options = workerOptions({ REDIS_URL: 'redis://localhost:6379' } as NodeJS.ProcessEnv);

  it('sätter INTE maxRetriesPerRequest (BullMQ tvingar det till null)', () => {
    expect('maxRetriesPerRequest' in options).toBe(false);
  });

  it('sätter enableOfflineQueue=false', () => {
    expect(options.enableOfflineQueue).toBe(false);
  });

  it('har en connectTimeout', () => {
    expect(options.connectTimeout).toBe(REDIS_CONNECT_TIMEOUT_MS);
  });
});

describe('giveUpAfter', () => {
  it('returnerar null efter maxAttempts', () => {
    const strategy = giveUpAfter(3);
    expect(strategy(3)).toBe(600);
    expect(strategy(4)).toBeNull();
  });

  it('växer aldrig över 2 s mellan försöken', () => {
    const strategy = giveUpAfter(100);
    expect(strategy(99)).toBeLessThanOrEqual(2000);
  });
});

describe('withRedisTimeout', () => {
  it('returnerar värdet när anropet lyckas', async () => {
    const result = await withRedisTimeout(async () => 'ok', 1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('ok');
  });

  it('returnerar felet i stället för att kasta', async () => {
    const result = await withRedisTimeout(async () => {
      throw new Error('boom');
    }, 1000);
    expect(result.ok).toBe(false);
    expect((result.error as Error).message).toBe('boom');
  });

  it('ger timeout med ETIMEDOUT', async () => {
    const result = await withRedisTimeout(
      () => new Promise((resolve) => setTimeout(resolve, 500)),
      50,
    );
    expect(result.ok).toBe(false);
    expect((result.error as { code?: string }).code).toBe('ETIMEDOUT');
  });
});
