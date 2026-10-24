/**
 * Regressionstester för C-gatens batch-nummerering och resume-regel.
 *
 * 2026-10-24 — båda testerna fångar fel som faktiskt inträffade:
 *   1. nextBatchNumber returnerade ALLTID 1 (`.test(d)?.[1]` → undefined),
 *      vilket gjorde att varje operatörskörning resume:ade batch-1:s
 *      pool-state och körde ingen källa.
 *   2. den programmatiska ingången resume:ade en gammal pool-state även
 *      när operatören bad om en omkörning med explicita källor.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { nextBatchNumber } from './batchNumber.js';
import { shouldResumePoolState } from './run-dynamic-pool.js';

describe('nextBatchNumber', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ep-batchnum-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returnerar 1 när katalogen inte finns', () => {
    expect(nextBatchNumber(path.join(dir, 'missing'))).toBe(1);
  });

  it('returnerar 1 när katalogen är tom', () => {
    expect(nextBatchNumber(dir)).toBe(1);
  });

  it('REGRESSION: tar högsta batch-nummer + 1, inte 1', () => {
    // Detta var felet: `.test(d)?.[1]` gav undefined → max 0 → alltid 1.
    mkdirSync(path.join(dir, 'batch-1017'));
    mkdirSync(path.join(dir, 'batch-3'));
    expect(nextBatchNumber(dir)).toBe(1018);
  });

  it('ignorerar kataloger som inte är batch-N', () => {
    mkdirSync(path.join(dir, 'batch-report-template.md'));
    writeFileSync(path.join(dir, 'batch-state.jsonl'), '{}\n');
    mkdirSync(path.join(dir, 'batch-7'));
    expect(nextBatchNumber(dir)).toBe(8);
  });

  it('hoppar över ett nummer som redan har en pool-state', () => {
    mkdirSync(path.join(dir, 'batch-4'));
    mkdirSync(path.join(dir, 'batch-5'), { recursive: true });
    writeFileSync(path.join(dir, 'batch-5', 'pool-state.json'), '{}');
    // Högsta är 5 → 6 vore ledigt. Men om 6 finns med pool-state → 7.
    mkdirSync(path.join(dir, 'batch-6'), { recursive: true });
    writeFileSync(path.join(dir, 'batch-6', 'pool-state.json'), '{}');
    expect(nextBatchNumber(dir)).toBe(7);
  });
});

describe('shouldResumePoolState', () => {
  it('resume:ar ingen pool-state när explicita källor anges', () => {
    expect(
      shouldResumePoolState({ explicitSources: ['riksarkivet'], poolStateExists: true })
    ).toBe(false);
  });

  it('resume:ar pool-state när inga explicita källor anges', () => {
    expect(shouldResumePoolState({ explicitSources: [], poolStateExists: true })).toBe(true);
  });

  it('resume:ar inte när det inte finns någon pool-state', () => {
    expect(shouldResumePoolState({ explicitSources: [], poolStateExists: false })).toBe(false);
  });
});
