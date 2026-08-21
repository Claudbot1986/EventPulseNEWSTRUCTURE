/**
 * record_feedback — persist a user_interactions row.
 *
 * The feedback write is best-effort: failure MUST NOT break the chat response.
 * We log and return warnings instead of throwing.
 *
 * Phase 1 wiring:
 *   - Five funnel interactions are first-class: impression, click, save,
 *     reject, outbound. The CHECK constraint is enforced by the DB; the
 *     server-side ALLOWED_INTERACTIONS set is the wire contract.
 *   - `reject` carries an optional `reject_reason` (RejectReason enum) that
 *     is persisted into metadata.reject_reason so the personalization layer
 *     can bucket venues by *why* the user rejected, not just *that* they did.
 *   - Two legacy `dismiss` / `feedback_positive` / `feedback_negative`
 *     interactions are accepted for back-compat with existing rows read by
 *     personalize.ts (which still queries 'dismiss' + 'feedback_negative').
 *
 * No LLM. No scoring. Pure I/O.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  RecordFeedbackInput,
  FeedbackInteraction,
  RejectReason,
} from '../types';

/**
 * The exact set of interaction strings accepted by the agent server.
 * Kept in sync with the CHECK constraint on
 *   user_interactions.interaction (see 05-Supabase/migrations/20260821-0001-…).
 * Single source of truth — the `/agent/feedback` handler uses this same
 * constant so the wire contract cannot drift from the tool contract.
 */
export const ALLOWED_INTERACTIONS: ReadonlySet<FeedbackInteraction> = new Set<
  FeedbackInteraction
>([
  'impression',
  'click',
  'outbound',
  'save',
  'reject',
  'dismiss',
  'feedback_positive',
  'feedback_negative',
]);

/** Interactions that count as a `reject` for the personalization layer.
 *  `dismiss` and `feedback_negative` are the legacy aliases. */
const REJECT_ALIASES: ReadonlySet<FeedbackInteraction> = new Set<
  FeedbackInteraction
>(['reject', 'dismiss', 'feedback_negative']);

/** Stable, persisted value for an unset reject reason. Never null so
 *  metrics can bucket it as a known category. */
export const DEFAULT_REJECT_REASON: RejectReason = 'not_interested';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Allowed values for reject_reason. Mirrors the RejectReason union in
 *  types.ts — kept as a runtime set so the tool can validate at the boundary
 *  without a separate dependency. */
export const ALLOWED_REJECT_REASONS: ReadonlySet<RejectReason> = new Set<
  RejectReason
>([
  'not_interested',
  'wrong_category',
  'too_far',
  'too_expensive',
  'already_seen',
  'other',
]);

export interface RecordFeedbackResult {
  ok: boolean;
  warning?: string;
  /** The interaction that was actually persisted (after any normalization). */
  interaction?: FeedbackInteraction;
  /** The reject_reason that was actually persisted (after defaulting). */
  reject_reason?: RejectReason | null;
}

/**
 * Validate the input shape before touching Supabase. Returns the first
 * failed check, or null when the payload is well-formed.
 *
 * Pure — does not coerce values. Coercion (defaulting reject_reason) is
 * the caller's job so the caller can decide what to do with a partial
 * payload.
 */
export function validateFeedbackInput(
  input: Partial<RecordFeedbackInput>
): string | null {
  if (!input || typeof input !== 'object') {
    return 'invalid body';
  }
  if (!input.client_user_id || typeof input.client_user_id !== 'string') {
    return 'client_user_id required';
  }
  if (!UUID_RE.test(input.client_user_id)) {
    return 'client_user_id must be a uuid';
  }
  if (!input.event_id || typeof input.event_id !== 'string') {
    return 'event_id required';
  }
  if (!UUID_RE.test(input.event_id)) {
    return 'event_id must be a uuid';
  }
  if (input.session_id !== undefined && input.session_id !== null &&
      typeof input.session_id !== 'string') {
    return 'session_id must be a string when provided';
  }
  if (typeof input.session_id === 'string' && !UUID_RE.test(input.session_id)) {
    return 'session_id must be a uuid when provided';
  }
  if (!input.interaction || typeof input.interaction !== 'string') {
    return 'interaction required';
  }
  if (!ALLOWED_INTERACTIONS.has(input.interaction as FeedbackInteraction)) {
    return `interaction must be one of: ${[...ALLOWED_INTERACTIONS].join(', ')}`;
  }
  if (
    input.reject_reason !== undefined &&
    input.reject_reason !== null &&
    !ALLOWED_REJECT_REASONS.has(input.reject_reason as RejectReason)
  ) {
    return `reject_reason must be one of: ${[...ALLOWED_REJECT_REASONS].join(', ')}`;
  }
  if (input.query_text !== undefined && input.query_text !== null &&
      typeof input.query_text !== 'string') {
    return 'query_text must be a string when provided';
  }
  if (input.rank_position !== undefined && input.rank_position !== null &&
      (typeof input.rank_position !== 'number' || !Number.isFinite(input.rank_position))) {
    return 'rank_position must be a finite number when provided';
  }
  if (input.rank_position !== undefined && input.rank_position !== null &&
      (input.rank_position < 0 || !Number.isInteger(input.rank_position))) {
    return 'rank_position must be a non-negative integer';
  }
  return null;
}

/**
 * Persist a user_interactions row. Best-effort: never throws.
 *
 * Behavior:
 *   - missing required fields → ok:false, warning, NO Supabase call
 *   - invalid interaction string → ok:false, warning, NO Supabase call
 *   - reject_reason defaults to 'not_interested' when interaction is a
 *     reject alias and reason is omitted (so personalization never sees
 *     a null bucket)
 *   - reject_reason is merged into metadata.reject_reason so downstream
 *     queries can index it via metadata->>reject_reason
 *   - Supabase failure → ok:false, warning with the underlying message
 */
export async function recordFeedback(
  supabase: SupabaseClient,
  input: RecordFeedbackInput
): Promise<RecordFeedbackResult> {
  const validationError = validateFeedbackInput(input);
  if (validationError) {
    return { ok: false, warning: validationError };
  }

  const interaction = input.interaction as FeedbackInteraction;

  // Default reject_reason for the reject aliases. Surface the resolved value
  // in the result so the caller can echo it back to the UI / log it.
  const rejectReasonResolved: RejectReason | null =
    REJECT_ALIASES.has(interaction)
      ? (input.reject_reason ?? DEFAULT_REJECT_REASON)
      : null;

  // Merge reject_reason into metadata so the persisted row is self-contained
  // (no second pass needed to reconcile). Caller-provided metadata wins on
  // conflict only if THEY explicitly set reject_reason there too — the
  // top-level field is authoritative.
  const baseMetadata = input.metadata ?? {};
  const metadata: Record<string, unknown> = rejectReasonResolved
    ? { ...baseMetadata, reject_reason: rejectReasonResolved }
    : { ...baseMetadata };

  const row = {
    client_user_id: input.client_user_id,
    session_id:     input.session_id ?? null,
    event_id:       input.event_id,
    interaction,
    query_text:     input.query_text ?? null,
    rank_position:  input.rank_position ?? null,
    reasons:        input.reasons ?? [],
    metadata,
  };

  const { error } = await supabase.from('user_interactions').insert(row);
  if (error) {
    return { ok: false, warning: `feedback insert failed: ${error.message}` };
  }
  return {
    ok: true,
    interaction,
    reject_reason: rejectReasonResolved,
  };
}
