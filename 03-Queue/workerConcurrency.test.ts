import { describe, it, expect } from 'vitest';
import {
  resolveWorkerConcurrency,
  DEFAULT_WORKER_CONCURRENCY,
  MIN_WORKER_CONCURRENCY,
} from './workerConcurrency';

describe('resolveWorkerConcurrency', () => {
  it('tolkar heltal', () => {
    expect(resolveWorkerConcurrency('10')).toBe(10);
    expect(resolveWorkerConcurrency('3')).toBe(3);
    expect(resolveWorkerConcurrency('1')).toBe(MIN_WORKER_CONCURRENCY);
  });

  it('hanterar whitespace runt värdet', () => {
    expect(resolveWorkerConcurrency('  8  ')).toBe(8);
    expect(resolveWorkerConcurrency('\t12\n')).toBe(12);
  });

  it('rundar nedåt mot heltal (aldrig uppåt)', () => {
    expect(resolveWorkerConcurrency('7.9')).toBe(7);
  });

  it('returnerar null för värden som inte går att använda', () => {
    expect(resolveWorkerConcurrency(undefined)).toBeNull();
    expect(resolveWorkerConcurrency(null)).toBeNull();
    expect(resolveWorkerConcurrency('')).toBeNull();
    expect(resolveWorkerConcurrency('   ')).toBeNull();
    expect(resolveWorkerConcurrency('abc')).toBeNull();
    expect(resolveWorkerConcurrency('NaN')).toBeNull();
    expect(resolveWorkerConcurrency('Infinity')).toBeNull();
  });

  it('returnerar null för värden under minimum — negativ kontroll', () => {
    expect(resolveWorkerConcurrency('0')).toBeNull();
    expect(resolveWorkerConcurrency('-5')).toBeNull();
    expect(resolveWorkerConcurrency('0.4')).toBeNull();
  });

  it('standardvärdet är ett heltal som går att köra med', () => {
    expect(Number.isInteger(DEFAULT_WORKER_CONCURRENCY)).toBe(true);
    expect(DEFAULT_WORKER_CONCURRENCY).toBeGreaterThanOrEqual(MIN_WORKER_CONCURRENCY);
  });

  it('gilla värden passerar den negativa kontrollen', () => {
    // Om resolveWorkerConcurrency('0') inte vore null skulle den här
    // kontrollen inte skilja giltiga från ogiltiga värden.
    expect(resolveWorkerConcurrency('5')).not.toBeNull();
    expect(resolveWorkerConcurrency('0')).toBeNull();
  });
});
