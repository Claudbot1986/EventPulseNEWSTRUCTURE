/**
 * Tests for llmRouter — fallback behavior + JSON parsing + wire-format guards.
 *
 * Live LLM calls are not exercised here. The Anthropic SDK path is mocked
 * via env var + fallback assertion. Integration with the real API is
 * verified manually via `npx tsx 08-Agent/server.ts` + curl.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeReply,
  deterministicReply,
  parseReplyJson,
  buildUserMessage,
  filterHighlightedIds,
} from '../llmRouter';
import type { EventCard, IntentBrief } from '../types';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class BoomClient {
      messages = { create: async () => { throw new Error('network down'); } };
    },
  };
});

const originalKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

const baseIntent: IntentBrief = {
  raw_query: 'konsert ikväll',
  time_of_day: 'evening',
  budget: 'any',
  party: 'any',
  categories: ['music'],
  city: 'Stockholm',
  language: 'sv',
  date_from: '2026-08-18',
  date_to: '2026-08-18',
  exclude_categories: [],
};

const baseCards: EventCard[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    title: 'Emmylou Harris',
    start_time: '2026-08-26T17:30:00Z',
    end_time: null,
    venue_name: '',
    city: 'Stockholm',
    category_slug: 'music',
    price_min_sek: null,
    price_max_sek: null,
    is_free: false,
    ticket_url: 'https://example.com',
    image_url: null,
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    title: 'Dvořák Serenad',
    start_time: '2026-08-27T17:00:00Z',
    end_time: null,
    venue_name: '',
    city: 'Stockholm',
    category_slug: 'music',
    price_min_sek: null,
    price_max_sek: null,
    is_free: false,
    ticket_url: null,
    image_url: null,
  },
];

describe('deterministicReply', () => {
  it('returns Swedish "nothing tonight" when cards empty', () => {
    const r = deterministicReply({ intent: baseIntent, cards: [], warnings: [] });
    expect(r.reply).toMatch(/Stockholm/);
    expect(r.highlightedIds).toEqual([]);
  });

  it('returns English equivalent when language is en', () => {
    const r = deterministicReply({
      intent: { ...baseIntent, language: 'en' },
      cards: baseCards,
      warnings: [],
    });
    expect(r.reply).toMatch(/picks in Stockholm/);
    expect(r.highlightedIds).toEqual([baseCards[0].id]);
  });
});

describe('parseReplyJson', () => {
  it('parses plain JSON', () => {
    expect(parseReplyJson('{"reply":"hej","highlightedIds":["x"]}'))
      .toEqual({ reply: 'hej', highlightedIds: ['x'] });
  });

  it('strips ```json fences', () => {
    const text = '```json\n{"reply":"hej"}\n```';
    expect(parseReplyJson(text)?.reply).toBe('hej');
  });

  it('extracts the first JSON object out of prose', () => {
    const text = 'Tänker... {"reply":"hej","highlightedIds":[]} Klart.';
    expect(parseReplyJson(text)?.reply).toBe('hej');
  });

  it('returns null on garbage', () => {
    expect(parseReplyJson('inte json alls')).toBeNull();
    expect(parseReplyJson('{broken')).toBeNull();
  });
});

describe('buildUserMessage', () => {
  it('serializes a JSON envelope with cards and intent', () => {
    const msg = JSON.parse(
      buildUserMessage({ intent: baseIntent, cards: baseCards, warnings: ['w'] })
    );
    expect(msg.user_language).toBe('sv');
    expect(msg.user_query).toBe('konsert ikväll');
    expect(msg.card_count).toBe(2);
    expect(msg.cards).toHaveLength(2);
    expect(msg.cards[0].id).toBe(baseCards[0].id);
    expect(msg.warnings).toEqual(['w']);
  });
});

describe('composeReply (LLM disabled path)', () => {
  it('falls back to deterministic when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await composeReply({ intent: baseIntent, cards: baseCards, warnings: [] });
    expect(r.usedLlm).toBe(false);
    expect(r.reply).toMatch(/förslag i Stockholm/);
    expect(r.highlightedIds).toEqual([baseCards[0].id]);
  });

  it('falls back when ANTHROPIC_API_KEY is set but SDK fails (mocked)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const r = await composeReply({ intent: baseIntent, cards: baseCards, warnings: [] });
    expect(r.usedLlm).toBe(false);
    expect(r.reply).toBeDefined();
    expect(r.highlightedIds.every((id) => baseCards.some((c) => c.id === id))).toBe(true);
  });

  it('returns empty highlightedIds when no cards match', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await composeReply({ intent: baseIntent, cards: [], warnings: [] });
    expect(r.reply).toMatch(/inget som matchar/);
    expect(r.highlightedIds).toEqual([]);
  });
});

/**
 * Anti-hallucination contract — `filterHighlightedIds` is the SOLE mechanism
 * preventing the model from injecting fabricated event ids into the wire
 * response. See MASTERPLAN §16 risk + llmRouter.ts header.
 *
 * These tests prove:
 *   - ids not present in the deterministic input cards are silently dropped
 *   - the deterministic pipeline (not the LLM) is the only source of card ids
 *     that ever reaches the wire format
 */
describe('filterHighlightedIds (anti-hallucination)', () => {
  const cards = [
    { id: 'card-a' },
    { id: 'card-b' },
    { id: 'card-c' },
    { id: 'card-d' },
  ];

  it('drops ids not in inputCards (model fabrication)', () => {
    const result = filterHighlightedIds(
      ['card-a', 'fabricated-id-1', 'card-b', 'totally-fake-uuid'],
      cards,
      3
    );
    expect(result).toEqual(['card-a', 'card-b']);
  });

  it('preserves input order of allowed ids', () => {
    const result = filterHighlightedIds(
      ['card-c', 'card-a', 'card-d'],
      cards,
      3
    );
    expect(result).toEqual(['card-c', 'card-a', 'card-d']);
  });

  it('caps output at max even when more allowed ids are valid', () => {
    const result = filterHighlightedIds(
      ['card-a', 'card-b', 'card-c', 'card-d'],
      cards,
      2
    );
    expect(result).toEqual(['card-a', 'card-b']);
  });

  it('drops non-string entries (numbers, null, objects, booleans)', () => {
    const result = filterHighlightedIds(
      ['card-a', 42, null, { id: 'card-b' }, 'card-c', undefined, true],
      cards,
      5
    );
    // Objects are NOT unwrapped — only top-level string ids are validated.
    expect(result).toEqual(['card-a', 'card-c']);
  });

  it('drops empty-string ids', () => {
    const result = filterHighlightedIds(['', 'card-a'], cards, 5);
    expect(result).toEqual(['card-a']);
  });

  it('returns empty array when inputCards is empty', () => {
    const result = filterHighlightedIds(['card-a', 'card-b'], [], 3);
    expect(result).toEqual([]);
  });

  it('returns empty array when max <= 0', () => {
    expect(filterHighlightedIds(['card-a'], cards, 0)).toEqual([]);
    expect(filterHighlightedIds(['card-a'], cards, -1)).toEqual([]);
  });

  it('returns empty array when parsedIds is not an array', () => {
    expect(filterHighlightedIds(null, cards, 3)).toEqual([]);
    expect(filterHighlightedIds(undefined, cards, 3)).toEqual([]);
    expect(filterHighlightedIds('card-a', cards, 3)).toEqual([]);
    expect(filterHighlightedIds({ ids: ['card-a'] }, cards, 3)).toEqual([]);
  });

  it('returns empty array when parsedIds is empty', () => {
    expect(filterHighlightedIds([], cards, 3)).toEqual([]);
  });

  it('drops every id when all inputs are fabricated (worst-case model failure)', () => {
    // Belt-and-suspenders: this is the proof that the deterministic pipeline,
    // not the model, is the sole source of card ids in the wire response.
    const result = filterHighlightedIds(
      ['evt-fake-1', 'evt-fake-2', 'evt-fake-3'],
      cards,
      3
    );
    expect(result).toEqual([]);
    expect(result.some((id) => !cards.some((c) => c.id === id))).toBe(false);
  });
});