/**
 * get_suggested_prompts — time-aware intent chips for HomeScreen.
 *
 * T0057 / MVP-gap §77 (Phase 1 retention).
 *
 * Returns 3–5 contextual prompt chips that convert passive HomeScreen browsing
 * into active agent sessions. Chips are generated from:
 *  - time of day / day of week (evening → "ikväll", weekend approaching → "helgen")
 *  - user's stated onboarding categories
 *  - user's followed venues / artists
 *
 * Each chip carries a `reason` field so the UI can label *why* it was shown
 * (e.g. "because you follow Debaser" or "because you're into Konserter").
 *
 * Response shape:
 *   { prompts: SuggestedPrompt[] }
 *
 *   SuggestedPrompt {
 *     id: string          — stable prompt key for deduplication / analytics
 *     prompt_text: string — Swedish natural-language query
 *     reason: string      — human-readable reason for this chip (SV)
 *     category?: string   — implied category slug if applicable
 *   }
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadStatedPreferences } from './personalize.js';
import { loadFollowedArtists } from './follow_entity.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHIP_LIMIT = 5;
const MIN_CHIPS = 3;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SuggestedPrompt {
  id: string;
  prompt_text: string;
  reason: string;
  category?: string;
}

export interface SuggestedPromptsResult {
  prompts: SuggestedPrompt[];
}

// ─── Time helpers ────────────────────────────────────────────────────────────

function stockholmNow(): Date {
  // Stockholm is UTC+2 in summer, UTC+1 in winter
  const offset = 2; // simplified — August = summer time
  const now = new Date();
  now.setHours(now.getUTCHours() + offset);
  return now;
}

function getTimeSlot(now: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const h = now.getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

function getDaySlot(now: Date): 'weekday' | 'friday' | 'saturday' | 'sunday' {
  const dow = now.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  if (dow === 5) return 'friday';
  if (dow === 6) return 'saturday';
  if (dow === 0) return 'sunday';
  return 'weekday';
}

// ─── Prompt templates ────────────────────────────────────────────────────────

const TIME_TEMPLATES: Record<string, { text: string; reason: string; category?: string }[]> = {
  morning: [
    { text: 'Något intressant i dag?', reason: 'Godmorgon!', category: undefined },
    { text: 'Konserter i Stockholm i helgen?', reason: 'Helgen närmar sig', category: 'konserter' },
  ],
  afternoon: [
    { text: 'Vad ska jag göra ikväll?', reason: 'Kvällstid', category: undefined },
    { text: 'Gratis events i helgen?', reason: 'Helgen närmar sig', category: undefined },
  ],
  evening: [
    { text: 'Vad ska jag göra ikväll?', reason: 'Nu på kvällen', category: undefined },
    { text: 'Konsert ikväll i Stockholm?', reason: 'Live musik ikväll', category: 'konserter' },
    { text: 'Något gratis ikväll?', reason: 'Senaste chansen i dag', category: undefined },
  ],
  night: [
    { text: 'Vad händer i helgen?', reason: 'Helgen väntar', category: undefined },
    { text: 'Planera för i morgon', reason: 'Imorgon är en ny dag', category: undefined },
  ],
};

const WEEKEND_TEMPLATES = [
  { text: 'Konserter i helgen i Stockholm?', reason: 'Helgen är här', category: 'konserter' },
  { text: 'Utställningar i helgen?', reason: 'Kulturhelg', category: 'utställningar' },
  { text: 'Något för barnen i helgen?', reason: 'Familjehelg', category: 'barn-familj' },
  { text: 'Gratis i helgen i Stockholm?', reason: 'Prispress', category: undefined },
  { text: 'Sport i helgen?', reason: 'Sport-helg', category: 'sport' },
];

const CATEGORY_TEMPLATES: Record<string, { text: string; category: string }[]> = {
  konserter: [
    { text: 'Konserter i Stockholm?', category: 'konserter' },
    { text: 'Lådbordskonserter?', category: 'konserter' },
    { text: 'Jazz i Stockholm?', category: 'jazz' },
  ],
  utställningar: [
    { text: 'Utställningar i Stockholm just nu?', category: 'utställningar' },
    { text: 'Gratis utställningar?', category: 'utställningar' },
  ],
  sport: [
    { text: 'Sport i Stockholm i helgen?', category: 'sport' },
    { text: 'Fotbollsmatcher i Stockholm?', category: 'sport' },
  ],
  'barn-familj': [
    { text: 'Barnvänliga events i helgen?', category: 'barn-familj' },
    { text: 'Något för hela familjen?', category: 'barn-familj' },
  ],
};

const FOLLOW_REASON_TEMPLATES = {
  artist: (name: string) => `Eftersom du följer ${name}`,
};

// ─── Core logic ─────────────────────────────────────────────────────────────

function makeChipId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^åäöéa-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

/**
 * Convert a kebab-case slug into a human-readable name.
 * `tommy-nilsson` → `Tommy Nilsson`. Used for display in prompts.
 */
function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildTimeChips(now: Date, limit: number): SuggestedPrompt[] {
  const slot = getTimeSlot(now);
  const daySlot = getDaySlot(now);
  const templates = TIME_TEMPLATES[slot] ?? TIME_TEMPLATES.afternoon;

  const chips: SuggestedPrompt[] = templates.slice(0, limit).map((t) => ({
    id: makeChipId(t.text),
    prompt_text: t.text,
    reason: t.reason,
    category: t.category,
  }));

  // Add weekend chips when it's Fri/Sat/Sun
  if (daySlot === 'friday' || daySlot === 'saturday' || daySlot === 'sunday') {
    const extra = WEEKEND_TEMPLATES.slice(0, 2).map((t) => ({
      id: makeChipId(t.text),
      prompt_text: t.text,
      reason: t.reason,
      category: t.category,
    }));
    for (const e of extra) {
      if (chips.length >= limit) break;
      if (!chips.some((c) => c.id === e.id)) chips.push(e);
    }
  }

  return chips.slice(0, limit);
}

function enrichWithCategories(
  chips: SuggestedPrompt[],
  statedCategories: string[] | null,
  limit: number
): SuggestedPrompt[] {
  if (!statedCategories || statedCategories.length === 0) return chips;

  const added: SuggestedPrompt[] = [];
  for (const cat of statedCategories) {
    if (chips.length + added.length >= limit) break;
    const templates = CATEGORY_TEMPLATES[cat];
    if (!templates) continue;
    const t = templates[0];
    const chip: SuggestedPrompt = {
      id: makeChipId(t.text),
      prompt_text: t.text,
      reason: `Eftersom du valt ${cat}`,
      category: t.category,
    };
    if (!chips.some((c) => c.id === chip.id) && !added.some((a) => a.id === chip.id)) {
      added.push(chip);
    }
  }

  return [...chips, ...added].slice(0, limit);
}

function enrichWithFollowed(
  chips: SuggestedPrompt[],
  followedArtistSlugs: string[],
  limit: number
): SuggestedPrompt[] {
  if (followedArtistSlugs.length === 0) return chips;

  const added: SuggestedPrompt[] = [];

  if (followedArtistSlugs.length > 0) {
    const artist = followedArtistSlugs[0];
    const displayName = humanizeSlug(artist);
    added.push({
      id: makeChipId(`events-with-${artist}`),
      prompt_text: `Konserter med ${displayName}?`,
      reason: FOLLOW_REASON_TEMPLATES.artist(displayName),
    });
  }

  return [...chips, ...added].slice(0, limit);
}

// ─── Main exported function ─────────────────────────────────────────────────

export interface GetSuggestedPromptsOptions {
  supabase: SupabaseClient;
  client_user_id: string;
  /** Override the current time for testing. */
  now?: Date;
  /** Maximum chips to return. Default 5. */
  limit?: number;
}

/**
 * Generate 3–5 suggested prompt chips for a user.
 *
 * Order of preference:
 *  1. Time-sensitive chips (evening → "ikväll", weekend → "helgen")
 *  2. Followed-entity chips (venue/artist the user follows)
 *  3. Category chips from stated onboarding preferences
 *  4. Fallback chips if fewer than MIN_CHIPS built
 */
export async function getSuggestedPrompts({
  supabase,
  client_user_id,
  now,
  limit = CHIP_LIMIT,
}: GetSuggestedPromptsOptions): Promise<SuggestedPromptsResult> {
  const t = now ?? stockholmNow();

  let chips = buildTimeChips(t, limit);

  // Load personalization signals in parallel
  const [statedCategories, followedArtists] = await Promise.all([
    loadStatedPreferences(supabase, client_user_id),
    loadFollowedArtists(supabase, client_user_id),
  ]);

  // Enrich with followed entities first (high-intent signals)
  chips = enrichWithFollowed(
    chips,
    followedArtists.artist_slugs ?? [],
    limit
  );

  // Enrich with stated categories
  chips = enrichWithCategories(chips, statedCategories, limit);

  // Fallback if we have fewer than MIN_CHIPS
  const FALLBACK_CHIPS: SuggestedPrompt[] = [
    { id: 'fallback-konserter', prompt_text: 'Konserter i Stockholm?', reason: 'Populärt i Stockholm', category: 'konserter' },
    { id: 'fallback-gratis', prompt_text: 'Gratis events i Stockholm?', reason: 'Prispress', category: undefined },
    { id: 'fallback-helgen', prompt_text: 'Vad händer i helgen?', reason: 'Helgen', category: undefined },
  ];

  if (chips.length < MIN_CHIPS) {
    for (const fb of FALLBACK_CHIPS) {
      if (chips.length >= MIN_CHIPS) break;
      if (!chips.some((c) => c.id === fb.id)) chips.push(fb);
    }
  }

  // If still empty (should not happen), return a safe default
  if (chips.length === 0) {
    chips = [
      { id: 'default-tonight', prompt_text: 'Vad ska jag göra ikväll?', reason: 'Kvällstid', category: undefined },
      { id: 'default-weekend', prompt_text: 'Något i helgen?', reason: 'Helgen', category: undefined },
      { id: 'default-konserter', prompt_text: 'Konserter i Stockholm?', reason: 'Musik', category: 'konserter' },
    ];
  }

  return { prompts: chips.slice(0, limit) };
}
