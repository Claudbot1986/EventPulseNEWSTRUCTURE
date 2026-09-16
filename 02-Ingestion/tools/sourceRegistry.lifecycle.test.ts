/**
 * Tests for sourceRegistry auto-quarantine trigger.
 *
 * Covers:
 *   - consecutiveFailures < 5: no quarantine, source stays in sources/
 *   - consecutiveFailures >= 5: source moved to sources/_quarantine/, INDEX updated
 *   - Already-quarantined source: no duplicate INDEX entry on re-trigger
 *   - Idempotency: 1000 consecutiveFailures → still single INDEX entry
 *   - Race-safety: missing source file → no throw, no INDEX corruption
 *
 * Uses real tmpdir + EVENTPULSE_SANDBOX_ROOT env var so the read paths are
 * the same as production. No writes outside the tmpdir.
 */

import { describe, expect, it, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Sätt ENV FÖRE import av sourceRegistry så SOURCES_DIR beräknas mot sandbox.
const sandbox = mkdtempSync(join(tmpdir(), 'source-registry-lifecycle-'));
process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;

import * as regMod from './sourceRegistry.js';

type Reg = typeof import('./sourceRegistry.js');

mkdirSync(join(sandbox, 'sources'), { recursive: true });
mkdirSync(join(sandbox, 'sources/_quarantine'), { recursive: true });
mkdirSync(join(sandbox, 'sources/_retired'), { recursive: true });
mkdirSync(join(sandbox, 'runtime'), { recursive: true });
writeFileSync(join(sandbox, 'sources/_quarantine/INDEX.json'), '[]\n');
writeFileSync(join(sandbox, 'sources/_retired/INDEX.json'), '[]\n');

function freshFixture(testName: string): { sourceId: string; sourceFile: string; quarantineFile: string; indexFile: string } {
  const sourceId = `${testName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceFile = join(sandbox, 'sources', `${sourceId}.jsonl`);
  const quarantineFile = join(sandbox, 'sources/_quarantine', `${sourceId}.jsonl`);
  const indexFile = join(sandbox, 'sources/_quarantine/INDEX.json');

  // NOTE: do NOT reset INDEX here — the "classifies reasonCode" test
  // creates multiple fixtures within one test and needs entries to
  // accumulate across iterations. beforeEach already wipes it once per test.
  writeFileSync(
    sourceFile,
    JSON.stringify({ id: sourceId, url: `https://${testName}.example.com`, name: sourceId, type: 'venue', city: 'Stockholm', discoveredAt: '2026-09-10' }) + '\n',
    'utf8',
  );
  return { sourceId, sourceFile, quarantineFile, indexFile };
}

function quarantineEntries(): Array<{ sourceId: string; movedBy: string; reasonCode: string }> {
  const raw = readFileSync(join(sandbox, 'sources/_quarantine/INDEX.json'), 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

describe('sourceRegistry auto-quarantine', () => {
  beforeEach(() => {
    // Återställ INDEX + sandbox-struktur per test
    mkdirSync(join(sandbox, 'sources'), { recursive: true });
    mkdirSync(join(sandbox, 'sources/_quarantine'), { recursive: true });
    mkdirSync(join(sandbox, 'runtime'), { recursive: true });
    writeFileSync(join(sandbox, 'sources/_quarantine/INDEX.json'), '[]\n');
  });

  function loadRegistry(): Reg {
    return regMod as Reg;
  }

  it('does not quarantine when consecutiveFailures < 5', () => {
    const reg = loadRegistry();
    const fx = freshFixture('low-fail');
    for (let i = 0; i < 4; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false, eventsFound: 0, ingestionStage: 'failed',
        error: 'Fetch failed: timeout of 20000ms exceeded',
      });
    }
    expect(existsSync(fx.sourceFile)).toBe(true);
    expect(existsSync(fx.quarantineFile)).toBe(false);
    expect(quarantineEntries().filter(e => e.sourceId === fx.sourceId)).toHaveLength(0);
  });

  it('quarantines source at exactly 5 consecutive failures', () => {
    const reg = loadRegistry();
    const fx = freshFixture('threshold');
    console.log('[test] SOURCES_DIR-resolved from env:', process.env.EVENTPULSE_SANDBOX_ROOT);
    console.log('[test] source file:', fx.sourceFile);
    for (let i = 0; i < 5; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false, eventsFound: 0, ingestionStage: 'failed',
        error: 'Fetch failed: HTTP 403',
      });
    }
    console.log('[test] exists source:', existsSync(fx.sourceFile));
    console.log('[test] exists quarantine:', existsSync(fx.quarantineFile));
    console.log('[test] INDEX raw:', readFileSync(fx.indexFile, 'utf8'));
    expect(existsSync(fx.sourceFile)).toBe(false);
    expect(existsSync(fx.quarantineFile)).toBe(true);
    const entries = quarantineEntries().filter(e => e.sourceId === fx.sourceId);
    expect(entries).toHaveLength(1);
    expect(entries[0].movedBy).toBe('auto');
    expect(entries[0].reasonCode).toBe('http.403');
  });

  it('does not add duplicate INDEX entry when consecutiveFailures keeps climbing', () => {
    const reg = loadRegistry();
    const fx = freshFixture('climb');
    for (let i = 0; i < 12; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false, eventsFound: 0, ingestionStage: 'failed',
        error: 'Fetch failed: timeout',
      });
    }
    expect(quarantineEntries().filter(e => e.sourceId === fx.sourceId)).toHaveLength(1);
  });

  it('classifies reasonCode based on error string', () => {
    const reg = loadRegistry();
    const cases: Array<[string, string]> = [
      ['tls', 'Fetch failed: Hostname/IP does not match certificate'],
      ['http-404', 'Fetch failed: HTTP 404'],
      ['ssl-routines', 'SSL routines:ssl3_read_bytes:tlsv1 unrecognized name'],
      ['redirect', 'Fetch failed: Exceeded 3 redirects'],
      ['no-jsonld', 'no-jsonld-or-no-events'],
    ];

    for (const [tag, errorMessage] of cases) {
      const fx = freshFixture(`classify-${tag}`);
      for (let i = 0; i < 5; i++) {
        reg.updateSourceStatus(fx.sourceId, {
          success: false, eventsFound: 0, ingestionStage: 'failed',
          error: errorMessage,
        });
      }
    }

    const byReason = new Map<string, string>();
    for (const e of quarantineEntries()) {
      // Skippa entries från andra tester; vi tar den sista per sourceId
      byReason.set(e.sourceId, e.reasonCode);
    }
    // Enkel kontroll: minst en post av varje förväntad reasonCode
    expect([...byReason.values()]).toContain('network.ssl');
    expect([...byReason.values()]).toContain('http.404');
    expect([...byReason.values()]).toContain('network.redirect_loop');
    expect([...byReason.values()]).toContain('schema.no_events_on_entry');
  });

  it('resets consecutiveFailures after a success — no quarantine', () => {
    const reg = loadRegistry();
    const fx = freshFixture('recovery');
    for (let i = 0; i < 4; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false, eventsFound: 0, ingestionStage: 'failed',
        error: 'timeout',
      });
    }
    reg.updateSourceStatus(fx.sourceId, {
      success: true, eventsFound: 5, ingestionStage: 'completed',
    });
    for (let i = 0; i < 4; i++) {
      reg.updateSourceStatus(fx.sourceId, {
        success: false, eventsFound: 0, ingestionStage: 'failed',
        error: 'timeout',
      });
    }
    expect(existsSync(fx.sourceFile)).toBe(true);
    expect(quarantineEntries().filter(e => e.sourceId === fx.sourceId)).toHaveLength(0);
  });

  it('does not crash when source file is missing (race with manual move)', () => {
    const reg = loadRegistry();
    // Anropa updateSourceStatus utan att källfilen finns — simulate: manuell flytt + INDEX-entry saknas
    const ghostId = `ghost-${Date.now()}`;
    expect(() => {
      for (let i = 0; i < 5; i++) {
        reg.updateSourceStatus(ghostId, {
          success: false, eventsFound: 0, ingestionStage: 'failed',
          error: 'Fetch failed: timeout',
        });
      }
    }).not.toThrow();
    // INDEX ska inte innehålla ghostId (source-fil saknades vid move)
    expect(quarantineEntries().filter(e => e.sourceId === ghostId)).toHaveLength(0);
  });
});
