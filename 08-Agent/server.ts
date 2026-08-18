/**
 * 08-Agent/server — Express HTTP entry for the private agent API.
 *
 * Phase 0 surface:
 *   POST /agent/chat  → returns AgentChatResponse
 *
 * Lockdown:
 *   - Origin allowlist via AGENT_ALLOWED_ORIGINS (comma-separated).
 *   - client_user_id is treated as opaque user-supplied UUID; the agent only
 *     persists feedback/interactions against it. There is no login flow yet.
 *
 * Deterministic pipeline (no LLM yet — Phase 0):
 *   parse_intent → search_events → rank_events → top-5 → log impression → respond
 *
 * The composer wraps results in the SystemPrompt contract so the LLM layer
 * can be slotted in later without changing the wire format.
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseIntent } from './tools/parse_intent';
import { searchEvents } from './tools/search_events';
import { rankEvents } from './tools/rank_events';
import { recordFeedback } from './tools/record_feedback';
import { findGaps } from './tools/find_gaps';
import { feedEvents, todayIso, addDays } from './tools/feed_events';
import { composeReply } from './llmRouter';
import type {
  AgentChatRequest,
  AgentChatResponse,
  EventCard,
} from './types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getAllowedOrigins(): string[] {
  const raw = process.env.AGENT_ALLOWED_ORIGINS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured`);
  return v;
}

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (supabase) return supabase;
  supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );
  return supabase;
}

export function buildApp(opts: { supabase?: SupabaseClient } = {}): express.Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const allowedOrigins = getAllowedOrigins();
  const sb = opts.supabase ?? null;

  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'origin not allowed' });
      return;
    }
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Origin'
      );
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/agent/health', (_req, res) => {
    res.json({ ok: true, phase: 0 });
  });

  /**
   * GET /agent/feed?from=YYYY-MM-DD&days=7&category=music&city=Stockholm
   *
   * Browse-window reader for the default-browse UI. Defaults to "today + 7 days".
   * Returns the events_public slice in [from, from+days), plus echo of the
   * window and a `has_more` flag so the client can advance by 7-day chunks.
   *
   * Same lockdown as /agent/chat: origin allowlist + service_role only.
   */
  app.get('/agent/feed', async (req: Request, res: Response) => {
    const client = sb ?? getSupabase();
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : todayIso();
    const days = typeof req.query.days === 'string'
      ? Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30)
      : 7;
    const category = typeof req.query.category === 'string' && req.query.category
      ? req.query.category
      : null;
    const city = typeof req.query.city === 'string' && req.query.city
      ? req.query.city
      : 'Stockholm';

    try {
      const result = await feedEvents(client, { from, days, category, city });
      res.json({
        events: result.events,
        from: result.from,
        to: result.to,
        has_more: result.has_more,
        next_from: addDays(result.from, days),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/agent/chat', async (req: Request, res: Response) => {
    const body = req.body as Partial<AgentChatRequest>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (!body.client_user_id || !UUID_RE.test(body.client_user_id)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    if (!body.message || typeof body.message !== 'string') {
      res.status(400).json({ error: 'message required' });
      return;
    }

    const client = sb ?? getSupabase();

    // session_id is optional; if present it must be a uuid (DB column is uuid).
    // Silently drop malformed session_ids rather than failing the chat request.
    const chatSessionId: string | undefined =
      typeof body.session_id === 'string' && UUID_RE.test(body.session_id)
        ? body.session_id
        : undefined;

    try {
      const intent = await parseIntent(body.message);

      // Cold-start gate: if critical intent slots are missing, ask the user
      // instead of guessing. The deterministic pipeline never runs with a
      // thin intent — we either have enough signal to search or we ask.
      const gaps = findGaps(intent);
      if (gaps.length > 0) {
        const leadIn =
          intent.language === 'sv'
            ? 'Jag vill gärna hjälpa dig — berätta lite mer:'
            : "I'd love to help — tell me a bit more:";
        const out: AgentChatResponse = {
          session_id: body.session_id ?? 'pending',
          reply: leadIn,
          cards: [],
          warnings: [],
          clarifying_questions: gaps,
        };
        res.json(out);
        return;
      }

      const search = await searchEvents(client, {
        city: intent.city,
        date_from: intent.date_from,
        date_to: intent.date_to,
        categories: intent.categories.length > 0 ? intent.categories : undefined,
        exclude_categories: intent.exclude_categories.length > 0 ? intent.exclude_categories : undefined,
        is_free: intent.budget === 'free' ? true : null,
        limit: 25,
      });

      const ranked = rankEvents(search.events, intent, { topN: 5 });

      const cards: EventCard[] = ranked.map((r) => ({
        ...r.card,
        reasons: r.reasons,
        score: r.score,
      }));

      // Log an "impression" per result. Best-effort, never throw.
      for (let i = 0; i < cards.length; i++) {
        await recordFeedback(client, {
          client_user_id: body.client_user_id,
          session_id: chatSessionId,
          event_id: cards[i].id,
          interaction: 'impression',
          query_text: body.message,
          rank_position: i,
          reasons: ranked[i].reasons,
        });
      }

      const replyResult = await composeReply({
        intent,
        cards,
        warnings: search.warnings,
      });

      const out: AgentChatResponse = {
        session_id: body.session_id ?? 'pending',
        reply: replyResult.reply,
        cards,
        warnings: search.warnings,
      };
      res.json(out);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/agent/feedback', async (req: Request, res: Response) => {
    const body = req.body as Partial<{
      client_user_id: string;
      session_id?: string;
      event_id: string;
      interaction: string;
      query_text?: string;
      metadata?: Record<string, unknown>;
    }>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    if (!body.client_user_id || !UUID_RE.test(body.client_user_id)) {
      res.status(400).json({ error: 'client_user_id must be a uuid' });
      return;
    }
    if (!body.event_id || !UUID_RE.test(body.event_id)) {
      res.status(400).json({ error: 'event_id must be a uuid' });
      return;
    }
    // session_id is optional, but if present it MUST be a uuid (DB column is uuid).
    // Silently drop malformed session_ids rather than failing the whole feedback.
    const sessionId: string | undefined =
      typeof body.session_id === 'string' && UUID_RE.test(body.session_id)
        ? body.session_id
        : undefined;
    const ALLOWED = new Set([
      'impression', 'click', 'outbound', 'save',
      'dismiss', 'feedback_positive', 'feedback_negative',
    ]);
    if (!body.interaction || !ALLOWED.has(body.interaction)) {
      res.status(400).json({ error: `interaction must be one of: ${[...ALLOWED].join(', ')}` });
      return;
    }

    const client = sb ?? getSupabase();
    const result = await recordFeedback(client, {
      client_user_id: body.client_user_id,
      session_id:     sessionId,
      event_id:       body.event_id,
      interaction:    body.interaction as 'impression' | 'click' | 'outbound' | 'save' | 'dismiss' | 'feedback_positive' | 'feedback_negative',
      query_text:     body.query_text,
      metadata:       body.metadata,
    });

    if (!result.ok) {
      res.status(202).json({ ok: false, warning: result.warning ?? 'unknown' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/agent/metrics', async (_req: Request, res: Response) => {
    const client = sb ?? getSupabase();
    try {
      const { data, error } = await client
        .from('user_interactions')
        .select('interaction');
      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.interaction] = (counts[row.interaction] ?? 0) + 1;
      }
      const impressions = counts.impression ?? 0;
      const clicks      = counts.click ?? 0;
      const outbounds   = counts.outbound ?? 0;
      const ctr         = impressions > 0 ? outbounds / impressions : 0;
      res.json({
        impressions,
        clicks,
        outbounds,
        saves:       counts.save ?? 0,
        ctr:         Number(ctr.toFixed(4)),
        total_rows:  (data ?? []).length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      res.status(500).json({ error: msg });
    }
  });

  return app;
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const port = Number(process.env.AGENT_PORT ?? 8787);
  buildApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[08-Agent] listening on :${port}`);
  });
}
