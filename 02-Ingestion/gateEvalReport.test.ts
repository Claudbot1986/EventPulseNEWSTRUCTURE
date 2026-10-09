/**
 * gateEvalReport.test.ts — Stream A.1 (Agent Trust Plan 2026-10-09).
 *
 * Verifierar att:
 *  - Tom eval ger en giltig (icke-tom) rapport med stopReason=no-sources-available.
 *  - Räkning av validated/failed/archived är korrekt.
 *  - failTypeDistribution räknas per FailureReason (spegling av C-testRig).
 *  - before/after-jämförelse ger rätt decision (keep/revert/unclear).
 *  - nextStep ger konkreta rekommendationer, inte vag "boosta X".
 *
 * Använder IngestState-typer rakt igenom — ingen parallell strängtypar.
 *
 * Run:  npx vitest run 02-Ingestion/gateEvalReport.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  formatGateReport,
  compareGateReports,
  type GateEvalInput,
  type SourceEvalRow,
} from './gateEvalReport';
import { type IngestState } from './ingestState';

const NOW = '2026-10-09T10:00:00.000Z';

function row(sourceId: string, state: IngestState, events = 0): SourceEvalRow {
  return { sourceId, finalState: state, eventsFound: events };
}

function validatedRow(id: string, events: number): SourceEvalRow {
  return row(id, { kind: 'validated', sourceId: id, validatedAt: NOW, schemaVersion: 1 }, events);
}

function failedRow(id: string, reason: IngestState extends { kind: 'failed'; reason: infer R } ? R : never): SourceEvalRow {
  return row(id, { kind: 'failed', sourceId: id, failedAt: NOW, reason });
}

function archivedRow(id: string): SourceEvalRow {
  return row(id, { kind: 'archived', sourceId: id, archivedAt: NOW, ttlDays: 30 });
}

const baseInput: GateEvalInput = {
  gateId: 'A-to-B',
  batchId: 'batch-2026-10-09-A',
  roundNumber: 1,
  rows: [],
  hypothesis: null,
  changeApplied: null,
  whyGeneral: null,
};

describe('formatGateReport', () => {
  it('tom eval: giltig rapport, stopReason=no-sources-available', () => {
    const md = formatGateReport(baseInput);
    expect(md).toContain('| sourcesIn | 0 |');
    expect(md).toContain('| stopReason | no-sources-available |');
    expect(md).toContain('Kontrollera gate-input');
  });

  it('räknar validated korrekt', () => {
    const md = formatGateReport({
      ...baseInput,
      rows: [validatedRow('a', 5), validatedRow('b', 3), failedRow('c', 'parse_error')],
    });
    expect(md).toContain('| validated | 2 |');
    expect(md).toContain('| failed | 1 |');
    expect(md).toContain('| totalEventsExtracted | 8 |');
  });

  it('räknar failTypeDistribution per FailureReason', () => {
    const md = formatGateReport({
      ...baseInput,
      rows: [
        failedRow('a', 'parse_error'),
        failedRow('b', 'parse_error'),
        failedRow('c', 'upstream_timeout'),
        validatedRow('d', 1),
      ],
    });
    expect(md).toContain('- parse_error: 2');
    expect(md).toContain('- upstream_timeout: 1');
  });

  it('stopReason=baseline när changeApplied är null', () => {
    const md = formatGateReport({ ...baseInput, rows: [validatedRow('a', 1)] });
    expect(md).toContain('| stopReason | baseline |');
  });

  it('stopReason=max-rounds-reached på roundNumber=3', () => {
    const md = formatGateReport({
      ...baseInput,
      roundNumber: 3,
      changeApplied: 'test',
      rows: [validatedRow('a', 1)],
    });
    expect(md).toContain('| stopReason | max-rounds-reached |');
  });

  it('inkluderar hypothesis/changeApplied/whyGeneral sektioner', () => {
    const md = formatGateReport({
      ...baseInput,
      rows: [validatedRow('a', 1)],
      hypothesis: 'A hittar för få candidates',
      changeApplied: 'Bredda path-inspektion',
      whyGeneral: 'Påverkar 5+ sajter oberoende av domän',
    });
    expect(md).toContain('### hypothesis');
    expect(md).toContain('A hittar för få candidates');
    expect(md).toContain('### changeApplied');
    expect(md).toContain('Bredda path-inspektion');
    expect(md).toContain('### whyGeneral');
    expect(md).toContain('5+ sajter');
  });

  it('nextStep ger konkret förslag vid 0 events + alla fail', () => {
    const md = formatGateReport({
      ...baseInput,
      rows: [
        failedRow('a', 'parse_error'),
        failedRow('b', 'parse_error'),
        failedRow('c', 'upstream_timeout'),
      ],
    });
    expect(md).toContain('0 events, alla fail');
    expect(md).toMatch(/parse_error \(2 st\)/);
  });

  it('nextStep rekommenderar ny hypotes vid kvarvarande fail', () => {
    const md = formatGateReport({
      ...baseInput,
      rows: [validatedRow('a', 5), failedRow('b', 'parse_error')],
    });
    expect(md).toContain('1 fail kvar');
    expect(md).toContain('ny hypotes');
  });

  it('raw-state räknas inte som slut-state (ej validated/failed/archived)', () => {
    const md = formatGateReport({
      ...baseInput,
      rows: [
        validatedRow('a', 1),
        row('b', { kind: 'raw', sourceId: 'b', receivedAt: NOW }),
      ],
    });
    expect(md).toContain('| validated | 1 |');
    expect(md).toContain('| failed | 0 |');
    expect(md).toContain('| archived | 0 |');
  });
});

describe('compareGateReports', () => {
  it('decision=keep när fler validated OCH fler events', () => {
    const before: GateEvalInput = {
      ...baseInput,
      rows: [validatedRow('a', 5)],
    };
    const after: GateEvalInput = {
      ...baseInput,
      rows: [validatedRow('a', 5), validatedRow('b', 3)],
    };
    const diff = compareGateReports(before, after);
    expect(diff).toContain('| validated | 1 | 2 | +1 |');
    expect(diff).toContain('| totalEvents | 5 | 8 | +3 |');
    expect(diff).toContain('keep');
  });

  it('decision=revert när färre validated', () => {
    const before: GateEvalInput = {
      ...baseInput,
      rows: [validatedRow('a', 5), validatedRow('b', 3)],
    };
    const after: GateEvalInput = {
      ...baseInput,
      rows: [validatedRow('a', 5)],
    };
    const diff = compareGateReports(before, after);
    expect(diff).toContain('revert');
  });

  it('decision=unclear när oförändrat', () => {
    const same = [validatedRow('a', 5)];
    const before: GateEvalInput = { ...baseInput, rows: same };
    const after: GateEvalInput = { ...baseInput, rows: same };
    const diff = compareGateReports(before, after);
    expect(diff).toContain('unclear');
    expect(diff).toContain('omtolka hypotes');
  });

  it('signed-helper: negativa tal får minus-tecken', () => {
    const before: GateEvalInput = { ...baseInput, rows: [validatedRow('a', 5), validatedRow('b', 3)] };
    const after: GateEvalInput = { ...baseInput, rows: [validatedRow('a', 5)] };
    const diff = compareGateReports(before, after);
    expect(diff).toContain('-1');
  });
});
