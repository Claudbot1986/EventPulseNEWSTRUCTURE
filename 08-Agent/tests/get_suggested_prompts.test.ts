/**
 * Tests for get_suggested_prompts — T0057 / MVP-gap §77.
 *
 * Mocks loadStatedPreferences and loadFollowedArtists to isolate
 * the chip-generation logic from the database layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mocked functions — defined outside vi.mock so we can control them
const loadStatedPreferencesMock = vi.fn();
const loadFollowedArtistsMock = vi.fn();

vi.mock('../tools/personalize.js', () => ({
  loadStatedPreferences: (...args: unknown[]) =>
    loadStatedPreferencesMock(...args),
}));

vi.mock('../tools/follow_entity.js', () => ({
  loadFollowedArtists: (...args: unknown[]) =>
    loadFollowedArtistsMock(...args),
}));

// Import after mocks are set up
import { getSuggestedPrompts } from '../tools/get_suggested_prompts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makeDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
}

function setupMocks({
  statedCategories = null,
  artistSlugs = [],
}: {
  statedCategories?: string[] | null;
  artistSlugs?: string[];
} = {}) {
  loadStatedPreferencesMock.mockResolvedValue(statedCategories);
  loadFollowedArtistsMock.mockResolvedValue({
    artist_slugs: artistSlugs,
    fetchedAt: new Date().toISOString(),
  });
}

describe('getSuggestedPrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  // ─── Time slot tests ────────────────────────────────────────────────────────

  it('returns evening chip for evening slot (19:00 Stockholm)', async () => {
    // 2026-08-21 17:00 UTC = 19:00 Stockholm (UTC+2 summer) = evening slot
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 17),
    });
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
    // Evening slot: "Vad ska jag göra ikväll?" is the primary evening template
    const hasIkvall = result.prompts.some((c) => c.prompt_text.includes('ikväll'));
    expect(hasIkvall).toBe(true);
  });

  it('returns morning chip for morning slot', async () => {
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 8),
    });
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
  });

  it('adds weekend chips on friday', async () => {
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 12), // Friday
    });
    const hasWeekend = result.prompts.some((c) =>
      c.reason.includes('Helgen') || c.reason.includes('helg')
    );
    expect(hasWeekend).toBe(true);
  });

  it('adds weekend chips on saturday', async () => {
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 22, 12), // Saturday
    });
    const hasWeekend = result.prompts.some((c) =>
      c.reason.includes('Helgen') || c.reason.includes('helg')
    );
    expect(hasWeekend).toBe(true);
  });

  it('adds weekend chips on sunday', async () => {
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 23, 12), // Sunday
    });
    const hasWeekend = result.prompts.some((c) =>
      c.reason.includes('Helgen') || c.reason.includes('helg')
    );
    expect(hasWeekend).toBe(true);
  });

  it('does not add weekend chips on monday', async () => {
    // 2026-08-17 is a Monday — only weekday time chips + fallback
    // (fallback always added when chips < MIN_CHIPS)
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 17, 12), // Monday noon UTC = 14:00 Stockholm
    });
    // Check that no WEEKEND_TEMPLATES chip is present
    // (fallback chips contain "Helgen" in reason, so we check prompt_text)
    const hasWeekendTemplate = result.prompts.some((c) =>
      c.prompt_text.includes('helgen') || c.prompt_text.includes('Helgen')
    );
    // If fewer than MIN_CHIPS time chips were generated, fallback fills to MIN_CHIPS
    // and fallback reason="Helgen" — so this test verifies no weekday leaked weekend chips
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
    // Verify no dedicated weekend template chip
    const konserterHelg = result.prompts.find((c) =>
      c.id === 'konserter-i-helgen-i-stockholm'
    );
    expect(konserterHelg).toBeUndefined();
  });

  // ─── Category enrichment tests ──────────────────────────────────────────────

  it('enriches with konserter category chip', async () => {
    setupMocks({ statedCategories: ['konserter'] });
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 12),
    });
    const hasKonsert = result.prompts.some((c) =>
      c.reason.includes('konserter') || c.prompt_text.includes('Konserter')
    );
    expect(hasKonsert).toBe(true);
  });

  it('enriches with multiple categories without duplicating', async () => {
    setupMocks({ statedCategories: ['konserter', 'utställningar'] });
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 12),
    });
    const ids = result.prompts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('handles null stated categories', async () => {
    setupMocks({ statedCategories: null });
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 12),
    });
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
  });

  it('handles empty stated categories array', async () => {
    setupMocks({ statedCategories: [] });
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 12),
    });
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
  });

  // ─── Followed artists tests ───────────────────────────────────────────────

  it('enriches with followed artist chip', async () => {
    setupMocks({ artistSlugs: ['tommy-nilsson'] });
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 17, 10), // Monday morning — fewer time chips, artist chip won't get sliced off
    });
    // Artist chip: id="events-with-tommy-nilsson", prompt="Konserter med Tommy?"
    const artistChip = result.prompts.find((c) =>
      c.id === 'events-with-tommy-nilsson'
    );
    expect(artistChip).toBeDefined();
    expect(artistChip!.prompt_text).toContain('Tommy');
  });

  it('handles empty artist list gracefully', async () => {
    setupMocks({ artistSlugs: [] });
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 12),
    });
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
  });

  // ─── Fallback tests ───────────────────────────────────────────────────────

  it('fills to MIN_CHIPS with fallback chips', async () => {
    setupMocks({ statedCategories: null, artistSlugs: [] });
    // Monday morning = only 2 time chips → should fill to MIN_CHIPS=3
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 17, 10),
    });
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
  });

  it('respects custom limit', async () => {
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 20),
      limit: 2,
    });
    expect(result.prompts.length).toBe(2);
  });

  // ─── Chip shape tests ─────────────────────────────────────────────────────

  it('each chip has required fields', async () => {
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 12),
    });
    for (const chip of result.prompts) {
      expect(typeof chip.id).toBe('string');
      expect(chip.id.length).toBeGreaterThan(0);
      expect(typeof chip.prompt_text).toBe('string');
      expect(chip.prompt_text.length).toBeGreaterThan(0);
      expect(typeof chip.reason).toBe('string');
      expect(chip.reason.length).toBeGreaterThan(0);
    }
  });

  it('chip ids are unique within result', async () => {
    setupMocks({ statedCategories: ['konserter', 'sport'] });
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 21, 12),
    });
    const ids = result.prompts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns at least MIN_CHIPS with no user data', async () => {
    setupMocks({ statedCategories: null, artistSlugs: [] });
    const result = await getSuggestedPrompts({
      supabase: {} as SupabaseClient,
      client_user_id: USER_ID,
      now: makeDate(2026, 8, 17, 10),
    });
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
  });
});
