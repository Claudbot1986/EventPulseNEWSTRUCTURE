/**
 * Tester för leveranskedjan C → import → drain → databas.
 *
 * Motiv (2026-10-24). Under en hel dag extraherades 10 events för
 * historiska-museet, livrustkammaren och kammarencom — och ingen av dem
 * syntes i Supabase, eftersom importen och drainen bara körs i nattens
 * cron. Kedjan "operatör kör C → events i DB" var alltså obevisad.
 *
 * Testerna bevisar:
 *   1. Planen tar bara med källor som faktiskt har en extraherad fil.
 *   2. Importen körs FÖRE drainen.
 *   3. NEGATIV KONTROLL: en import som misslyckas stoppar kedjan — drainen
 *      körs inte. Kontrollen kan alltså faila.
 *   4. Utan extraherade filer körs varken import eller drain.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  planDelivery,
  deliverExtractedToDatabase,
  hasExtractedFile,
  type CommandRunner,
} from './deliverExtracted.js';

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'deliver-extracted-'));
  mkdirSync(join(root, '03-Queue', '03-extractedevents', 'C'), { recursive: true });
  return root;
}

function writeExtract(root: string, sourceId: string): void {
  writeFileSync(
    join(root, '03-Queue', '03-extractedevents', 'C', `${sourceId}.jsonl`),
    '{"title":"x","date":"2026-10-25"}\n',
    'utf8',
  );
}

/**
 * Registrerar anropen och returnerar en runner med låst exit-kod.
 * Nyckeln är hela argumentlistan — anropet börjar med 'tsx', så
 * args[0] är alltid samma sak.
 */
function recordingRunner(codes: Record<string, number> = {}): {
  run: CommandRunner;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    const key = args.join(' ');
    const match = Object.keys(codes).find((pattern) => key.includes(pattern));
    return match ? codes[match] : 0;
  };
  return { run, calls };
}

describe('deliverExtracted', () => {
  let root: string;

  beforeEach(() => {
    root = makeRepo();
  });

  it('planen tar bara med källor som har en extraherad fil', () => {
    writeExtract(root, 'historiska-museet');
    writeExtract(root, 'livrustkammaren');

    const plan = planDelivery(
      ['historiska-museet', 'livrustkammaren', 'kammarencom'],
      { repoRoot: root },
    );

    expect(plan.sourceIds).toEqual(['historiska-museet', 'livrustkammaren']);
    expect(plan.importArgs).toContain('--source');
    expect(plan.importArgs[plan.importArgs.indexOf('--source') + 1]).toBe(
      'historiska-museet,livrustkammaren',
    );
  });

  it('NEGATIV KONTROLL: en källa utan extraherad fil utesluts', () => {
    writeExtract(root, 'historiska-museet');
    expect(hasExtractedFile(root, 'kammarencom')).toBe(false);
    expect(hasExtractedFile(root, 'historiska-museet')).toBe(true);
  });

  it('importen körs före drainen', async () => {
    writeExtract(root, 'historiska-museet');
    const { run, calls } = recordingRunner();

    const result = await deliverExtractedToDatabase(
      planDelivery(['historiska-museet'], { repoRoot: root }),
      run,
      { repoRoot: root },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0].args).toContain('03-Queue/importToEventPulse.ts');
    expect(calls[1].args).toContain('03-Queue/drainQueue.ts');
    expect(result.imported).toBe(true);
    expect(result.drained).toBe(true);
  });

  it('NEGATIV KONTROLL: misslyckad import stoppar kedjan (drainen körs inte)', async () => {
    writeExtract(root, 'historiska-museet');
    const { run, calls } = recordingRunner({
      '03-Queue/importToEventPulse.ts': 1,
    });

    const result = await deliverExtractedToDatabase(
      planDelivery(['historiska-museet'], { repoRoot: root }),
      run,
      { repoRoot: root },
    );

    expect(calls).toHaveLength(1);
    expect(result.imported).toBe(true);
    expect(result.drained).toBe(false);
    expect(result.importExitCode).toBe(1);
  });

  it('inga extraherade filer → varken import eller drain', async () => {
    const { run, calls } = recordingRunner();

    const result = await deliverExtractedToDatabase(
      planDelivery(['kammarencom'], { repoRoot: root }),
      run,
      { repoRoot: root },
    );

    expect(calls).toHaveLength(0);
    expect(result.imported).toBe(false);
    expect(result.drained).toBe(false);
  });

  it('drain-parametrarna följer flaggorna', async () => {
    writeExtract(root, 'historiska-museet');
    const { run, calls } = recordingRunner();

    await deliverExtractedToDatabase(
      planDelivery(['historiska-museet'], { repoRoot: root, drainMs: 1234, concurrency: 9 }),
      run,
      { repoRoot: root },
    );

    const drain = calls[1].args;
    expect(drain[drain.indexOf('--max-ms') + 1]).toBe('1234');
    expect(drain[drain.indexOf('--concurrency') + 1]).toBe('9');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
});
