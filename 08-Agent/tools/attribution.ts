/**
 * attribution — per-organizer outbound click attribution (Workstream F).
 *
 * The agent's business model depends on being able to answer
 *   "How many qualified visitors did we send you this month?"
 * for each organizer. This module is the foundation for that measurement.
 *
 * It is intentionally minimal:
 *   1. recordOutboundClick — write a single click row when the user is sent
 *      to an organizer's ticket URL. Best-effort: a failed insert MUST NOT
 *      break the chat response.
 *   2. summarizeOutboundByOrganizer — pure aggregator over a row array.
 *      Bucket by organizer_id (falling back to events.source when the FK is
 *      not yet backfilled). No client_user_id is echoed back to the caller.
 *
 * Privacy:
 *   - The row schema persists ONLY: client_user_id (random UUID from
 *     AsyncStorage), session_id, event_id, organizer_id, source,
 *     ticket_url, clicked_at, small metadata blob.
 *   - We deliberately do NOT persist IP, lat/lng, precise location, or
 *     user_agent. See migration comment in 20260820-0001-outbound-attribution.sql.
 *
 * Conventions:
 *   - Input validated with Zod at the boundary (this repo's pattern).
 *   - Explicit parameter + return types on every export; no `any`.
 *   - Same best-effort return shape as `record_feedback.ts`:
 *       { ok: boolean, warning?: string }
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ─── Schemas ────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidString = z
  .string()
  .regex(UUID_RE, { message: 'must be a uuid' });

const RecordOutboundClickSchema = z.object({
  client_user_id: uuidString,
  session_id:     uuidString.optional(),
  event_id:       uuidString,
  organizer_id:   uuidString.nullable().optional(),
  source:         z.string().min(1).max(64).nullable().optional(),
  ticket_url:     z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          const p = new URL(u);
          return p.protocol === 'http:' || p.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'ticket_url must be http or https' }
    ),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .refine(
      (m) => m === undefined || JSON.stringify(m).length <= 2048,
      { message: 'metadata too large (>2KB serialized)' }
    ),
});

export type RecordOutboundClickInput = z.input<typeof RecordOutboundClickSchema>;

// ─── Row shape (for the aggregator) ─────────────────────────────────────────

/** Raw row returned by a Supabase select of `outbound_clicks`. */
export interface OutboundClickRow {
  clicked_at: Date | string;
  organizer_id: string | null;
  source: string | null;
  event_id: string;
  /** UUID. Used only for unique-user counting; never echoed back. */
  client_user_id: string;
}

/** One bucket in the per-organizer summary. */
export interface OrganizerBucket {
  /** Bucket key: organizer_id (uuid) or "source:<source>" when organizer_id is null. */
  key: string;
  organizer_id: string | null;
  source: string | null;
  clicks: number;
  unique_users: number;
  events: number;
}

export interface OutboundSummaryOptions {
  from: Date;
  to: Date;
  topN?: number;
}

export interface OutboundSummary {
  from: string;
  to: string;
  total_clicks: number;
  total_unique_users: number;
  buckets: OrganizerBucket[];
}

// ─── Persist ────────────────────────────────────────────────────────────────

export async function recordOutboundClick(
  supabase: SupabaseClient,
  input: RecordOutboundClickInput
): Promise<{ ok: boolean; warning?: string }> {
  const parsed = RecordOutboundClickSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.join('.') || 'input';
    const msg = issue?.message ?? 'unknown';
    return {
      ok: false,
      warning: `invalid outbound click input: ${field}: ${msg}`,
    };
  }
  const row = {
    client_user_id: parsed.data.client_user_id,
    session_id:     parsed.data.session_id ?? null,
    event_id:       parsed.data.event_id,
    organizer_id:   parsed.data.organizer_id ?? null,
    source:         parsed.data.source ?? null,
    ticket_url:     parsed.data.ticket_url,
    metadata:       parsed.data.metadata ?? {},
  };
  const { error } = await supabase.from('outbound_clicks').insert(row);
  if (error) {
    return { ok: false, warning: `outbound_clicks insert failed: ${error.message}` };
  }
  return { ok: true };
}

// ─── Aggregate ──────────────────────────────────────────────────────────────

/**
 * Pure aggregator. Given a set of rows (typically fetched via Supabase range
 * select over a date window) and a window, return per-organizer buckets.
 *
 * Bucket key rules:
 *   - organizer_id present → key = organizer_id (stable, FK-resolved).
 *   - organizer_id NULL   → key = "source:<source>" (best-effort grouping
 *     until the organizer backfill lands — see masterplan §4).
 *
 * The output NEVER includes client_user_id values — only counts.
 */
export function summarizeOutboundByOrganizer(
  rows: readonly OutboundClickRow[],
  opts: OutboundSummaryOptions
): OutboundSummary {
  const fromMs = opts.from.getTime();
  const toMs   = opts.to.getTime();

  type Acc = OrganizerBucket & {
    _users: Set<string>;
    _events: Set<string>;
  };
  const acc = new Map<string, Acc>();

  let totalClicks = 0;
  const totalUsers = new Set<string>();

  for (const row of rows) {
    const t = typeof row.clicked_at === 'string'
      ? Date.parse(row.clicked_at)
      : row.clicked_at.getTime();
    if (Number.isNaN(t) || t < fromMs || t > toMs) continue;

    const key = row.organizer_id
      ? row.organizer_id
      : `source:${row.source ?? 'unknown'}`;

    let bucket = acc.get(key);
    if (!bucket) {
      bucket = {
        key,
        organizer_id: row.organizer_id,
        source: row.source,
        clicks: 0,
        unique_users: 0,
        events: 0,
        _users: new Set<string>(),
        _events: new Set<string>(),
      };
      acc.set(key, bucket);
    }
    bucket.clicks += 1;
    bucket._users.add(row.client_user_id);
    bucket._events.add(row.event_id);
    totalClicks += 1;
    totalUsers.add(row.client_user_id);
  }

  const allBuckets: OrganizerBucket[] = [];
  acc.forEach((b) => {
    allBuckets.push({
      key: b.key,
      organizer_id: b.organizer_id,
      source: b.source,
      clicks: b.clicks,
      unique_users: b._users.size,
      events: b._events.size,
    });
  });
  allBuckets.sort((a, b) => b.clicks - a.clicks || a.key.localeCompare(b.key));

  const buckets = opts.topN && opts.topN > 0
    ? allBuckets.slice(0, opts.topN)
    : allBuckets;

  return {
    from: opts.from.toISOString(),
    to:   opts.to.toISOString(),
    total_clicks: totalClicks,
    total_unique_users: totalUsers.size,
    buckets,
  };
}
