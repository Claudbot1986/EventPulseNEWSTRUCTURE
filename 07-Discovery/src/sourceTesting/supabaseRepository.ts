import type {
  SourceCandidateDecision,
  SourceCandidateTestPhase,
  SourceCandidateTestQueueItem,
  SourceCandidateTestRepository,
  SourceCandidateTestRun,
} from './types.js';
import { classifyError, errorText, type ErrorClass } from '../../../scripts/lib/net-error.mjs';

type SupabaseLikeClient = {
  from(table: string): any;
  rpc?(functionName: string, args?: Record<string, unknown>): any;
};

/**
 * 2026-10-28 — bygg ett fel som BÄR med sig sin orsak och sin klass.
 *
 * Tidigare kastades `new Error('...: ' + error.message)` — cause-kedjan
 * bröts, så classifyError() kunde inte skilja på "Supabase svarade 404"
 * och "vi nådde aldrig Supabase". Med cause: error och errorClass kan
 * anroparen (och kedjan) göra det.
 *
 * @param {string} context
 * @param {unknown} error
 * @returns {Error & { cause?: unknown; errorClass: ErrorClass }}
 */
function dbError(context: string, error: unknown): Error & { cause?: unknown; errorClass: ErrorClass } {
  // 2026-10-28 — PostgREST-fel är plain objects ({code, message, details}),
  // inte Errors. `String(error)` gav "[object Object]", så ett verkligt
  // transportfel ("fetch failed") skrevs ut som "[object Object]" och gick
  // inte att klassa. errorText() läser .message (och .code) i stället.
  const message = errorText(error);
  const code = typeof (error as { code?: unknown } | null)?.code === 'string'
    ? String((error as { code: string }).code)
    : null;
  const err = new Error(`${context}: ${message}${code ? ` [${code}]` : ''}`) as Error & { cause?: unknown; errorClass: ErrorClass };
  err.cause = error;
  err.errorClass = classifyError(error);
  return err;
}

function queueItemFromRow(row: any): SourceCandidateTestQueueItem {
  return {
    id: row.id,
    sourceCandidateId: row.source_candidate_id,
    candidateUrl: row.candidate_url,
    candidateName: row.candidate_name ?? null,
    city: row.city ?? null,
    originPath: row.origin_path ?? [],
    phase: row.phase,
    status: row.status,
    priorityScore: row.priority_score,
    attemptCount: row.attempt_count,
    lastError: row.last_error ?? null,
  };
}

function runRow(run: SourceCandidateTestRun): Record<string, unknown> {
  return {
    source_candidate_id: run.sourceCandidateId,
    phase: run.phase,
    sandbox_source_id: run.sandboxSourceId,
    commands_run: run.commandsRun,
    tool_a: run.toolSummaries.A ?? {},
    tool_b: run.toolSummaries.B ?? {},
    tool_c: run.toolSummaries.C ?? {},
    tool_d: run.toolSummaries.D ?? {},
    events_found_total: run.eventsFoundTotal,
    events_after_normalization: run.eventsAfterNormalization,
    events_persisted: run.eventsPersisted,
    winning_path: run.winningPath,
    report_path: run.reportPath ?? null,
    errors: run.errors,
    risk_flags: run.riskFlags,
    report_complete: run.reportComplete,
  };
}

function decisionRow(decision: SourceCandidateDecision): Record<string, unknown> {
  return {
    source_candidate_id: decision.sourceCandidateId,
    decision: decision.decision,
    reason: decision.reason,
    confidence_score: decision.confidenceScore,
    evidence_run_id: decision.evidenceRunId ?? null,
    promoted_source_id: decision.promotedSourceId ?? null,
  };
}

export function createSupabaseSourceCandidateTestRepository(supabase: SupabaseLikeClient): SourceCandidateTestRepository {
  return {
    async claimCandidates(limit: number, phase?: SourceCandidateTestPhase): Promise<SourceCandidateTestQueueItem[]> {
      if (supabase.rpc) {
        const { data, error } = await supabase.rpc('claim_source_candidate_test_queue', {
          task_limit: limit,
          target_phase: phase ?? null,
        });
        if (error) throw dbError('Failed to claim source candidate tests', error);
        return (data ?? []).map(queueItemFromRow);
      }

      let query = supabase
        .from('source_candidate_test_queue')
        .select('*')
        .eq('status', 'pending')
        .order('priority_score', { ascending: false })
        .limit(limit);
      if (phase) query = query.eq('phase', phase);
      const { data, error } = await query;
      if (error) throw dbError('Failed to fetch source candidate tests', error);
      return (data ?? []).map(queueItemFromRow);
    },

    async getCandidateMetadata(sourceCandidateIds: string[]): Promise<Record<string, Record<string, unknown>>> {
      if (sourceCandidateIds.length === 0) return {};
      const { data, error } = await supabase
        .from('source_candidates')
        .select('id, metadata')
        .in('id', sourceCandidateIds);
      if (error) throw dbError('Failed to fetch source candidate metadata', error);
      const result: Record<string, Record<string, unknown>> = {};
      for (const row of data ?? []) {
        if (row?.id && row.metadata && typeof row.metadata === 'object') {
          result[row.id] = row.metadata as Record<string, unknown>;
        }
      }
      return result;
    },

    async insertRun(run: SourceCandidateTestRun): Promise<string> {
      const { data, error } = await supabase
        .from('source_candidate_test_runs')
        .insert(runRow(run))
        .select('id')
        .single();
      if (error) throw dbError('Failed to insert source candidate test run', error);
      return data.id;
    },

    async insertDecision(decision: SourceCandidateDecision): Promise<void> {
      const { error } = await supabase
        .from('source_candidate_test_decisions')
        .insert(decisionRow(decision));
      if (error) throw dbError('Failed to insert source candidate test decision', error);
    },

    async updateCandidateStatus(sourceCandidateId: string, status: SourceCandidateTestQueueItem['status'], error?: string): Promise<void> {
      const { error: queueError } = await supabase
        .from('source_candidate_test_queue')
        .update({
          status,
          last_error: error ?? null,
          updated_at: new Date().toISOString(),
          locked_at: null,
        })
        .eq('source_candidate_id', sourceCandidateId);
      if (queueError) throw dbError('Failed to update source candidate test queue', queueError);

      const { error: candidateError } = await supabase
        .from('source_candidates')
        .update({
          status: status === 'passed' ? 'verified' : status === 'failed' ? 'rejected' : status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceCandidateId);
      if (candidateError) throw dbError('Failed to update source candidate status', candidateError);
    },
  };
}
