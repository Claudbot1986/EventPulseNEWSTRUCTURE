/**
 * Tests for write_reports — vault + repo + JSONL outputs.
 *
 * Real tmp dirs (no fs mocking) because behavior is fundamentally about
 * file creation + append. Mirrors the auto_apply_safe_fixes.test.ts pattern.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendSuggestedFixes,
  buildSuggestedFixEntries,
  formatRepoDoc,
  formatVaultNote,
  summarizeManualFixScripts,
  writeReports,
  type DashboardStalenessItem,
  type WriteReportsOptions,
} from '../tools/write_reports';
import type { SupervisorState, SourceHealth } from '../tools/collect_state';
import type { AnalysisResult, Finding, SuggestedAction } from '../tools/analyze_with_llm';
import type { ApplyResult } from '../tools/auto_apply_safe_fixes';
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

// ─── Fixtures ────────────────────────────────────────────────────────────────

function health(over: Partial<SourceHealth> & { sourceId: string }): SourceHealth {
  return {
    sourceId: over.sourceId,
    status: over.status ?? 'fail',
    consecutiveFailures: over.consecutiveFailures ?? 0,
    lastRoutingReason: over.lastRoutingReason ?? null,
    lastPathUsed: over.lastPathUsed ?? null,
    outcomeType: over.outcomeType ?? null,
    preferredPath: over.preferredPath ?? null,
    city: over.city ?? 'Stockholm',
  };
}

function makeState(over: Partial<SupervisorState> = {}): SupervisorState {
  return {
    timestamp: '2026-08-19T10:00:00Z',
    totals: { sources: 100, stockholm: 50, dead: 30, working: 5, untouched: 15 },
    failureModes: { NO_JSONLD: 20, REDIRECT_LOOP: 5 },
    batchStats: [
      { batch: 'batch-122', successRate: 0.42, avgEventsFound: 3.1 },
      { batch: 'batch-121', successRate: 0.5, avgEventsFound: 4.0 },
    ],
    schemaDriftSignals: [
      { exitReason: 'NO_JSONLD', count: 4, affectedSourceIds: ['a', 'b', 'c', 'd'] },
    ],
    deadSources: [
      health({ sourceId: 'dns-1', lastRoutingReason: 'ENOTFOUND', consecutiveFailures: 15 }),
      health({ sourceId: 'dns-2', lastRoutingReason: 'http 404', consecutiveFailures: 12 }),
    ],
    workingSources: [health({ sourceId: 'w1', preferredPath: 'jsonld' })],
    untouchedSources: [health({ sourceId: 'u1', consecutiveFailures: 11 })],
    priorityQueueHead: [],
    ...over,
  };
}

const SAMPLE_FINDING: Finding = {
  kind: 'schema-drift',
  sourceIds: ['a', 'b', 'c'],
  summary: 'NO_JSONLD across 4 sources',
  evidence: 'Multi-site pattern in recent batches',
  severity: 'high',
};

const SAMPLE_ACTION: SuggestedAction = {
  kind: 'archive-candidate',
  target: 'dns-1',
  rationale: 'ENOTFOUND — no recovery possible',
  riskLevel: 'low',
};

function makeAnalysis(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    findings: [SAMPLE_FINDING],
    suggestedActions: [SAMPLE_ACTION],
    usedLlm: false,
    modelVersion: null,
    inputSourceCount: 50,
    ...over,
  };
}

function makeApply(over: Partial<ApplyResult> = {}): ApplyResult {
  return {
    applied: [
      {
        sourceId: 'dns-1',
        reason: 'enotfound',
        consecutiveFailures: 15,
        lastRoutingReason: 'ENOTFOUND',
        movedTo: '/tmp/x/sources/_archive/dead-2026-08-19/dns-1.jsonl',
        appliedAt: '2026-08-19T10:00:00Z',
      },
    ],
    skipped: [],
    archiveDir: '/tmp/x/sources/_archive/dead-2026-08-19',
    dryRun: false,
    ...over,
  };
}

const SAMPLE_STALENESS: DashboardStalenessItem[] = [
  {
    dashboardTool: 'Tool 7',
    dashboardLine: 'python3 runtime/validate-patterns.py',
    reality: 'missing',
    actualPath: null,
  },
];

// ─── formatVaultNote (pure) ──────────────────────────────────────────────────

describe('formatVaultNote', () => {
  it('contains all required section headings', () => {
    const md = formatVaultNote({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis(),
      apply: makeApply(),
      scriptSummaries: [],
      staleness: SAMPLE_STALENESS,
    });
    for (const heading of [
      '# Scraping Supervisor Daily Report — 2026-08-19',
      '## Summary',
      '## Findings',
      '## Suggested actions',
      '## Applied fixes today',
      '## Schema drift signals (multi-site)',
      '## Top dead sources (by consecutiveFailures)',
      '## Top untouched sources (by consecutiveFailures)',
      '## Batch success rate (last 10 batches)',
      '## Manual fix script performance (last 7 days)',
      '## Dashboard staleness',
      '## Confidence',
    ]) {
      expect(md).toContain(heading);
    }
  });

  it('renders totals correctly', () => {
    const md = formatVaultNote({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis(),
      apply: makeApply(),
      scriptSummaries: [],
      staleness: [],
    });
    expect(md).toContain('| Total sources | 100 |');
    expect(md).toContain('| Working | 5 |');
    expect(md).toContain('| Dead | 30 |');
  });

  it('marks LLM findings as [CLAIMED] when usedLlm=true', () => {
    const md = formatVaultNote({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis({ usedLlm: true, modelVersion: 'claude-haiku-4-5-20251001' }),
      apply: makeApply(),
      scriptSummaries: [],
      staleness: [],
    });
    expect(md).toContain('[CLAIMED] LLM (claude-haiku-4-5-20251001)');
    expect(md).toMatch(/schema-drift.*\[CLAIMED\]/);
  });

  it('marks deterministic findings as [VERIFIED]', () => {
    const md = formatVaultNote({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis({ usedLlm: false }),
      apply: makeApply(),
      scriptSummaries: [],
      staleness: [],
    });
    expect(md).toContain('[VERIFIED] Deterministic fallback');
    expect(md).toMatch(/schema-drift.*\[VERIFIED\]/);
  });

  it('renders applied fixes with reason + cf + moved-to path', () => {
    const md = formatVaultNote({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis(),
      apply: makeApply(),
      scriptSummaries: [],
      staleness: [],
    });
    expect(md).toContain('**dns-1** (enotfound, cf=15)');
    expect(md).toContain('sources/_archive/dead-2026-08-19/dns-1.jsonl');
  });

  it('handles empty state gracefully (placeholders, no crashes)', () => {
    const md = formatVaultNote({
      date: '2026-08-19',
      state: makeState({
        totals: { sources: 0, stockholm: 0, dead: 0, working: 0, untouched: 0 },
        deadSources: [],
        workingSources: [],
        untouchedSources: [],
        batchStats: [],
        schemaDriftSignals: [],
      }),
      analysis: { findings: [], suggestedActions: [], usedLlm: false, modelVersion: null, inputSourceCount: 0 },
      apply: { applied: [], skipped: [], archiveDir: '/x', dryRun: false },
      scriptSummaries: [],
      staleness: [],
    });
    expect(md).toContain('_No findings._');
    expect(md).toContain('_No actions._');
    expect(md).toContain('_None._');
    expect(md).toContain('_No schema drift signals');
    expect(md).toContain('_No batch stats available._');
  });

  it('handles empty staleness with positive placeholder', () => {
    const md = formatVaultNote({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis({ suggestedActions: [] }),
      apply: makeApply({ applied: [] }),
      scriptSummaries: [],
      staleness: [],
    });
    expect(md).toContain('_Dashboard references match reality._');
  });
});

// ─── formatRepoDoc (pure) ────────────────────────────────────────────────────

describe('formatRepoDoc', () => {
  it('contains the totals line', () => {
    const md = formatRepoDoc({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis(),
      apply: makeApply(),
      staleness: SAMPLE_STALENESS,
    });
    expect(md).toContain('# Scraping Supervisor — 2026-08-19');
    expect(md).toContain('5 working / 30 dead / 15 untouched');
  });

  it('shows top 3 suggested fixes', () => {
    const actions: SuggestedAction[] = [
      SAMPLE_ACTION,
      { kind: 'suggest-script', target: '03-Queue/gl-fix-404.py', rationale: 'A reason', riskLevel: 'low' },
      { kind: 'run-manual', target: 'u1', rationale: 'B reason', riskLevel: 'low' },
      { kind: 'no-action', target: 'extra', rationale: 'Should NOT appear', riskLevel: 'low' },
    ];
    const md = formatRepoDoc({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis({ suggestedActions: actions }),
      apply: makeApply(),
      staleness: [],
    });
    expect(md).toContain('1. **archive-candidate**');
    expect(md).toContain('2. **suggest-script**');
    expect(md).toContain('3. **run-manual**');
    expect(md).not.toContain('Should NOT appear');
  });

  it('lists dashboard issues', () => {
    const md = formatRepoDoc({
      date: '2026-08-19',
      state: makeState(),
      analysis: makeAnalysis({ suggestedActions: [] }),
      apply: makeApply({ applied: [] }),
      staleness: SAMPLE_STALENESS,
    });
    expect(md).toContain('Tool 7');
    expect(md).toContain('runtime/validate-patterns.py');
    expect(md).toContain('**missing**');
  });
});

// ─── buildSuggestedFixEntries (pure) ─────────────────────────────────────────

describe('buildSuggestedFixEntries', () => {
  it('maps each action to an entry with all expected keys', () => {
    const entries = buildSuggestedFixEntries('2026-08-19', [SAMPLE_ACTION]);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.date).toBe('2026-08-19');
    expect(e.sourceId).toBe('dns-1');
    expect(e.kind).toBe('archive-candidate');
    expect(e.target).toBe('dns-1');
    expect(e.rationale).toBe('ENOTFOUND — no recovery possible');
    expect(e.riskLevel).toBe('low');
    expect(e.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns empty array for empty input', () => {
    expect(buildSuggestedFixEntries('2026-08-19', [])).toEqual([]);
  });
});

// ─── appendSuggestedFixes (IO) ───────────────────────────────────────────────

describe('appendSuggestedFixes', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(resolve(tmpdir(), 'sup-rep-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const queuePath = () => resolve(tmpRoot, 'suggested-fixes.jsonl');

  it('writes all entries on first call', () => {
    const written = appendSuggestedFixes(queuePath(), [
      { date: '2026-08-19', sourceId: 'a', kind: 'archive-candidate', target: 'a', rationale: 'r', riskLevel: 'low', recordedAt: '2026-08-19T10:00:00Z' },
      { date: '2026-08-19', sourceId: 'b', kind: 'archive-candidate', target: 'b', rationale: 'r', riskLevel: 'low', recordedAt: '2026-08-19T10:00:00Z' },
    ]);
    expect(written).toBe(2);
    const lines = readFileSync(queuePath(), 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('dedupes by {date,sourceId,kind} on subsequent calls', () => {
    const entry = { date: '2026-08-19', sourceId: 'a', kind: 'archive-candidate', target: 'a', rationale: 'r', riskLevel: 'low', recordedAt: '2026-08-19T10:00:00Z' };
    appendSuggestedFixes(queuePath(), [entry]);
    const written2 = appendSuggestedFixes(queuePath(), [entry]);
    expect(written2).toBe(0);
    const lines = readFileSync(queuePath(), 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('writes only the new entries on mixed calls', () => {
    const a = { date: '2026-08-19', sourceId: 'a', kind: 'archive-candidate', target: 'a', rationale: 'r', riskLevel: 'low', recordedAt: '2026-08-19T10:00:00Z' };
    const b = { date: '2026-08-19', sourceId: 'b', kind: 'archive-candidate', target: 'b', rationale: 'r', riskLevel: 'low', recordedAt: '2026-08-19T10:00:00Z' };
    appendSuggestedFixes(queuePath(), [a]);
    const written = appendSuggestedFixes(queuePath(), [a, b]);
    expect(written).toBe(1);
    const lines = readFileSync(queuePath(), 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('skips malformed JSON lines silently during de-dup', () => {
    writeFileSync(queuePath(), 'not json\n{"date":"2026-08-19","sourceId":"a","kind":"archive-candidate"}\n', 'utf-8');
    const written = appendSuggestedFixes(queuePath(), [
      { date: '2026-08-19', sourceId: 'a', kind: 'archive-candidate', target: 'a', rationale: 'r', riskLevel: 'low', recordedAt: '...' },
      { date: '2026-08-19', sourceId: 'b', kind: 'archive-candidate', target: 'b', rationale: 'r', riskLevel: 'low', recordedAt: '...' },
    ]);
    expect(written).toBe(1);
  });
});

// ─── summarizeManualFixScripts (IO) ──────────────────────────────────────────

describe('summarizeManualFixScripts', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(resolve(tmpdir(), 'sup-scripts-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function setupLogsDir() {
    const dir = resolve(tmpRoot, 'runtime/logs');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('returns empty array when logs dir does not exist', () => {
    expect(summarizeManualFixScripts(tmpRoot)).toEqual([]);
  });

  it('counts "Recovered" / "OK" markers in matching log files', () => {
    const logsDir = setupLogsDir();
    writeFileSync(
      resolve(logsDir, 'gl-fix-404-2026-08-19.log'),
      'line1\nRecovered dns-1\nRecovered dns-2\nOK next\n',
      'utf-8'
    );
    const out = summarizeManualFixScripts(tmpRoot, 'runtime/logs', new Date('2026-08-19T12:00:00Z'));
    const sum = out.find((s) => s.script === 'gl-fix-404.py');
    expect(sum).toBeDefined();
    expect(sum!.runsLast7Days).toBe(1);
    expect(sum!.recoveriesLast7Days).toBe(3);
    expect(sum!.recoveryRate).toBe(3);
  });

  it('excludes logs older than 7 days', () => {
    const logsDir = setupLogsDir();
    writeFileSync(
      resolve(logsDir, 'gl-fix-404-2026-01-01.log'),
      'Recovered old\n',
      'utf-8'
    );
    const out = summarizeManualFixScripts(tmpRoot, 'runtime/logs', new Date('2026-08-19T12:00:00Z'));
    const sum = out.find((s) => s.script === 'gl-fix-404.py');
    expect(sum!.runsLast7Days).toBe(0);
    expect(sum!.recoveriesLast7Days).toBe(0);
    expect(sum!.recoveryRate).toBeNull();
  });

  it('excludes "not ok" lines from recovery count', () => {
    const logsDir = setupLogsDir();
    writeFileSync(
      resolve(logsDir, 'gl-fix-404-2026-08-19.log'),
      'OK line1\nnot ok dns-1\nOK line2\n',
      'utf-8'
    );
    const out = summarizeManualFixScripts(tmpRoot, 'runtime/logs', new Date('2026-08-19T12:00:00Z'));
    const sum = out.find((s) => s.script === 'gl-fix-404.py')!;
    expect(sum.recoveriesLast7Days).toBe(2);
  });

  it('returns all four canonical scripts even with no logs', () => {
    setupLogsDir();
    const out = summarizeManualFixScripts(tmpRoot, 'runtime/logs', new Date('2026-08-19T12:00:00Z'));
    expect(out).toHaveLength(4);
    expect(out.map((s) => s.script).sort()).toEqual(['gl-fix-404.py', 'gl-fix-500.py', 'scb-404-AI.py', 'scb-500-AI.py']);
    for (const s of out) {
      expect(s.runsLast7Days).toBe(0);
      expect(s.recoveryRate).toBeNull();
    }
  });
});

// ─── writeReports (integration, IO) ──────────────────────────────────────────

describe('writeReports (integration)', () => {
  let tmpRoot: string;
  let vaultRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(resolve(tmpdir(), 'sup-write-test-'));
    vaultRoot = mkdtempSync(resolve(tmpdir(), 'sup-vault-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(vaultRoot, { recursive: true, force: true });
  });

  const opts = (): WriteReportsOptions => ({
    projectRoot: tmpRoot,
    vaultRoot,
    repoDocDir: 'docs/scraping-supervisor',
    suggestedFixesRelPath: 'runtime/scraping-supervisor/suggested-fixes.jsonl',
    date: '2026-08-19',
  });

  it('writes all 3 artifacts to disk and returns correct paths', () => {
    const result = writeReports(makeState(), makeAnalysis(), makeApply(), opts());

    expect(result.error).toBeNull();
    expect(result.vaultPath).not.toBeNull();
    expect(result.repoDocPath).not.toBeNull();
    expect(existsSync(result.vaultPath!)).toBe(true);
    expect(existsSync(result.repoDocPath!)).toBe(true);
    expect(
      existsSync(resolve(tmpRoot, 'runtime/scraping-supervisor/suggested-fixes.jsonl'))
    ).toBe(true);
  });

  it('vault note contains the summary table and applied-fixes section', () => {
    const result = writeReports(makeState(), makeAnalysis(), makeApply(), opts());
    const md = readFileSync(result.vaultPath!, 'utf-8');
    expect(md).toContain('# Scraping Supervisor Daily Report — 2026-08-19');
    expect(md).toContain('**dns-1** (enotfound, cf=15)');
  });

  it('repo doc is concise (no full breakdown)', () => {
    const result = writeReports(makeState(), makeAnalysis(), makeApply(), opts());
    const md = readFileSync(result.repoDocPath!, 'utf-8');
    expect(md).toContain('# Scraping Supervisor — 2026-08-19');
    expect(md).not.toContain('Confidence');
    expect(md).not.toContain('Top dead sources');
  });

  it('skipRepoDoc=true → repoDocPath=null and no repo doc file', () => {
    const result = writeReports(
      makeState(),
      makeAnalysis(),
      makeApply(),
      { ...opts(), skipRepoDoc: true }
    );
    expect(result.repoDocPath).toBeNull();
    expect(existsSync(resolve(tmpRoot, 'docs/scraping-supervisor/2026-08-19.md'))).toBe(false);
  });

  it('dedupes suggested-fixes across two runs on the same day', () => {
    const o = opts();
    writeReports(makeState(), makeAnalysis(), makeApply(), o);
    const second = writeReports(makeState(), makeAnalysis(), makeApply(), o);
    expect(second.suggestedFixesWritten).toBe(0);
  });

  it('result.dashboardStaleness contains the canonical 3 known issues', () => {
    const result = writeReports(makeState(), makeAnalysis(), makeApply(), opts());
    expect(result.dashboardStaleness).toHaveLength(3);
    expect(result.dashboardStaleness.map((s) => s.dashboardTool)).toEqual([
      'Tool 7',
      'Tool 9',
      'Tool 10',
    ]);
  });

  it('result.manualFixScriptSummaries reflects missing runtime/logs (empty)', () => {
    const result = writeReports(makeState(), makeAnalysis(), makeApply(), opts());
    expect(result.manualFixScriptSummaries).toEqual([]);
  });

  it('returns error field when vault path cannot be created', () => {
    writeFileSync(resolve(vaultRoot, '01-Projects'), 'not a dir\n', 'utf-8');
    const result = writeReports(makeState(), makeAnalysis(), makeApply(), opts());
    expect(result.error).not.toBeNull();
    expect(result.vaultPath).toBeNull();
    expect(result.repoDocPath).not.toBeNull();
  });
});