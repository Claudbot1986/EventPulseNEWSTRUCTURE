/**
 * scripts/lib/ledger-inspect.test.ts
 *
 * Granskningen av import-ledgern — inklusive NEGATIVA KONTROLLER.
 *
 * Varför (2026-10-28). Under tre nätter såg kedjan GRÖN ut medan ledger
 * stod kvar på 'queued'. Orsaken var ett stavnamn i dräneringen: felet
 * kastades i en catch som bara loggade, och kedjans klassificering läste
 * loggraden som 'logic' — alltså grönt. Ingen gate fångade det, eftersom
 * ingen gate tittade på ledger.
 *
 * Negativa kontroller:
 *   - Den FAKTISKA felraden från dräneringen MÅSTE fångas.
 *   - Den FAKTISKA felraden från importen MÅSTE fångas.
 *   - En vanlig informationsrad får INTE ge falskt larm.
 *   - "queued" som växer trots slutförda jobb MÅSTE flaggas.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ledgerStates,
  ledgerFailureLines,
  queuedGrewWithoutEvidence,
} from './ledger-inspect.mjs';

let tmpDir = '';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-inspect-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ledgerFailureLines', () => {
  it('FANGAR den faktiska felraden från drainen (stavnamnet-buggen)', () => {
    // Ordagrann rad från 03-Queue/drainQueue.ts (2026-10-28).
    const stderr = [
      '[drain] DEGRADED kunde inte uppdatera ledger: persistedBySource is not defined ' +
        '— källorna stannar i "queued" och importeras om nästa natt',
    ].join('\n');
    const hits = ledgerFailureLines(stderr);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('persistedBySource');
  });

  it('FANGAR den faktiska felraden från importen', () => {
    const stderr = '  [ledger] DEGRADED kunde inte skriva ledger: EACCES: permission denied';
    expect(ledgerFailureLines(stderr)).toHaveLength(1);
  });

  it('NEGATIV KONTROLL — en vanlig informationsrad ger INTE larm', () => {
    // Kedjan skriver en rad per steg. Ingen av dem får matcha.
    const stderr = [
      '[ingestion-cron] ledger: 184 källor markerade som persisterade',
      '[drain] ledger: 5 källor markerade som persisterade',
      '[import] ledger-rad: källan nalencom har 51 jobb',
    ].join('\n');
    expect(ledgerFailureLines(stderr)).toHaveLength(0);
  });

  it('NEGATIV KONTROLL — tom utdata ger inga träffar', () => {
    expect(ledgerFailureLines('')).toHaveLength(0);
    expect(ledgerFailureLines(undefined as unknown as string)).toHaveLength(0);
  });
});

describe('ledgerStates', () => {
  it('räknar radernas tillstånd', () => {
    const file = path.join(tmpDir, 'ledger.jsonl');
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ sourceId: 'a', state: 'persisted' }),
        JSON.stringify({ sourceId: 'b', state: 'queued' }),
        JSON.stringify({ sourceId: 'c', state: 'empty' }),
        JSON.stringify({ sourceId: 'd', state: 'failed' }),
        // Rad utan state = gammal ledger-rad = saknar bevis → 'queued'.
        JSON.stringify({ sourceId: 'e' }),
        'trasig json-rad',
      ].join('\n'),
      'utf8',
    );
    const counts = ledgerStates(file);
    expect(counts.total).toBe(5);
    expect(counts.persisted).toBe(1);
    expect(counts.queued).toBe(2);
    expect(counts.empty).toBe(1);
    expect(counts.failed).toBe(1);
  });

  it('NEGATIV KONTROLL — saknad fil ger nollor, inte ett fel', () => {
    const counts = ledgerStates(path.join(tmpDir, 'saknas.jsonl'));
    expect(counts.total).toBe(0);
    expect(counts.persisted).toBe(0);
  });
});

describe('queuedGrewWithoutEvidence', () => {
  const base = { total: 10, persisted: 10, queued: 0, empty: 0, failed: 0 };

  it('FANGAR "jobb kördes men beviset skrevs inte"', () => {
    const after = { ...base, queued: 2, persisted: 8 };
    expect(queuedGrewWithoutEvidence(base, after, 50)).toBe(true);
  });

  it('NEGATIV KONTROLL — inga jobb körda ⇒ ingen anklagelse', () => {
    const after = { ...base, queued: 2, persisted: 8 };
    expect(queuedGrewWithoutEvidence(base, after, 0)).toBe(false);
  });

  it('NEGATIV KONTROLL — beviset skrevs ⇒ queued får inte växa', () => {
    const after = { ...base, queued: 0, persisted: 12 };
    expect(queuedGrewWithoutEvidence(base, after, 50)).toBe(false);
  });
});
