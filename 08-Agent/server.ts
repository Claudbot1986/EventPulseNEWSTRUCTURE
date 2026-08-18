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
    next();
  });

  app.get('/agent/health', (_req, res) => {
    res.json({ ok: true, phase: 0 });
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

      const cards: EventCard[] = ranked.map((r) => r.card);

      // Log an "impression" per result. Best-effort, never throw.
      for (let i = 0; i < cards.length; i++) {
        await recordFeedback(client, {
          client_user_id: body.client_user_id,
          session_id: body.session_id,
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

  return app;
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const port = Number(process.env.AGENT_PORT ?? 8787);
  buildApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[08-Agent] listening on :${port}`);
  });
}
