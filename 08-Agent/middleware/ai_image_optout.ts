/**
 * 08-Agent/middleware/ai_image_optout.ts
 *
 * Admin-only endpoint to set the `image_ai_optout` flag on a single event.
 * Used by venues that want to keep their original pressbild (per-event opt-out
 * from the AI-image rollout).
 *
 * Wire:
 *   POST /agent/ai-image/optout
 *     Headers: Authorization: Bearer <AGENT_ADMIN_TOKEN>
 *     Body: { event_id: string (uuid), optout: boolean }
 *     200 OK → { ok: true, event_id, optout }
 *     400   → { error: 'invalid body' | 'event_id must be a uuid' | 'optout must be boolean' }
 *     401   → { error: 'unauthorized' } (delegated to requireAdmin)
 *     404   → { error: 'event not found' }
 *     500   → { error: <supabase message> }
 *
 * Side effects:
 *   - Writes `events.image_ai_optout = optout`.
 *   - When optout=true: also resets `image_generation_status='failed'` and
 *     clears `image_ai_generated` flags so the worker skips the event on
 *     subsequent runs (the worker's opt-out check is in aiImageWorker.ts).
 *   - When optout=false: re-arms the event for AI generation by setting
 *     `image_generation_status='pending'` and `image_ai_generated=false`,
 *     so the next worker pass picks it up.
 *
 * IMPORTANT: this endpoint requires the AGENT_ADMIN_TOKEN. Without the
 * middleware gate, anyone could opt-out any event and break the rollout.
 */

import type { Request, Response, Router } from 'express';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OptOutBody {
  event_id?: unknown;
  optout?: unknown;
}

/**
 * Build a router with the POST /agent/ai-image/optout handler.
 *
 * @param requireAdmin  - Bearer-token middleware (createAdminAuth())
 * @param sb            - Supabase client. Optional — falls back to env-based client.
 */
export function createAiImageOptOutRouter(
  requireAdmin: express.RequestHandler,
  sb: SupabaseClient,
): Router {
  const router = express.Router();

  router.post('/optout', requireAdmin, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as OptOutBody;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (typeof body.event_id !== 'string' || !UUID_RE.test(body.event_id)) {
      res.status(400).json({ error: 'event_id must be a uuid' });
      return;
    }
    if (typeof body.optout !== 'boolean') {
      res.status(400).json({ error: 'optout must be boolean' });
      return;
    }

    // 1. Verify event exists.
    const { data: existing, error: lookupErr } = await sb
      .from('events')
      .select('id')
      .eq('id', body.event_id)
      .maybeSingle();
    if (lookupErr) {
      res.status(500).json({ error: lookupErr.message });
      return;
    }
    if (!existing) {
      res.status(404).json({ error: 'event not found' });
      return;
    }

    // 2. Apply opt-out (or clear it).
    const update = body.optout
      ? {
          image_ai_optout: true,
          image_ai_generated: false,
          image_generation_status: 'failed',
          // Preserve existing image_url (the venue's original) — do NOT null it.
        }
      : {
          image_ai_optout: false,
          image_ai_generated: false,
          image_generation_status: 'pending',
          image_url: null,  // force regeneration on next worker pass
          image_generation_error: null,
          image_generation_attempts: 0,
        };

    const { data, error } = await sb
      .from('events')
      .update(update)
      .eq('id', body.event_id)
      .select('id, image_ai_optout, image_generation_status')
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      ok: true,
      event_id: data.id,
      optout: data.image_ai_optout,
      status: data.image_generation_status,
    });
  });

  return router;
}
