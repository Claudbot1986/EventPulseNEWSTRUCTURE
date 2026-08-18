import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');
const preAQueue = path.join(projectRoot, 'runtime', 'preA-queue.jsonl');

let originalPreA: string | null = null;

afterEach(() => {
  if (originalPreA !== null) {
    writeFileSync(preAQueue, originalPreA, 'utf8');
    originalPreA = null;
  }
});

describe('importRawSources accounting', () => {
  it('does not count a new registry source as new when it is already queued in preA', () => {
    originalPreA = readFileSync(preAQueue, 'utf8');
    const sourceId = `zz-prea-existing-${Date.now()}`;
    const sourceUrl = `https://example.invalid/${sourceId}`;
    const queuedRow = {
      sourceId,
      addedAt: '2026-04-26T00:00:00.000Z',
      addedBy: 'RawSources',
      reason: 'test fixture',
      attempts: 0,
    };
    writeFileSync(preAQueue, `${originalPreA.trimEnd()}\n${JSON.stringify(queuedRow)}\n`, 'utf8');

    const dir = mkdtempSync(path.join(tmpdir(), 'eventpulse-rawsources-'));
    const file = path.join(dir, 'rawsources.md');
    writeFileSync(
      file,
      [
        '| --- | --- | --- | --- | --- | --- |',
        '| Name | URL | City | Category | CollectedAt | Notes |',
        `| ${sourceId} | ${sourceUrl} | Stockholm | test | 2026-04-26 | test |`,
      ].join('\n'),
      'utf8'
    );

    try {
      const output = execFileSync(
        'npx',
        ['--yes', 'tsx', '02-Ingestion/importRawSources.ts', '--dry', '--file', file],
        { cwd: projectRoot, encoding: 'utf8' }
      );

      expect(output).toContain('Nya till registry: 0');
      expect(output).toContain('Redan i preA-queue: 1');
      expect(output).toContain('SKULLE läggas i preA-queue: 0');
      expect(output).toContain('SKULLE skriva källfiler under sources/: 1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
