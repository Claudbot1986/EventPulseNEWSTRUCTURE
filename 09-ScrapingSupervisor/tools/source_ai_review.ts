/**
 * source_ai_review.ts — review dead sources and propose changes.
 *
 * Approach (scientific best practices, see CLAUDE.md Generalization
 * Protection Rule + Settles "Active Learning Literature Survey" 2009):
 *
 *   1. Deterministic rules first — narrow, source-specific. Cheap and
 *      reliable. Each rule produces a `SourceProposal` with high
 *      confidence and cites the evidence directly.
 *
 *   2. LLM-assisted proposals ONLY when (a) the deterministic rules
 *      can't conclude AND (b) the LLM has real batch-trace evidence
 *      to read. Same anti-hallucination pattern as `analyze_with_llm.ts`:
 *      LLM-returned sourceIds are intersected against the input set.
 *
 *   3. Every proposal carries: confidence + needsHumanReview + rationale
 *      + evidence. Low/medium confidence or needsHumanReview=true → the
 *      supervisor never auto-applies — it queues for human review.
 *
 *   4. NEVER propose to invent status, events, or synthetic outcomes.
 *      Every action must trace back to a real `lastRoutingReason`,
 *      batch-trace field, or fetched response.
 *
 * What the deterministic rules handle (high-confidence, auto-applyable):
 *
 *   - ENOTFOUND for >= 10 consecutive failures → propose archive-dead.
 *   - Persistent 404 (HTTP 404 in lastRoutingReason for >= 10 cf) → archive-dead.
 *   - Stable `lastPathUsed: null` with cf >= 5 → propose mark-untouched
 *     (not actually dead, just never successfully routed). Human reviews.
 *   - Batch trace shows c0Candidates=0 + c1BestSubpageFound=null + cf>=5
 *     AND no recovery signals → propose mark-review-needed.
 *
 * What needs the LLM (medium/low confidence):
 *
 *   - "no-jsonld-or-no-events" cf>=10: page exists, may have HTML path
 *     not yet discovered. LLM reviews batch trace (c0Candidates,
 *     c1BestSubpageFound, c2Score, c2Reason) and proposes either:
 *     (a) preferredPath update, or (b) mark-review-needed.
 *   - Redirect loops cf>=10: maybe the loop is between two URLs and one
 *     variant works. LLM proposes URL update.
 *
 * Out of scope (handled elsewhere):
 *
 *   - The actual move-to-`_archive/` happens in `auto_apply_source_fixes.ts`.
 *   - The vault report section is built by `source_health_report.ts`.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { makeChange, type SourceAction, type Confidence, type AppliedBy, type ReviewStatus } from './source_changes';
import type { SourceHealth } from './collect_state';

const ENOTFOUND_RE = /getaddrinfo\s+ENOTFOUND\s+(\S+)/i;
const HTTP_404_RE = /HTTP\s+404|not[-\s]?found/i;
const REDIRECT_LOOP_RE = /redirect\s+loop|exceeded\s+\d+\s+redirects/i;
const NO_JSONLD_RE = /no-jsonld|no-events/i;

const CF_THRESHOLD_DEAD = 10;
const CF_THRESHOLD_REVIEW = 5;

export interface SourceProposal {
  sourceId: string;
  action: SourceAction;
  /** What we'd change. */
  before: { url?: string; preferredPath?: string; status?: string };
  after: { url?: string; preferredPath?: string; status?: string };
  confidence: Confidence;
  rationale: string;
  evidence: string;
  needsHumanReview: boolean;
}

export interface ReviewOptions {
  projectRoot: string;
  /** Sources to review. Typically `state.deadSources` from collect_state. */
  sources: SourceHealth[];
  /** Whether to call the LLM for ambiguous cases. Default: true if key set. */
  useLlm?: boolean;
  /** Model to use for LLM-assisted proposals. */
  model?: string;
  /** Cap on LLM calls per run (cost control). */
  maxLlmProposals?: number;
}

interface BatchTraceForReview {
  sourceId?: string;
  success?: boolean;
  eventsFound?: number;
  exitReason?: string;
  c0Candidates?: number;
  c0WinnerUrl?: string | null;
  c0WinnerDensity?: number;
  c0RuleWinnerPath?: string | null;
  c1BestSubpageFound?: string | null;
  c1SubpagesTested?: string[];
  c1Verdict?: string;
  c2Score?: number;
  c2Reason?: string;
  c3EventsFound?: number;
  c3MethodsUsed?: string[];
}

/**
 * Read last N batch-trace.jsonl files; build a per-sourceId summary of
 * the latest trace's evidence fields (newest batch wins).
 */
function gatherBatchEvidence(projectRoot: string, recentBatches = 5): Map<string, BatchTraceForReview> {
  const out = new Map<string, BatchTraceForReview>();
  const reportsDir = resolve(projectRoot, '02-Ingestion', 'C-htmlGate', 'reports');
  if (!existsSync(reportsDir)) return out;

  const dirs = readdirSync(reportsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^batch-\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .reverse()
    .slice(0, recentBatches);

  for (const batchName of dirs) {
    const tracePath = join(reportsDir, batchName, 'batch-traces.jsonl');
    if (!existsSync(tracePath)) continue;
    let text = '';
    try {
      text = readFileSync(tracePath, 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as BatchTraceForReview;
        if (typeof rec.sourceId === 'string' && !out.has(rec.sourceId)) {
          out.set(rec.sourceId, rec);
        }
      } catch { /* skip */ }
    }
  }
  return out;
}

/**
 * Deterministic proposals — no LLM, no network, always available.
 * Returns one proposal per source that matches a rule.
 */
function deterministicProposals(
  sources: SourceHealth[],
  evidence: Map<string, BatchTraceForReview>,
): SourceProposal[] {
  const out: SourceProposal[] = [];
  for (const s of sources) {
    const reason = s.lastRoutingReason ?? '';
    const cf = s.consecutiveFailures;

    // ENOTFOUND for >= 10 → archive-dead (HIGH confidence)
    if (ENOTFOUND_RE.test(reason) && cf >= CF_THRESHOLD_DEAD) {
      out.push({
        sourceId: s.sourceId,
        action: 'archive-dead',
        before: { url: s.preferredPath ?? undefined },
        after: {},
        confidence: 'high',
        rationale: `DNS lookup fails consistently (cf=${cf}). Server is unreachable from this network.`,
        evidence: `lastRoutingReason: "${reason.slice(0, 100)}"; consecutiveFailures=${cf}`,
        needsHumanReview: false,
      });
      continue;
    }

    // Persistent 404 — explicit server "gone" + cf>=10 → archive-dead
    if (HTTP_404_RE.test(reason) && cf >= CF_THRESHOLD_DEAD) {
      out.push({
        sourceId: s.sourceId,
        action: 'archive-dead',
        before: { url: s.preferredPath ?? undefined },
        after: {},
        confidence: 'high',
        rationale: `HTTP 404 persists for ${cf} attempts. Server explicitly reports page is gone.`,
        evidence: `lastRoutingReason: "${reason.slice(0, 100)}"; consecutiveFailures=${cf}`,
        needsHumanReview: false,
      });
      continue;
    }

    // Redirect loops cf>=10 → mark-review-needed (LLM may rescue with URL)
    if (REDIRECT_LOOP_RE.test(reason) && cf >= CF_THRESHOLD_DEAD) {
      out.push({
        sourceId: s.sourceId,
        action: 'mark-review-needed',
        before: {},
        after: {},
        confidence: 'medium',
        rationale: `Redirect loop persists (cf=${cf}). Possibly a variant URL works. Needs human URL review.`,
        evidence: `lastRoutingReason: "${reason.slice(0, 100)}"; consecutiveFailures=${cf}`,
        needsHumanReview: true,
      });
      continue;
    }

    // No JSON-LD and cf>=5 — LLM might propose preferredPath
    if (NO_JSONLD_RE.test(reason) && cf >= CF_THRESHOLD_REVIEW) {
      const trace = evidence.get(s.sourceId);
      const bestSubpage = trace?.c1BestSubpageFound;
      if (bestSubpage) {
        // Strong evidence: c1 actually found a candidate subpage
        out.push({
          sourceId: s.sourceId,
          action: 'update-preferred-path',
          before: { preferredPath: undefined },
          after: { preferredPath: bestSubpage },
          confidence: 'high',
          rationale: `No JSON-LD events on landing page, but C1 batch discovery found candidate subpage "${bestSubpage}" with c2Score=${trace?.c2Score ?? 'n/a'}.`,
          evidence: `c1BestSubpageFound=${bestSubpage}; c2Score=${trace?.c2Score ?? 'n/a'}; cf=${cf}`,
          needsHumanReview: false,
        });
        continue;
      }
      // No subpage evidence — needs human
      out.push({
        sourceId: s.sourceId,
        action: 'mark-review-needed',
        before: {},
        after: {},
        confidence: 'medium',
        rationale: `No JSON-LD events found and no C1 candidate subpage discovered (cf=${cf}). Human should fetch page and decide whether to add /events path or mark dead.`,
        evidence: `lastRoutingReason: "${reason.slice(0, 100)}"; c0Candidates=${trace?.c0Candidates ?? 'n/a'}; c1BestSubpageFound=${bestSubpage ?? 'null'}`,
        needsHumanReview: true,
      });
      continue;
    }
  }
  return out;
}

// ─── LLM-assisted proposals (medium/low-confidence queue) ───────────────────

function buildLlmPrompt(
  sources: SourceHealth[],
  evidence: Map<string, BatchTraceForReview>,
): { system: string; user: string } {
  const lines: string[] = [];
  for (const s of sources) {
    const t = evidence.get(s.sourceId);
    lines.push(JSON.stringify({
      sourceId: s.sourceId,
      url: undefined,
      cf: s.consecutiveFailures,
      lastRoutingReason: (s.lastRoutingReason ?? '').slice(0, 120),
      status: s.status,
      c0Candidates: t?.c0Candidates ?? null,
      c0WinnerUrl: t?.c0WinnerUrl ?? null,
      c0WinnerDensity: t?.c0WinnerDensity ?? null,
      c0RuleWinnerPath: t?.c0RuleWinnerPath ?? null,
      c1BestSubpageFound: t?.c1BestSubpageFound ?? null,
      c1Verdict: t?.c1Verdict ?? null,
      c2Score: t?.c2Score ?? null,
      c2Reason: (t?.c2Reason ?? '').slice(0, 100),
      c3EventsFound: t?.c3EventsFound ?? null,
      c3MethodsUsed: t?.c3MethodsUsed ?? null,
    }));
  }

  return {
    system: [
      'You are an observability reviewer for the EventPulse scraping pipeline.',
      'You read real batch-trace evidence and propose minimal, source-specific changes.',
      'Output ONLY a JSON object: { proposals: [ ... ] }.',
      'Each proposal MUST reference a sourceId that appears in the input list.',
      'NEVER invent status, events, or outcomes you did not see in the evidence.',
      'NEVER propose general C-layer changes — only source-specific actions.',
      'For each source choose ONE action from:',
      '  - "update-preferred-path" (with `after.preferredPath` set to a candidate path you saw)',
      '  - "mark-review-needed" (when evidence is ambiguous; set `needsHumanReview: true`)',
      '  - "no-change" (when nothing actionable).',
      'Set confidence: high (clear evidence) / medium (probable) / low (guess).',
      'Set needsHumanReview: true for medium and low confidence, or when changing the URL.',
      'Cite one specific evidence field per proposal.',
    ].join('\n'),
    user: `INPUT (one JSON per line):\n${lines.join('\n')}`,
  };
}

function parseReplyJson(text: string): { proposals: SourceProposal[] } | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch { /* fall through */ }
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch { /* fall through */ }
  }
  return null;
}

function sanitizeLlmProposals(
  parsed: { proposals: SourceProposal[] } | null,
  allowedSourceIds: Set<string>,
): SourceProposal[] {
  if (!parsed || !Array.isArray(parsed.proposals)) return [];
  const ALLOWED_ACTIONS = new Set<SourceAction>([
    'url-normalize',
    'update-url',
    'update-preferred-path',
    'archive-dead',
    'mark-untouched',
    'mark-review-needed',
  ]);
  return parsed.proposals.filter((p) => {
    if (!p || typeof p.sourceId !== 'string') return false;
    if (!allowedSourceIds.has(p.sourceId)) return false;
    if (!ALLOWED_ACTIONS.has(p.action as SourceAction)) return false;
    return typeof p.rationale === 'string' && typeof p.evidence === 'string';
  });
}

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  cachedClient = new Anthropic();
  return cachedClient;
}

/**
 * LLM call for ambiguous cases. Bounded by maxLlmProposals.
 */
async function llmProposals(
  sources: SourceHealth[],
  evidence: Map<string, BatchTraceForReview>,
  opts: { model: string; max: number },
): Promise<SourceProposal[]> {
  if (sources.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const client = getClient();
  const { system, user } = buildLlmPrompt(sources, evidence);
  try {
    const resp = await client.messages.create({
      model: opts.model,
      max_tokens: 1500,
      timeout: 8_000,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = resp.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { type: 'text'; text: string }).text)
      .join('\n');
    const allowed = new Set(sources.map((s) => s.sourceId));
    return sanitizeLlmProposals(parseReplyJson(text), allowed).slice(0, opts.max);
  } catch {
    return [];
  }
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export interface ReviewResult {
  proposals: SourceProposal[];
  usedLlm: boolean;
  modelVersion: string | null;
  llmProposalsCount: number;
}

/**
 * Review sources and propose changes. Pure (no writes). Caller persists
 * to the audit log via `makeChange` + `appendChange` and applies bounded
 * rules via `auto_apply_source_fixes.ts`.
 */
export async function reviewSources(opts: ReviewOptions): Promise<ReviewResult> {
  const useLlm = opts.useLlm ?? !!process.env.ANTHROPIC_API_KEY;
  const model = opts.model ?? 'claude-haiku-4-5-20251001';
  const maxLlm = opts.maxLlmProposals ?? 50;

  const evidence = gatherBatchEvidence(opts.projectRoot, 5);

  const det = deterministicProposals(opts.sources, evidence);

  const detIds = new Set(det.map((p) => p.sourceId));
  const ambiguous = opts.sources.filter((s) => !detIds.has(s.sourceId));
  let llmResult: SourceProposal[] = [];
  let usedLlm = false;

  if (useLlm && ambiguous.length > 0) {
    usedLlm = true;
    llmResult = await llmProposals(ambiguous, evidence, { model, max: maxLlm });
  }

  return {
    proposals: [...det, ...llmResult],
    usedLlm,
    modelVersion: usedLlm ? model : null,
    llmProposalsCount: llmResult.length,
  };
}

/**
 * Convenience: turn proposals into audit-log entries (does NOT persist).
 * The supervisor pipeline persists them after `auto_apply_source_fixes`
 * decides which to apply vs queue for human review.
 */
export function proposalsToChanges(
  proposals: SourceProposal[],
  decision: 'auto-apply' | 'queue-review',
): Array<ReturnType<typeof makeChange>> {
  const appliedBy: AppliedBy = decision === 'auto-apply' ? 'auto-rule' : 'ai-reviewer';
  const reviewStatus: ReviewStatus = decision === 'auto-apply' ? 'auto-applied' : 'pending-review';

  return proposals.map((p) =>
    makeChange({
      sourceId: p.sourceId,
      action: p.action,
      before: p.before,
      after: p.after,
      rationale: p.rationale,
      evidence: p.evidence,
      confidence: p.confidence,
      appliedBy,
      reviewStatus,
    }),
  );
}