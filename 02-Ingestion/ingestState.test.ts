/**
 * IngestState.test.ts — verifierar att state-transitions respekterar union-regler.
 *
 * Stream A.4 (Agent Trust Plan 2026-10-09): "Lägg till tester (lager 2-CI) som
 * verifierar att ogiltiga state-transitions kompilerar-fel".
 *
 * Användning:
 *   npx vitest run 02-Ingestion/ingestState.test.ts
 *
 * Förväntat: alla giltiga transitions OK, ogiltiga kastar InvalidStateTransitionError.
 */

import { describe, it, expect } from 'vitest';
import {
  transition,
  InvalidStateTransitionError,
  type IngestState,
  assertNever,
} from './ingestState';

const NOW = '2026-10-09T10:00:00.000Z';

const raw: IngestState = { kind: 'raw', sourceId: 'k1', receivedAt: NOW };
const validated: IngestState = { kind: 'validated', sourceId: 'k1', validatedAt: NOW, schemaVersion: 1 };
const failed: IngestState = { kind: 'failed', sourceId: 'k1', failedAt: NOW, reason: 'serialization_bug' };
const archived: IngestState = { kind: 'archived', sourceId: 'k1', archivedAt: NOW, ttlDays: 30 };

describe('IngestState transitions (Stream A.4)', () => {
  it('raw → validated: giltig', () => {
    const next = transition(raw, validated);
    expect(next.kind).toBe('validated');
  });

  it('raw → failed: giltig', () => {
    const next = transition(raw, failed);
    expect(next.kind).toBe('failed');
  });

  it('raw → archived: giltig (renounced events)', () => {
    const next = transition(raw, archived);
    expect(next.kind).toBe('archived');
  });

  it('validated → archived: giltig', () => {
    const next = transition(validated, archived);
    expect(next.kind).toBe('archived');
  });

  it('validated → failed: giltig (regression: validerad, sedan upptäckt fel)', () => {
    const next = transition(validated, failed);
    expect(next.kind).toBe('failed');
  });

  it('failed → archived: giltig', () => {
    const next = transition(failed, archived);
    expect(next.kind).toBe('archived');
  });

  it('validated → raw: OGILTIG (inga "rollback till raw")', () => {
    expect(() => transition(validated, raw)).toThrow(InvalidStateTransitionError);
  });

  it('archived → raw: OGILTIG (terminal)', () => {
    expect(() => transition(archived, raw)).toThrow(InvalidStateTransitionError);
  });

  it('archived → validated: OGILTIG (terminal)', () => {
    expect(() => transition(archived, validated)).toThrow(InvalidStateTransitionError);
  });

  it('failed → validated: OGILTIG (failed kan inte bli validerad utan ny runda)', () => {
    expect(() => transition(failed, validated)).toThrow(InvalidStateTransitionError);
  });

  it('archived → failed: OGILTIG (terminal)', () => {
    expect(() => transition(archived, failed)).toThrow(InvalidStateTransitionError);
  });
});

describe('IngestState assertNever', () => {
  it('exhaustiveness: assertNever kastar om fel branche nås', () => {
    // Detta kompilerar-fel om vi lägger till en ny state-kind och inte hanterar den
    // i switch. Här testar vi runtime-beteendet med en cast.
    const unreachable: never = 'forbidden-cast' as never;
    expect(() => assertNever(unreachable)).toThrow();
  });
});
