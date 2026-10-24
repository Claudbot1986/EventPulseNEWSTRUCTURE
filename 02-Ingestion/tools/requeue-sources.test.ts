import { describe, it, expect } from 'vitest';
import {
  buildQueueEntry,
  parseCliArgs,
  planRequeue,
  readJsonl,
  type QueueEntry,
} from './requeue-sources';

describe('buildQueueEntry', () => {
  it('skriver en post i det format C-gatens buildInitialPool läser', () => {
    const entry = buildQueueEntry('historiska-museet', 'test', 1, '2026-10-24T10:00:00.000Z');
    expect(entry.sourceId).toBe('historiska-museet');
    expect(entry.queueName).toBe('postB-preC');
    expect(entry.priority).toBe(3);
    expect(entry.attempt).toBe(1);
    expect(entry.queuedAt).toBe('2026-10-24T10:00:00.000Z');
    expect(entry.queueReason).toBe('requeue: test');
  });

  it('lägger orsaken i queueReason så parseQueueSignals kan läsa den', () => {
    const entry = buildQueueEntry('x', '2 404', 1);
    expect(entry.queueReason).toContain('2 404');
  });
});

describe('readJsonl', () => {
  it('läser giltiga rader och hoppar över trasiga', () => {
    const { mkdtempSync, writeFileSync, rmSync } = require('fs') as typeof import('fs');
    const { tmpdir } = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const dir = mkdtempSync(path.join(tmpdir(), 'ep-requeue-'));
    const file = path.join(dir, 'q.jsonl');
    writeFileSync(file, '{"a":1}\nnot json\n{"b":2}\n', 'utf8');
    const rows = readJsonl<{ a?: number; b?: number }>(file);
    expect(rows).toHaveLength(2);
    expect(rows[0].a).toBe(1);
    expect(rows[1].b).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returnerar tom lista när filen inte finns', () => {
    expect(readJsonl('/tmp/ep-saknas- absolutely.jsonl')).toEqual([]);
  });
});

describe('planRequeue', () => {
  const lookup = {
    getUrl: (id: string) => (id === 'nourl' ? '' : id === 'saknas' ? null : `https://${id}.se`),
    isSkipped: (id: string) => ({ skip: id === 'dead', reason: id === 'dead' ? 'quarantined' : null }),
  };

  it('köar en okänd källa', () => {
    const plan = planRequeue(['ok'], [], lookup);
    expect(plan[0].outcome).toBe('queued');
    expect(plan[0].entry?.sourceId).toBe('ok');
  });

  it('vägrar köa en källa som inte finns i sources/', () => {
    const plan = planRequeue(['saknas'], [], lookup);
    expect(plan[0].outcome).toBe('unknown_source');
    expect(plan[0].entry).toBeUndefined();
  });

  it('vägrar köa en karantänerad källa', () => {
    const plan = planRequeue(['dead'], [], lookup);
    expect(plan[0].outcome).toBe('lifecycle_skipped');
    expect(plan[0].detail).toContain('restore');
  });

  it('vägrar köa en källa utan url', () => {
    const plan = planRequeue(['nourl'], [], lookup);
    expect(plan[0].outcome).toBe('no_url');
  });

  it('köar inte samma källa två gånger', () => {
    const existing: QueueEntry[] = [buildQueueEntry('ok', 'x', 1)];
    const plan = planRequeue(['ok'], existing, lookup);
    expect(plan[0].outcome).toBe('already_queued');
  });

  it('gör köposten till en enda post per källa', () => {
    const plan = planRequeue(['ok', 'ok'], [], lookup);
    expect(plan).toHaveLength(2);
    expect(plan.every(p => p.outcome === 'queued')).toBe(true);
  });
});

describe('parseCliArgs', () => {
  it('parsar --sources med komma', () => {
    const o = parseCliArgs(['--sources', 'a,b , c']);
    expect(o.sourceIds).toEqual(['a', 'b', 'c']);
  });

  it('parsar --sources=form', () => {
    expect(parseCliArgs(['--sources=a,b']).sourceIds).toEqual(['a', 'b']);
  });

  it('parsar --reason', () => {
    expect(parseCliArgs(['--sources=a', '--reason', 'test fix']).reason).toBe('test fix');
  });

  it('parsar --url id=url', () => {
    const o = parseCliArgs(['--sources=a', '--url', 'a=https://ny.se/evenemang']);
    expect(o.urlOverrides.a).toBe('https://ny.se/evenemang');
  });

  it('parsar --dry-run', () => {
    expect(parseCliArgs(['--sources=a', '--dry-run']).dryRun).toBe(true);
  });

  it('deduplikerar käll-idn', () => {
    expect(parseCliArgs(['--sources=a,a,b']).sourceIds).toEqual(['a', 'b']);
  });
});
