/**
 * Unit tests for `quarantine_trigger.ts`.
 *
 * Coverage (Hybrid B reparationsprogram):
 *   - Newly crossed cf-source → submitForReview + appendChange
 *   - Already-quarantined-today → skip (idempotent via source-changes.jsonl)
 *   - Cap till maxEventsPerSource (default 10)
 *   - errors-as-data: ingen DB-klient → fel returneras, inget kast
 *   - dryRun=true → inga mutationer
 *
 * Sandbox: EVENTPULSE_SANDBOX_ROOT sätts FÖRE import så pending.jsonl +
 * source-changes.jsonl skrivs till tmp-dir (inte riktiga /02-Ingestion/).
 */

import { describe, expect, it, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const sandbox = mkdtempSync(join(tmpdir(), 'quarantine-trigger-'));
process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;

import { runQuarantineTrigger } from '../tools/quarantine_trigger';
import {
  listPending,
} from '../../02-Ingestion/C-htmlGate/manual-review/index.js';
import {
  appendChange,
  readChanges,
} from '../tools/source_changes';
import type { SupabaseClient } from '@supabase/supabase-js';

function fakeClient(crossedRows: any[], allEventsRows: any[], queryError?: { message: string }): SupabaseClient {
  // Bygger en builder som returnerar rader beroende på frågan.
  // Två distinkta queries:
  //   1. SELECT ... WHERE cf>=2 AND first_broken_at::date=today (cf-crossed)
  //   2. SELECT ... FROM events WHERE source=X (för cap-list)
  let callIdx = 0;
  const makeBuilder = (): any => {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.gte = () => b;
    b.lt = () => b;
    b.order = () => b;
    b.limit = async (n: number) => {
      const result = callIdx === 0
        ? { data: crossedRows, error: queryError ?? null }
        : { data: allEventsRows.slice(0, n), error: null };
      callIdx += 1;
      return result;
    };
    return b;
  };
  return {
    from: () => makeBuilder(),
  } as unknown as SupabaseClient;
}

beforeAll(() => {
  mkdirSync(join(sandbox, '02-Ingestion/C-htmlGate/manual-review'), { recursive: true });
  mkdirSync(join(sandbox, 'runtime/scraping-supervisor'), { recursive: true });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('quarantine_trigger (Hybrid B)', () => {
  it('skickar källa till manual-review när cf KORSAR 2 för första gången', async () => {
    const crossed = [
      {
        id: 'e1',
        source: 'kth',
        title_sv: 'KTH A',
        title_en: null,
        start_time: '2026-09-30T18:00:00Z',
        consecutive_broken_count: 2,
        first_broken_at: '2026-09-26T10:00:00Z',
      },
    ];
    const sourceEvents = [
      { id: 'e1', title_sv: 'KTH A', title_en: null, start_time: '2026-09-30T18:00:00Z' },
      { id: 'e2', title_sv: 'KTH B', title_en: null, start_time: '2026-10-05T19:00:00Z' },
    ];

    const result = await runQuarantineTrigger({
      projectRoot: sandbox,
      _client: fakeClient(crossed, sourceEvents),
      date: '2026-09-26',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.newlyQuarantined).toEqual(['kth']);
    expect(result.reQuarantinedSkipped).toEqual([]);
    expect(result.pendingQueueWrites).toBe(1);

    // Verifiera pending.jsonl
    const pending = listPending(sandbox);
    const kthEntry = pending.find((p) => p.sourceId === 'kth');
    expect(kthEntry).toBeDefined();
    expect(kthEntry?.reasonCode).toBe('link_health_quarantined');
    expect(kthEntry?.note).toContain('cf>=2');
    expect(kthEntry?.payload).toMatchObject({ cf: 2, crossedAt: '2026-09-26' });

    // Verifiera source-changes.jsonl
    const changes = readChanges(sandbox, { sourceId: 'kth' });
    expect(changes.some((c) => c.action === 'mark-review-needed' && c.sourceId === 'kth')).toBe(true);
  });

  it('är idempotent inom samma dag — skippar pending-write om redan quarantine-flaggad', async () => {
    // Förexisterande entry i source-changes.jsonl för samma källa idag.
    appendChange(sandbox, {
      timestamp: new Date().toISOString(),
      date: '2026-09-26',
      sourceId: 'kulturhuset',
      action: 'mark-review-needed',
      before: {},
      after: {},
      rationale: 'pre-existing flag from earlier today',
      evidence: 'cf=2 reached earlier today',
      confidence: 'high',
      appliedBy: 'auto-rule',
      reviewStatus: 'pending-review',
    });

    const crossed = [
      {
        id: 'e1',
        source: 'kulturhuset',
        title_sv: 'Kulturhuset X',
        title_en: null,
        start_time: '2026-09-30T18:00:00Z',
        consecutive_broken_count: 2,
        first_broken_at: '2026-09-26T10:00:00Z',
      },
    ];
    const sourceEvents = [];

    const result = await runQuarantineTrigger({
      projectRoot: sandbox,
      _client: fakeClient(crossed, sourceEvents),
      date: '2026-09-26',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.reQuarantinedSkipped).toEqual(['kulturhuset']);
    expect(result.newlyQuarantined).toEqual([]);
    expect(result.pendingQueueWrites).toBe(0);

    // Inga nya pending entries för kulturhuset (den pre-exist hade vi inte ens skapat via pending)
    const pending = listPending(sandbox);
    const kh = pending.filter((p) => p.sourceId === 'kulturhuset');
    expect(kh).toHaveLength(0);
  });

  it('cappas till maxEventsPerSource (default 10)', async () => {
    const crossed = [
      {
        id: 'e1',
        source: 'bigsource',
        title_sv: 'event 1',
        title_en: null,
        start_time: '2026-09-30T18:00:00Z',
        consecutive_broken_count: 2,
        first_broken_at: '2026-09-26T10:00:00Z',
      },
    ];
    // 50 events tillhör bigsource — cap ska klippa till 10
    const sourceEvents = Array.from({ length: 50 }, (_, i) => ({
      id: `big-${i}`,
      title_sv: `Event ${i + 1}`,
      title_en: null,
      start_time: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T18:00:00Z`,
    }));

    const result = await runQuarantineTrigger({
      projectRoot: sandbox,
      _client: fakeClient(crossed, sourceEvents),
      date: '2026-09-26',
      maxEventsPerSource: 10,
    });

    expect(result.errors).toHaveLength(0);
    expect(result.newlyQuarantined).toEqual(['bigsource']);

    const pending = listPending(sandbox);
    const bigEntry = pending.find((p) => p.sourceId === 'bigsource');
    expect(bigEntry).toBeDefined();
    const payloadEvents = (bigEntry?.payload as any)?.events;
    expect(payloadEvents).toHaveLength(10);
  });

  it('errors-as-data: ingen DB-klient → fel returneras utan att krascha', async () => {
    const result = await runQuarantineTrigger({
      projectRoot: sandbox,
      _client: null,
      date: '2026-09-26',
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/not configured/);
    expect(result.newlyQuarantined).toEqual([]);
  });

  it('dryRun=true muterar inte pending.jsonl eller source-changes.jsonl', async () => {
    const crossed = [
      {
        id: 'e1',
        source: 'dryrunsource',
        title_sv: 'DryRun X',
        title_en: null,
        start_time: '2026-09-30T18:00:00Z',
        consecutive_broken_count: 2,
        first_broken_at: '2026-09-26T10:00:00Z',
      },
    ];
    const sourceEvents = [
      { id: 'e1', title_sv: 'DryRun X', title_en: null, start_time: '2026-09-30T18:00:00Z' },
    ];

    const result = await runQuarantineTrigger({
      projectRoot: sandbox,
      _client: fakeClient(crossed, sourceEvents),
      date: '2026-09-26',
      dryRun: true,
    });

    expect(result.newlyQuarantined).toEqual(['dryrunsource']);
    expect(result.pendingQueueWrites).toBe(0);

    // Inga pending entries, inga source-changes
    const pending = listPending(sandbox);
    expect(pending.filter((p) => p.sourceId === 'dryrunsource')).toHaveLength(0);
    const changes = readChanges(sandbox, { sourceId: 'dryrunsource' });
    expect(changes).toHaveLength(0);
  });
});
