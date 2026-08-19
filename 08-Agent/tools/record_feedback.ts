/**
 * record_feedback — persist a user_interactions row.
 *
 * The feedback write is best-effort: failure MUST NOT break the chat response.
 * We log and return warnings instead of throwing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecordFeedbackInput } from '../types';

export async function recordFeedback(
  supabase: SupabaseClient,
  input: RecordFeedbackInput
): Promise<{ ok: boolean; warning?: string }> {
  if (!input.client_user_id || !input.event_id || !input.interaction) {
    return { ok: false, warning: 'missing required feedback fields' };
  }
  const row = {
    client_user_id: input.client_user_id,
    session_id:     input.session_id ?? null,
    event_id:       input.event_id,
    interaction:    input.interaction,
    query_text:     input.query_text ?? null,
    rank_position:  input.rank_position ?? null,
    reasons:        input.reasons ?? [],
    metadata:       input.metadata ?? {},
  };

  const { error } = await supabase.from('user_interactions').insert(row);
  if (error) {
    return { ok: false, warning: `feedback insert failed: ${error.message}` };
  }
  return { ok: true };
}
