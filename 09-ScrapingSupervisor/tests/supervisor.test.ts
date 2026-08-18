/**
 * Integration tests for the supervisor orchestrator.
 *
 * Pre-recorded runtime JSONL fixture + mocked LLM (no API key → deterministic
 * fallback). Asserts the 3 artifacts appear + dryRun + skipRepoDoc + error
 * surfaces via the structured result.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSupervisor, main, type SupervisorOptions } from '../supervisor';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY; // deterministic fallback path
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let tmpRoot: string;
let vaultRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'sup-orch-test-'));
  vaultRoot = mkdtempSync(resolve(tmpdir(), 'sup-orch-vault-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(vaultRoot, { recursive: true, force: true });
});

/**
 * Build a minimal runtime/ tree with two ENOTFOUND sources, one persistent-404,
 * one low-cf 404 (should NOT archive), one redirect loop, one working source.
 */
function setupFixtures() {
  // sources/*.jsonl — loadSourceTruth reads record.id and record.city from first line
  mkdirSync(resolve(tmpRoot, 'sources'), { recursive: true });
  for (const id of ['dns-1', 'dns-2', 'four-oh-four', 'young-404', 'redirect', 'w1']) {
    writeFileSync(
      resolve(tmpRoot, `sources/${id}.jsonl`),
      `{"id":"${id}","city":"Stockholm"}\n`,
      'utf-8'
    );
  }

  // runtime/sources_status.jsonl
  mkdirSync(resolve(tmpRoot, 'runtime'), { recursive: true });
  const sourcesStatusLines = [
    '{"sourceId":"dns-1","status":"fail","consecutiveFailures":15,"lastRoutingReason":"getaddrinfo ENOTFOUND","lastPathUsed":null,"outcomeType":null,"preferredPath":null,"city":"Stockholm"}',
    '{"sourceId":"dns-2","status":"fail","consecutiveFailures":3,"lastRoutingReason":"ENOTFOUND","lastPathUsed":null,"outcomeType":null,"preferredPath":null,"city":"Stockholm"}',
    '{"sourceId":"four-oh-four","status":"fail","consecutiveFailures":12,"lastRoutingReason":"http 404 not found","lastPathUsed":"network","outcomeType":null,"preferredPath":null,"city":"Stockholm"}',
    '{"sourceId":"young-404","status":"fail","consecutiveFailures":5,"lastRoutingReason":"http 404","lastPathUsed":"html","outcomeType":null,"preferredPath":null,"city":"Stockholm"}',
    '{"sourceId":"redirect","status":"fail","consecutiveFailures":50,"lastRoutingReason":"REDIRECT_LOOP","lastPathUsed":"network","outcomeType":null,"preferredPath":null,"city":"Stockholm"}',
    '{"sourceId":"w1","status":"ok","consecutiveFailures":0,"lastRoutingReason":null,"lastPathUsed":"jsonld","outcomeType":"success","preferredPath":"jsonld","city":"Stockholm"}',
    '{"sourceId":"stockholm-only","status":"ok","consecutiveFailures":0,"lastRoutingReason":null,"lastPathUsed":"jsonld","outcomeType":"success","preferredPath":"jsonld","city":"Stockholm"}',
  ];
  writeFileSync(
    resolve(tmpRoot, 'runtime/sources_status.jsonl'),
    sourcesStatusLines.join('\n') + '\n',
    'utf-8'
  );

  // runtime/sources_priority_queue.jsonl (empty)
  writeFileSync(resolve(tmpRoot, 'runtime/sources_priority_queue.jsonl'), '', 'utf-8');

  // 02-Ingestion/C-htmlGate/reports/batch-122/batch-traces.jsonl
  const batchDir = resolve(tmpRoot, '02-Ingestion/C-htmlGate/reports/batch-122');
  mkdirSync(batchDir, { recursive: true });
  writeFileSync(
    resolve(batchDir, 'batch-traces.jsonl'),
    [
      JSON.stringify({ batch: 'batch-122', sourceId: 'w1', success: true, eventsFound: 3 }),
      JSON.stringify({ batch: 'batch-122', sourceId: 'dns-1', success: false, exitReason: 'ENOTFOUND', eventsFound: 0 }),
      JSON.stringify({ batch: 'batch-122', sourceId: 'dns-2', success: false, exitReason: 'ENOTFOUND', eventsFound: 0 }),
      JSON.stringify({ batch: 'batch-122', sourceId: 'four-oh-four', success: false, exitReason: 'http 404 not found', eventsFound: 0 }),
      JSON.stringify({ batch: 'batch-122', sourceId: 'redirect', success: false, exitReason: 'REDIRECT_LOOP', eventsFound: 0 }),
      JSON.stringify({ batch: 'batch-122', sourceId: 'young-404', success: false, exitReason: 'http 404', eventsFound: 0 }),
      JSON.stringify({ batch: 'batch-122', sourceId: 'NO_JSONLD-1', success: false, exitReason: 'NO_JSONLD', eventsFound: 0 }),
      JSON.stringify({ batch: 'batch-122', sourceId: 'NO_JSONLD-2', success: false, exitReason: 'NO_JSONLD', eventsFound: 0 }),
      JSON.stringify({ batch: 'batch-122', sourceId: 'NO_JSONLD-3', success: false, exitReason: 'NO_JSONLD', eventsFound: 0 }),
    ].join('\n') + '\n',
    'utf-8'
  );
}

const baseOpts = (): SupervisorOptions => ({
  projectRoot: '',
  vaultRoot: '',
  date: '2026-08-19',
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runSupervisor (integration)', () => {
  it('orchestrates collect → analyze → apply → write end-to-end', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });

    expect(result.error).toBeNull();
    expect(result.dryRun).toBe(false);
    expect(result.state.totals.working).toBe(1);
    expect(result.state.totals.dead).toBe(5);
    expect(result.apply.applied).toHaveLength(3);
    expect(result.apply.applied.map((a) => a.sourceId).sort()).toEqual(['dns-1', 'dns-2', 'four-oh-four']);
    expect(result.reports.vaultPath).not.toBeNull();
    expect(result.reports.repoDocPath).not.toBeNull();
  });

  it('writes vault note, repo doc, suggested-fixes JSONL', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });

    expect(existsSync(result.reports.vaultPath!)).toBe(true);
    expect(existsSync(result.reports.repoDocPath!)).toBe(true);
    expect(
      existsSync(resolve(tmpRoot, 'runtime/scraping-supervisor/suggested-fixes.jsonl'))
    ).toBe(true);
  });

  it('moves archived sources to _archive/dead-{date}/', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });

    const archiveDir = resolve(tmpRoot, 'sources/_archive/dead-2026-08-19');
    expect(existsSync(archiveDir)).toBe(true);
    for (const id of ['dns-1', 'dns-2', 'four-oh-four']) {
      expect(existsSync(resolve(archiveDir, `${id}.jsonl`))).toBe(true);
      expect(existsSync(resolve(tmpRoot, `sources/${id}.jsonl`))).toBe(false);
    }
    expect(existsSync(resolve(tmpRoot, 'sources/young-404.jsonl'))).toBe(true);
    expect(existsSync(resolve(tmpRoot, 'sources/redirect.jsonl'))).toBe(true);
    expect(existsSync(resolve(tmpRoot, 'sources/w1.jsonl'))).toBe(true);
  });

  it('appends to applied-fixes.log with one line per applied fix', async () => {
    setupFixtures();
    await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });

    const logPath = resolve(tmpRoot, 'runtime/scraping-supervisor/applied-fixes.log');
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.sourceId).sort()).toEqual(['dns-1', 'dns-2', 'four-oh-four']);
  });

  it('dryRun=true → no file moves, no log writes', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.apply.dryRun).toBe(true);
    expect(result.apply.applied).toHaveLength(3);
    expect(existsSync(resolve(tmpRoot, 'sources/dns-1.jsonl'))).toBe(true);
    expect(existsSync(resolve(tmpRoot, 'sources/_archive'))).toBe(false);
    expect(existsSync(resolve(tmpRoot, 'runtime/scraping-supervisor/applied-fixes.log'))).toBe(false);
    expect(existsSync(result.reports.vaultPath!)).toBe(true);
  });

  it('skipRepoDoc=true → repoDocPath=null but vault + JSONL still produced', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
      skipRepoDoc: true,
    });

    expect(result.reports.repoDocPath).toBeNull();
    expect(existsSync(resolve(tmpRoot, 'docs/scraping-supervisor/2026-08-19.md'))).toBe(false);
    expect(existsSync(result.reports.vaultPath!)).toBe(true);
  });

  it('idempotency: re-running same date produces 0 new moves', async () => {
    setupFixtures();
    const opts = { ...baseOpts(), projectRoot: tmpRoot, vaultRoot, date: '2026-08-19' };
    const first = await runSupervisor(opts);
    expect(first.apply.applied).toHaveLength(3);

    const second = await runSupervisor(opts);
    expect(second.apply.applied).toHaveLength(0);
    // On second run, the previously-archived sources are gone from sourceTruth
    // (they live in _archive/dead-{date}/ now). Remaining dead sources
    // (redirect, young-404) are not-in-whitelist.
    expect(second.apply.skipped.every((s) => s.reason === 'not-in-whitelist')).toBe(true);
  });

  it('vault note contains totals, applied fixes, dashboard staleness, and confidence markers', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });

    const md = readFileSync(result.reports.vaultPath!, 'utf-8');
    expect(md).toContain('# Scraping Supervisor Daily Report — 2026-08-19');
    expect(md).toContain('| Working | 1 |');
    expect(md).toContain('**dns-1** (enotfound, cf=15)');
    expect(md).toContain('Tool 7');
    expect(md).toContain('[VERIFIED]');
  });

  it('repo doc contains totals + top suggested fixes but NOT full breakdown', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });

    const md = readFileSync(result.reports.repoDocPath!, 'utf-8');
    expect(md).toContain('# Scraping Supervisor — 2026-08-19');
    expect(md).toContain('1 working / 5 dead');
    expect(md).toContain('2 ENOTFOUND sources');
    expect(md).toContain('1 persistent-404 sources');
    expect(md).not.toContain('Confidence');
    expect(md).not.toContain('Top dead sources');
  });

  it('uses deterministic fallback when ANTHROPIC_API_KEY is missing', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });
    expect(result.analysis.usedLlm).toBe(false);
    expect(result.analysis.modelVersion).toBeNull();
  });

  it('emits at least one archive-candidate suggested action for the ENOTFOUND sources', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });
    const archiveActions = result.analysis.suggestedActions.filter((a) => a.kind === 'archive-candidate');
    expect(archiveActions.length).toBeGreaterThan(0);
    const targets = new Set(archiveActions.map((a) => a.target));
    expect(targets.has('dns-1') || targets.has('dns-2')).toBe(true);
  });

  it('reports durationMs as a positive number', async () => {
    setupFixtures();
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: tmpRoot,
      vaultRoot,
      date: '2026-08-19',
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('error path: returns structured result when projectRoot is empty', async () => {
    const result = await runSupervisor({
      ...baseOpts(),
      projectRoot: '',
      vaultRoot,
      date: '2026-08-19',
    });
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.state).toBeDefined();
    expect(result.analysis).toBeDefined();
  });
});

// ─── main() CLI surface ──────────────────────────────────────────────────────

describe('main() CLI', () => {
  it('returns 0 on success and writes vault note', async () => {
    setupFixtures();
    const originalCwd = process.cwd();
    const originalProjectRoot = process.env.EVENTPULSE_PROJECT_ROOT;
    const originalVaultRoot = process.env.EVENTPULSE_VAULT_ROOT;
    process.env.EVENTPULSE_PROJECT_ROOT = tmpRoot;
    process.env.EVENTPULSE_VAULT_ROOT = vaultRoot;
    process.chdir(tmpRoot);

    try {
      const code = await main(['--date', '2026-08-19', '--dry-run']);
      expect(code).toBe(0);
      // Vault note exists at the expected path (proves the full pipeline ran)
      expect(
        existsSync(resolve(vaultRoot, '01-Projects/EventPulse/02-Operations/scraping-supervisor/2026-08-19.md'))
      ).toBe(true);
      // Console output verification: spy on console.log to capture what main() prints
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const code2 = await main(['--date', '2026-08-19', '--dry-run']);
        expect(code2).toBe(0);
        const calls = logSpy.mock.calls.map((c) => String(c[0]));
        expect(calls.join('\n')).toContain('[supervisor]');
      } finally {
        logSpy.mockRestore();
      }
    } finally {
      process.env.EVENTPULSE_PROJECT_ROOT = originalProjectRoot;
      process.env.EVENTPULSE_VAULT_ROOT = originalVaultRoot;
      process.chdir(originalCwd);
    }
  });
});