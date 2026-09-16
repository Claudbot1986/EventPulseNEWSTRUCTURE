/**
 * E2E lifecycle tests for source lifecycle integration.
 *
 * Covers the two asserts from plan §H:
 *   1. test_quarantined_source_is_skipped_by_all_gates
 *      — a source moved into sources/_quarantine/INDEX.json is skipped by
 *        quarantineGuard.isSkipped() — same code path used by all 4 gates.
 *   2. test_manual_review_resolver_writes_resolved
 *      — submitForReview() + resolvePending('quarantine') writes a row to
 *        resolved.jsonl AND moves the source to sources/_quarantine/.
 *
 * Sandbox: EVENTPULSE_SANDBOX_ROOT set BEFORE import so all paths are isolated.
 */

import { describe, expect, it, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Sätt ENV FÖRE import av guards.
const sandbox = mkdtempSync(join(tmpdir(), 'lifecycle-e2e-'));
process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;

import { isSkipped } from './quarantineGuard.js';
import * as qg from './quarantineGuard.js';
import * as mr from '../C-htmlGate/manual-review/index.js';

beforeAll(() => {
  mkdirSync(join(sandbox, 'sources'), { recursive: true });
  mkdirSync(join(sandbox, 'sources/_quarantine'), { recursive: true });
  mkdirSync(join(sandbox, 'sources/_retired'), { recursive: true });
  mkdirSync(join(sandbox, 'runtime'), { recursive: true });
  mkdirSync(join(sandbox, '02-Ingestion/C-htmlGate/manual-review'), { recursive: true });
});

afterAll(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* sandbox cleanup failed — non-fatal */ }
});

function resetSandbox() {
  writeFileSync(join(sandbox, 'sources/_quarantine/INDEX.json'), '[]\n');
  writeFileSync(join(sandbox, 'sources/_retired/INDEX.json'), '[]\n');
  writeFileSync(join(sandbox, '02-Ingestion/C-htmlGate/manual-review/pending.jsonl'), '');
  writeFileSync(join(sandbox, '02-Ingestion/C-htmlGate/manual-review/resolved.jsonl'), '');
  // Clear sources dir
  for (const f of readdirSync(join(sandbox, 'sources'))) {
    if (f.endsWith('.jsonl')) unlinkSync(join(sandbox, 'sources', f));
  }
}

function freshSource(testName: string): string {
  const sourceId = `${testName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceFile = join(sandbox, 'sources', `${sourceId}.jsonl`);
  writeFileSync(
    sourceFile,
    JSON.stringify({ id: sourceId, url: `https://${testName}.example.com`, name: sourceId, type: 'venue', city: 'Stockholm', discoveredAt: '2026-09-10' }) + '\n',
    'utf8',
  );
  return sourceId;
}

function writeQuarantineIndex(entries: Array<{ sourceId: string; url?: string; reasonCode?: string; note?: string }>) {
  const idx = entries.map(e => ({
    sourceId: e.sourceId,
    url: e.url ?? `https://${e.sourceId}.example.com`,
    movedAt: new Date().toISOString(),
    reasonCode: e.reasonCode ?? 'http.403',
    note: e.note ?? 'test',
    movedBy: 'manual',
  }));
  writeFileSync(join(sandbox, 'sources/_quarantine/INDEX.json'), JSON.stringify(idx, null, 2) + '\n');
}

describe('source-lifecycle E2E integration', () => {
  beforeEach(() => {
    resetSandbox();
  });

  it('quarantined source is skipped by isSkipped — same gate used by all 4 gates', () => {
    const ghostId = `ghost-source-${Date.now()}`;
    // INDEX pekar på en källe som INTE finns i sources/ (manuellt flyttad)
    writeQuarantineIndex([
      { sourceId: ghostId, reasonCode: 'http.403', note: 'manually quarantined for test' },
    ]);

    const skip = isSkipped(ghostId);
    expect(skip.skip).toBe(true);
    expect(skip.reason).toBe('quarantined');
    expect(skip.entry).not.toBeNull();
    expect(skip.entry?.sourceId).toBe(ghostId);
    expect(skip.entry?.reasonCode).toBe('http.403');

    // En aktiv källa ska INTE skip:as
    const activeId = freshSource('active-source');
    const active = isSkipped(activeId);
    expect(active.skip).toBe(false);
    expect(active.reason).toBeNull();
  });

  it('retired source is also skipped — retired wins over no-skip', () => {
    const retiredId = `retired-${Date.now()}`;
    writeFileSync(join(sandbox, 'sources/_retired/INDEX.json'), JSON.stringify([
      {
        sourceId: retiredId,
        url: `https://${retiredId}.example.com`,
        movedAt: new Date().toISOString(),
        reasonCode: 'coverage.outside_stockholm',
        note: 'out of scope',
        movedBy: 'manual',
      },
    ], null, 2) + '\n');

    const skip = isSkipped(retiredId);
    expect(skip.skip).toBe(true);
    expect(skip.reason).toBe('retired');
  });

  it('manual-review resolver: submit → resolve → moved to _quarantine + resolved.jsonl', () => {
    const sourceId = freshSource('review-source');

    // Submit via lifecycle-admin API
    const submit = mr.submitForReview(sourceId, 'schema.low_confidence_jsonld', 'low confidence in JSON-LD', 'test-user');
    expect(submit.ok).toBe(true);
    expect(submit.entryId).toContain('cli:');

    // Verifiera pending
    const pending = mr.listPending();
    const ourEntry = pending.find(e => e.entryId === submit.entryId);
    expect(ourEntry).toBeDefined();
    expect(ourEntry?.sourceId).toBe(sourceId);
    expect(ourEntry?.reasonCode).toBe('schema.low_confidence_jsonld');

    // Resolve with quarantine
    const res = mr.resolvePending(submit.entryId, 'quarantine', 'test-user', 'low confidence is a real problem');
    expect(res.ok).toBe(true);
    expect(res.resolved?.decision).toBe('quarantine');

    // Källfilen flyttad
    expect(existsSync(join(sandbox, 'sources', `${sourceId}.jsonl`))).toBe(false);
    expect(existsSync(join(sandbox, 'sources/_quarantine', `${sourceId}.jsonl`))).toBe(true);

    // INDEX uppdaterad
    const idx = qg.loadQuarantineIndex();
    expect(idx.has(sourceId)).toBe(true);
    const idxEntry = idx.get(sourceId);
    expect(idxEntry?.reasonCode).toBe('schema.low_confidence_jsonld');
    expect(idxEntry?.movedBy).toBe('manual');

    // Resolved.jsonl innehåller beslutet
    const resolved = mr.listResolved();
    const ourResolved = resolved.find(r => r.entryId === submit.entryId);
    expect(ourResolved).toBeDefined();
    expect(ourResolved?.decision).toBe('quarantine');
    expect(ourResolved?.decidedBy).toBe('test-user');

    // Pending borta
    const remaining = mr.listPending().filter(e => e.sourceId === sourceId && e.queue === 'cli-pending');
    expect(remaining).toHaveLength(0);
  });
});