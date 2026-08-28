/**
 * Integration test: record_feedback against live Supabase.
 *
 * Verifies the Phase 1 verify line:
 *   "Integration test against live DB verifies impression/click/save/reject/outbound
 *    all persist."
 *
 * Steps:
 *   1. Connect to live Supabase using service_role.
 *   2. Pick a real event_id and a fresh ephemeral client_user_id.
 *   3. Insert one row of each Phase 1 interaction:
 *      impression, click, save, reject (with reject_reason), outbound.
 *   4. Read them back and assert row count + metadata.reject_reason.
 *   5. Clean up by deleting the rows we just inserted.
 *
 * Run: npx tsx 08-Agent/scripts/record_feedback_integration.ts
 *
 * Pre-req: 05-Supabase/migrations/20260821-0001-user-interaction-reject.sql must be
 * applied. The test asserts on the `reject` value being allowed.
 *
 * Idempotent: re-running picks a fresh client_user_id and cleans up old runs.
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  recordFeedback,
  validateFeedbackInput,
} from '../tools/record_feedback';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(2);
}

const sb: SupabaseClient = createClient(URL, KEY, { auth: { persistSession: false } });

const INTERACTIONS = ['impression', 'click', 'save', 'reject', 'outbound'] as const;
const TAG = `record_feedback_integration_${Date.now()}`;

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
}

const steps: Step[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  steps.push({ name, ok, detail });
  const tag = ok ? 'OK ' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function pickEventId(): Promise<string> {
  const { data, error } = await sb.from('events').select('id').limit(1).maybeSingle();
  if (error || !data) throw new Error(`no event available: ${error?.message ?? 'empty'}`);
  return data.id;
}

async function main(): Promise<void> {
  const eventId = await pickEventId();
  const clientUserId = randomUUID();
  const sessionId = randomUUID();
  console.log(`event_id=${eventId} user_id=${clientUserId} session=${sessionId}`);

  // 1. validator covers the five funnel interactions
  for (const i of INTERACTIONS) {
    const err = validateFeedbackInput({
      client_user_id: clientUserId,
      event_id: eventId,
      interaction: i,
      reject_reason: i === 'reject' ? 'too_expensive' : undefined,
    });
    record(`validate ${i}`, err === null, err ?? 'null');
  }

  // 2. record_feedback inserts each one
  for (const i of INTERACTIONS) {
    const result = await recordFeedback(sb, {
      client_user_id: clientUserId,
      session_id: sessionId,
      event_id: eventId,
      interaction: i,
      query_text: 'integration test query',
      rank_position: i === 'impression' ? 0 : null,
      reject_reason: i === 'reject' ? 'too_expensive' : undefined,
      metadata: { tag: TAG },
    });
    record(`insert ${i}`, result.ok, result.warning ?? `reject_reason=${result.reject_reason ?? 'null'}`);
  }

  // 3. read back to confirm persistence
  const { data, error } = await sb
    .from('user_interactions')
    .select('interaction, metadata, rank_position')
    .eq('client_user_id', clientUserId);

  if (error) {
    record('read back', false, error.message);
  } else {
    const byInteraction = new Map<string, { metadata: { reject_reason?: string }; rank_position: number | null }>();
    for (const row of data ?? []) {
      byInteraction.set(row.interaction, {
        metadata: (row.metadata ?? {}) as { reject_reason?: string },
        rank_position: row.rank_position,
      });
    }
    for (const i of INTERACTIONS) {
      const ok = byInteraction.has(i);
      const rejectReason = byInteraction.get(i)?.metadata?.reject_reason ?? null;
      const expectedReject = i === 'reject' ? 'too_expensive' : null;
      const rejectOk = rejectReason === expectedReject;
      record(
        `persist ${i}`,
        ok && rejectOk,
        `found=${ok} reject_reason=${rejectReason} (expected ${expectedReject})`
      );
    }
  }

  // 4. clean up
  const { error: delErr } = await sb.from('user_interactions').delete().eq('client_user_id', clientUserId);
  record('cleanup', !delErr, delErr?.message ?? `deleted ${(data ?? []).length} rows`);

  // 5. report
  const failed = steps.filter((s) => !s.ok);
  console.log('');
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.length}/${steps.length} steps failed`);
    process.exit(1);
  }
  console.log(`PASSED: ${steps.length}/${steps.length} steps`);
}

main().catch((err) => {
  console.error('integration test crashed:', err);
  process.exit(3);
});
