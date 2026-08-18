/**
 * analyze_with_llm — batch-level pattern detector for the scraping supervisor.
 *
 * Role per `43-Scraping-Tools-Survey-2026-08-19.md`:
 *   This is NOT a per-source classifier (that role is owned by
 *   `02-Ingestion/C-htmlGate/C4-ai-analysis.ts`, which uses callMinimax and
 *   owns the canonical `FailCategory` enum).
 *
 *   The supervisor's LLM is for **batch-level pattern synthesis**:
 *     - Why are 3+ sources failing with the same exitReason?
 *     - What does the touched-vs-untouched ratio suggest about scheduling?
 *     - Which dead-source cluster is most worth investigating next?
 *
 * Pipeline position:
 *   collect_state → [analyze_with_llm] → auto_apply_safe_fixes → write_reports
 *
 * Failure modes:
 *   - SDK error / timeout / unparseable JSON → fallback to deterministic
 *     synthesis (the same numbers collect_state produced, formatted as
 *     findings). The supervisor degrades gracefully.
 *
 * Anti-hallucination contract:
 *   Every `sourceId` in the LLM's output is intersected against the union of
 *   `deadSources + workingSources + untouchedSources` from the input state.
 *   Any fabricated id is silently dropped before write. This is the same
 *   pattern as `filterHighlightedIds` in `08-Agent/llmRouter.ts:114`.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SupervisorState, SourceHealth } from './collect_state';

export const LLM_MODEL = 'claude-haiku-4-5-20251001';
const LLM_TIMEOUT_MS = 8_000;
const MAX_TOKENS = 800;

// ─── Public types ────────────────────────────────────────────────────────────

export type FindingKind =
  | 'schema-drift'      // 3+ sources share an exitReason
  | 'recovery-gap'      // deadSources cluster with no clear fix path
  | 'untouched-staleness' // untouchedSources with high consecutiveFailures
  | 'monoculture'       // all working sources use the same path
  | 'freshness-debt'    // too few working sources per batch
  | 'pipeline-bottleneck'; // specific failure mode dominant

export interface Finding {
  kind: FindingKind;
  /** Source ids this finding applies to. Filtered against the input state. */
  sourceIds: string[];
  /** One-sentence summary (operator-facing). */
  summary: string;
  /** Concrete evidence from the input state (no fabrication). */
  evidence: string;
  /** Severity for the daily report. */
  severity: 'low' | 'medium' | 'high';
}

export type ActionKind =
  | 'investigate-pattern' // multi-site test before any C-layer change
  | 'suggest-script'      // point at one of the 4 manual fix scripts
  | 'archive-candidate'   // eligible for auto_apply_safe_fixes
  | 're-prioritize'       // push to priority queue
  | 'run-manual'          // among the 27 untouched, pick 5 to run
  | 'no-action';

export interface SuggestedAction {
  kind: ActionKind;
  /** Concrete target: sourceId, script name, or pattern name. */
  target: string;
  rationale: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface AnalysisResult {
  findings: Finding[];
  suggestedActions: SuggestedAction[];
  /** True iff LLM produced the output; false iff deterministic fallback. */
  usedLlm: boolean;
  /** Model version when LLM was used; null on fallback. */
  modelVersion: string | null;
  /** Total input sourceIds (for observability of how many got dropped). */
  inputSourceCount: number;
}

// ─── LLM client (lazy) ───────────────────────────────────────────────────────

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  client = new Anthropic({ apiKey });
  return client;
}

// ─── Anti-hallucination filter ───────────────────────────────────────────────

/**
 * Intersect LLM-returned sourceIds against the input state's source id set.
 * Drop everything else (including non-string entries, empty strings, dupes).
 * Preserves the order the LLM emitted them in.
 */
export function filterSourceIds(
  parsedIds: unknown,
  allowedIds: ReadonlySet<string>
): string[] {
  if (!Array.isArray(parsedIds) || allowedIds.size === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of parsedIds) {
    if (typeof id !== 'string' || id.length === 0) continue;
    if (!allowedIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ─── User-message builder ────────────────────────────────────────────────────

export function buildUserMessage(state: SupervisorState): string {
  // Compact summary — don't dump the full state. Keep under ~6 KB so the
  // request stays cheap and the model can focus on patterns.
  const allSourceIds = new Set<string>([
    ...state.deadSources.map((s) => s.sourceId),
    ...state.workingSources.map((s) => s.sourceId),
    ...state.untouchedSources.map((s) => s.sourceId),
  ]);

  const workingPaths = new Map<string, number>();
  for (const s of state.workingSources) {
    const path = s.preferredPath ?? s.lastPathUsed ?? 'unknown';
    workingPaths.set(path, (workingPaths.get(path) ?? 0) + 1);
  }

  return JSON.stringify({
    timestamp: state.timestamp,
    totals: state.totals,
    failureModes: state.failureModes,
    schemaDriftSignals: state.schemaDriftSignals.map((sig) => ({
      exitReason: sig.exitReason,
      count: sig.count,
      affectedSourceIds: sig.affectedSourceIds,
    })),
    workingPathDistribution: Object.fromEntries(workingPaths),
    topDeadByConsecutiveFailures: state.deadSources.slice(0, 10).map((s) => ({
      sourceId: s.sourceId,
      consecutiveFailures: s.consecutiveFailures,
      lastRoutingReason: s.lastRoutingReason,
      lastPathUsed: s.lastPathUsed,
    })),
    topUntouchedByConsecutiveFailures: state.untouchedSources.slice(0, 10).map((s) => ({
      sourceId: s.sourceId,
      consecutiveFailures: s.consecutiveFailures,
      lastRoutingReason: s.lastRoutingReason,
    })),
    batchSuccessRates: state.batchStats.map((b) => ({
      batch: b.batch,
      successRate: Math.round(b.successRate * 100) / 100,
      avgEventsFound: Math.round(b.avgEventsFound * 10) / 10,
    })),
    instruction:
      'You are an observability classifier for the EventPulse scraping pipeline. ' +
      'Return JSON only. Do NOT invent sourceIds. Every sourceId you mention MUST appear in ' +
      'the schemaDriftSignals/topDead/topUntouched lists above. Output schema: ' +
      '{"findings":[{"kind":"schema-drift|recovery-gap|untouched-staleness|monoculture|' +
      'freshness-debt|pipeline-bottleneck","sourceIds":["..."],"summary":"...","evidence":"..."' +
      ',"severity":"low|medium|high"}],"suggestedActions":[{"kind":"investigate-pattern|' +
      'suggest-script|archive-candidate|re-prioritize|run-manual|no-action","target":"...",' +
      '"rationale":"...","riskLevel":"low|medium|high"}]}. ' +
      'Keep findings <= 5. Keep suggestedActions <= 5. ' +
      'Never propose changing C-layer code based on a single site — flag multi-site evidence only.',
  }) + `\n\n[VALID_SOURCE_IDS] ${Array.from(allSourceIds).join(',')}`;
}

// ─── Deterministic fallback ───────────────────────────────────────────────────

/**
 * Always produces a useful AnalysisResult without LLM.
 * Used whenever ANTHROPIC_API_KEY is missing, the SDK errors, the JSON
 * doesn't parse, or the timeout fires. The output is "less colorful" than
 * the LLM but never wrong — derived directly from the state.
 */
export function deterministicAnalysis(state: SupervisorState): Omit<AnalysisResult, 'usedLlm' | 'modelVersion'> {
  const findings: Finding[] = [];
  const suggestedActions: SuggestedAction[] = [];

  // 1. Schema drift findings (mirrors state.schemaDriftSignals)
  for (const sig of state.schemaDriftSignals) {
    findings.push({
      kind: 'schema-drift',
      sourceIds: sig.affectedSourceIds.slice(0, 10),
      summary: `${sig.count} sources failing with "${sig.exitReason}"`,
      evidence: `Multi-site pattern: ${sig.affectedSourceIds.length} distinct sources share this exitReason across the recent batches.`,
      severity: sig.count >= 5 ? 'high' : sig.count >= 3 ? 'medium' : 'low',
    });
    // For the two failure modes we know how to handle, suggest the matching script
    const reason = sig.exitReason.toLowerCase();
    if (reason.includes('404') || reason.includes('serverdown') || reason.includes('not found')) {
      suggestedActions.push({
        kind: 'suggest-script',
        target: '03-Queue/gl-fix-404.py',
        rationale: `Failure cluster "${sig.exitReason}" matches the 404/serverdown class — running the Exa-driven fix script may recover some.`,
        riskLevel: 'low',
      });
    } else if (reason.includes('500') || reason.includes('error500')) {
      suggestedActions.push({
        kind: 'suggest-script',
        target: '03-Queue/gl-fix-500.py',
        rationale: `Failure cluster "${sig.exitReason}" matches the 500-class — retry-with-backoff script may recover.`,
        riskLevel: 'low',
      });
    }
  }

  // 2. Untouched-with-failures finding
  const staleUntouched = state.untouchedSources.filter((s) => s.consecutiveFailures >= 10);
  if (staleUntouched.length > 0) {
    findings.push({
      kind: 'untouched-staleness',
      sourceIds: staleUntouched.slice(0, 10).map((s) => s.sourceId),
      summary: `${staleUntouched.length} untouched sources have consecutiveFailures >= 10`,
      evidence: `They have status=fail in runtime/sources_status.jsonl but no batch traces — likely block in scheduler or queue.`,
      severity: staleUntouched.length >= 10 ? 'high' : 'medium',
    });
    suggestedActions.push({
      kind: 'run-manual',
      target: staleUntouched.slice(0, 5).map((s) => s.sourceId).join(','),
      rationale: 'Top 5 by consecutiveFailures — manual re-test may unblock.',
      riskLevel: 'low',
    });
  }

  // 3. Monoculture finding (all working sources on one path)
  const workingPaths = new Set(
    state.workingSources
      .map((s) => s.preferredPath ?? s.lastPathUsed ?? 'unknown')
      .filter((p) => p !== 'unknown')
  );
  if (state.workingSources.length >= 5 && workingPaths.size === 1) {
    findings.push({
      kind: 'monoculture',
      sourceIds: state.workingSources.map((s) => s.sourceId),
      summary: `All ${state.workingSources.length} working sources use a single path`,
      evidence: `Path set: ${Array.from(workingPaths).join(', ')}. Zero redundancy if that path breaks.`,
      severity: 'medium',
    });
  }

  // 4. Archive candidates — deterministic auto-retire whitelist
  for (const s of state.deadSources) {
    const reason = (s.lastRoutingReason ?? '').toLowerCase();
    if (reason.includes('enotfound') || (reason.includes('404') && s.consecutiveFailures >= 10)) {
      suggestedActions.push({
        kind: 'archive-candidate',
        target: s.sourceId,
        rationale: `ENOTFOUND or persistent 404 with consecutiveFailures=${s.consecutiveFailures}.`,
        riskLevel: 'low',
      });
    }
  }

  return {
    findings,
    suggestedActions,
    inputSourceCount:
      state.deadSources.length + state.workingSources.length + state.untouchedSources.length,
  };
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function analyzeWithLlm(state: SupervisorState): Promise<AnalysisResult> {
  const fallback = deterministicAnalysis(state);

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...fallback, usedLlm: false, modelVersion: null };
  }

  const allowedIds = new Set<string>([
    ...state.deadSources.map((s) => s.sourceId),
    ...state.workingSources.map((s) => s.sourceId),
    ...state.untouchedSources.map((s) => s.sourceId),
  ]);

  const userMsg = buildUserMessage(state);

  try {
    const response = await withTimeout(
      getClient().messages.create({
        model: LLM_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: userMsg,
          },
        ],
      }),
      LLM_TIMEOUT_MS
    );

    const text = extractText(response);
    if (!text) return { ...fallback, usedLlm: false, modelVersion: null };

    const parsed = parseAnalysisJson(text);
    if (!parsed) return { ...fallback, usedLlm: false, modelVersion: null };

    // ── Anti-hallucination: filter every sourceId list ──
    const findings: Finding[] = (parsed.findings ?? []).map((f) => ({
      kind: validateKind(f.kind) ?? 'pipeline-bottleneck',
      sourceIds: filterSourceIds(f.sourceIds, allowedIds),
      summary: typeof f.summary === 'string' ? f.summary.slice(0, 500) : '',
      evidence: typeof f.evidence === 'string' ? f.evidence.slice(0, 500) : '',
      severity: validateSeverity(f.severity),
    }));

    const suggestedActions: SuggestedAction[] = (parsed.suggestedActions ?? []).map((a) => ({
      kind: validateActionKind(a.kind) ?? 'no-action',
      target: typeof a.target === 'string' ? a.target.slice(0, 200) : '',
      rationale: typeof a.rationale === 'string' ? a.rationale.slice(0, 500) : '',
      riskLevel: validateRiskLevel(a.riskLevel),
    }));

    return {
      findings,
      suggestedActions,
      usedLlm: true,
      modelVersion: LLM_MODEL,
      inputSourceCount: allowedIds.size,
    };
  } catch {
    return { ...fallback, usedLlm: false, modelVersion: null };
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface ParsedAnalysis {
  findings?: Array<{
    kind?: unknown;
    sourceIds?: unknown;
    summary?: unknown;
    evidence?: unknown;
    severity?: unknown;
  }>;
  suggestedActions?: Array<{
    kind?: unknown;
    target?: unknown;
    rationale?: unknown;
    riskLevel?: unknown;
  }>;
}

const VALID_KINDS: ReadonlySet<FindingKind> = new Set([
  'schema-drift',
  'recovery-gap',
  'untouched-staleness',
  'monoculture',
  'freshness-debt',
  'pipeline-bottleneck',
]);

const VALID_ACTIONS: ReadonlySet<ActionKind> = new Set([
  'investigate-pattern',
  'suggest-script',
  'archive-candidate',
  're-prioritize',
  'run-manual',
  'no-action',
]);

function validateKind(v: unknown): FindingKind | null {
  return typeof v === 'string' && VALID_KINDS.has(v as FindingKind) ? (v as FindingKind) : null;
}
function validateActionKind(v: unknown): ActionKind | null {
  return typeof v === 'string' && VALID_ACTIONS.has(v as ActionKind) ? (v as ActionKind) : null;
}
function validateSeverity(v: unknown): 'low' | 'medium' | 'high' {
  return v === 'low' || v === 'medium' || v === 'high' ? v : 'low';
}
function validateRiskLevel(v: unknown): 'low' | 'medium' | 'high' {
  return v === 'low' || v === 'medium' || v === 'high' ? v : 'low';
}

export function parseAnalysisJson(text: string): ParsedAnalysis | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Balance braces — find the first complete top-level JSON object.
  // LLM replies often have prose + multiple objects; we want the first one.
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try {
          const obj = JSON.parse(slice);
          if (typeof obj !== 'object' || obj === null) return null;
          return obj as ParsedAnalysis;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractText(response: unknown): string {
  if (
    response &&
    typeof response === 'object' &&
    'content' in response &&
    Array.isArray((response as { content: unknown[] }).content)
  ) {
    const blocks = (response as { content: Array<{ type?: string; text?: string }> }).content;
    return blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
      .trim();
  }
  return '';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('llm timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// Re-export SourceHealth for callers that need to build their own state
export type { SourceHealth };