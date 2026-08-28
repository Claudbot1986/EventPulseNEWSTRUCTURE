/**
 * llmRouter — Phase 1 LLM-based reply composer.
 *
 * Pipeline position (server.ts):
 *   parse_intent → search_events → rank_events → [llmRouter.composeReply] → respond
 *
 * The LLM is an *explainer*, never a re-ranker. It receives the already-ranked
 * EventCard[] from the deterministic pipeline and produces:
 *   - reply:       short, conversational text in the user's language
 *   - highlightedIds: ids from the input cards that should be visually
 *                     emphasised (max 3)
 *
 * Anti-hallucination guarantee:
 *   - highlightedIds are filtered against the input cards. Any id the model
 *     fabricates is silently dropped.
 *   - The wire-format AgentChatResponse.cards is the deterministic pipeline's
 *     output, NOT the model's. The model never decides what cards to return.
 *
 * Failure modes:
 *   - SDK error / timeout / unparseable JSON → fallback to the deterministic
 *     template (same logic that Phase 0 used). The agent degrades gracefully.
 *   - Model returns no usable reply → fallback.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { EventCard, IntentBrief } from './types';
import { SYSTEM_PROMPT } from './prompts/system';

export const LLM_MODEL = 'claude-haiku-4-5-20251001';
const LLM_TIMEOUT_MS = 8_000;
const MAX_HIGHLIGHTS = 3;

export interface ComposeInput {
  intent: IntentBrief;
  cards: EventCard[];
  warnings: string[];
  /**
   * Optional: which constraint, if any, search_events had to relax to
   * surface these results. The composer surfaces it as honest Swedish
   * copy so the user knows why the date window or category filter was
   * widened. See MASTERPLAN §18.2 decision 4.
   *
   * `undefined` when the strict query matched.
   */
  relaxed_constraint?: 'date_window' | 'category' | null;
}

export interface ComposeResult {
  reply: string;
  highlightedIds: string[];
  /** True iff the LLM produced the reply; false iff we fell back to the template. */
  usedLlm: boolean;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  client = new Anthropic({ apiKey });
  return client;
}

export async function composeReply(input: ComposeInput): Promise<ComposeResult> {
  const fallback = deterministicReply(input);

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...fallback, usedLlm: false };
  }

  const userMsg = buildUserMessage(input);

  try {
    const response = await withTimeout(
      getClient().messages.create({
        model: LLM_MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      }),
      LLM_TIMEOUT_MS
    );

    const text = extractText(response);
    if (!text) return { ...fallback, usedLlm: false };

    const parsed = parseReplyJson(text);
    if (!parsed) return { ...fallback, usedLlm: false };

    const highlightedIds = filterHighlightedIds(
      parsed.highlightedIds,
      input.cards,
      MAX_HIGHLIGHTS
    );

    return {
      reply: parsed.reply ?? fallback.reply,
      highlightedIds,
      usedLlm: true,
    };
  } catch {
    return { ...fallback, usedLlm: false };
  }
}

/**
 * Anti-hallucination filter — keep only highlighted ids that match a card
 * the deterministic pipeline actually returned. Drop everything else.
 *
 * This is the *only* mechanism that prevents a model from injecting
 * fabricated event ids into the response. Even if the model hallucinates,
 * any id not in `inputCards` is silently dropped here.
 *
 * Exported as a pure helper so the contract is unit-testable without
 * mocking the Anthropic SDK.
 *
 * Rules:
 *   - Each kept id must be a non-empty string AND appear in inputCards.
 *   - Result is capped at `max` entries (preserves input order).
 *   - Non-string entries (numbers, null, objects) are filtered out.
 *   - inputCards is read-only — we never mutate it.
 */
export function filterHighlightedIds(
  parsedIds: unknown,
  inputCards: ReadonlyArray<{ id: string }>,
  max: number
): string[] {
  if (!Array.isArray(parsedIds) || inputCards.length === 0 || max <= 0) {
    return [];
  }
  const allowedIds = new Set(inputCards.map((c) => c.id));
  const out: string[] = [];
  for (const id of parsedIds) {
    if (out.length >= max) break;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (!allowedIds.has(id)) continue;
    out.push(id);
  }
  return out;
}

// ─── internals ──────────────────────────────────────────────────────────────

interface ParsedReply {
  reply?: string;
  highlightedIds?: string[];
}

export function buildUserMessage(input: ComposeInput): string {
  const { intent, cards, warnings, relaxed_constraint } = input;
  const cardSummary = cards.map((c) => ({
    id: c.id,
    title: c.title,
    start_time: c.start_time,
    category_slug: c.category_slug,
    price_min_sek: c.price_min_sek,
    price_max_sek: c.price_max_sek,
    is_free: c.is_free,
  }));

  return JSON.stringify({
    user_language: intent.language,
    user_query: intent.raw_query,
    intent: {
      time_of_day: intent.time_of_day,
      budget: intent.budget,
      party: intent.party,
      categories: intent.categories,
      date_from: intent.date_from,
      date_to: intent.date_to,
    },
    card_count: cards.length,
    cards: cardSummary,
    warnings,
    // Machine-readable relaxation label. The LLM should mirror the
    // deterministic copy when this is set — see deterministicReply.
    relaxed_constraint: relaxed_constraint ?? null,
    instruction:
      'Reply in the user\'s language. Return JSON: {"reply": "<text>", "highlightedIds": ["<id>", ...]}. ' +
      `Highlight at most ${MAX_HIGHLIGHTS} cards, by id, that best answer the user's query. ` +
      'If warnings exist, mention them in one short sentence. ' +
      'If relaxed_constraint is "date_window" or "category", mention in ONE short sentence that ' +
      'the search was widened (do not invent the original constraint). Do NOT invent events.',
  });
}

function extractText(response: unknown): string {
  if (
    response &&
    typeof response === 'object' &&
    'content' in response &&
    Array.isArray((response as { content: unknown[] }).content)
  ) {
    const blocks = (response as { content: Array<{ type?: string; text?: string }> }).content;
    const text = blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n')
      .trim();
    return text;
  }
  return '';
}

export function parseReplyJson(text: string): ParsedReply | null {
  // Strip common wrappers: ```json fences, leading prose.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  // Find the first JSON object in the candidate.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice);
    if (typeof obj !== 'object' || obj === null) return null;
    return obj as ParsedReply;
  } catch {
    return null;
  }
}

export function deterministicReply(input: ComposeInput): Omit<ComposeResult, 'usedLlm'> {
  const { intent, cards, warnings, relaxed_constraint } = input;
  const lang = intent.language;
  // Honest relaxation copy (MASTERPLAN §18.2 decision 4). The LLM
  // composer mirrors this; we keep the deterministic fallback in sync
  // so off-LLM responses tell the user what really happened.
  const relaxationSuffix =
    relaxed_constraint === 'date_window'
      ? (lang === 'sv'
          ? ' Hittade inget på just den dagen — här är ett bredare urval.'
          : " Couldn't find anything on that exact day — here's a wider selection.")
      : relaxed_constraint === 'category'
      ? (lang === 'sv'
          ? ' Hittade inget i den kategorin — här är andra förslag.'
          : " Nothing in that category — here are other picks.")
      : '';

  if (cards.length === 0) {
    const reply =
      (lang === 'sv'
        ? 'Jag hittar inget som matchar i Stockholm just nu.'
        : "I can't find a match in Stockholm right now.") + relaxationSuffix;
    return { reply, highlightedIds: [] };
  }
  const top = cards[0];
  const reply =
    (lang === 'sv'
      ? `Här är ${cards.length} förslag i Stockholm. Toppvalet är ${top.title}.`
      : `Here are ${cards.length} picks in Stockholm. Top pick: ${top.title}.`) + relaxationSuffix;
  // We don't surface warnings inline in the deterministic fallback —
  // the wire format already includes them as a separate field.
  void warnings;
  return { reply, highlightedIds: [top.id] };
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