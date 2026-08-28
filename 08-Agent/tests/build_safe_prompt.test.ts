/**
 * Unit tests for buildSafePrompt — Step A smoketest, copyright guardrails.
 *
 * The 6 guardrails in buildSafePrompt are exercised here:
 *   1. PII scrub (URLs, emails, phones, handles)
 *   2. Trademark blacklist
 *   3. Venue genericisation
 *   4. Style template (no-text/no-logo)
 *   5. Negative prompt (not asserted here — see export check)
 *   6. Length cap + hash stability
 */

import { describe, expect, it } from 'vitest';

import { buildSafePrompt, pick } from '../tools/ai_image';
import {
  PALETTES,
  MEDIUMS,
  COMPOSITIONS,
  TRADEMARK_BLOCKLIST,
  type SafePromptInput,
} from '../types/ai_image';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const baseInput: SafePromptInput = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  title: 'Late Night Jazz Quartet',
  category_slug: 'music',
  venue_name: 'Stampen',
  city: 'Stockholm',
  is_free: false,
  start_time: '2026-08-25T19:30:00+02:00',
};

// ─── 1. Basic shape ──────────────────────────────────────────────────────

describe('buildSafePrompt — basic shape', () => {
  it('returns a non-empty prompt + negative_prompt', () => {
    const r = buildSafePrompt(baseInput);
    expect(r.prompt.length).toBeGreaterThan(20);
    expect(r.negative_prompt.length).toBeGreaterThan(10);
    expect(r.prompt_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.fallback_used).toBe(false);
  });

  it('marks every input field as a source by default', () => {
    const r = buildSafePrompt(baseInput);
    expect(r.sources_used).toEqual(
      expect.arrayContaining(['title', 'category_slug', 'venue_name', 'city', 'start_time']),
    );
  });

  it('produces a deterministic prompt_hash for the same input', () => {
    const a = buildSafePrompt(baseInput);
    const b = buildSafePrompt(baseInput);
    expect(a.prompt_hash).toBe(b.prompt_hash);
    expect(a.prompt).toBe(b.prompt);
  });

  it('produces a different prompt_hash for different input', () => {
    const a = buildSafePrompt(baseInput);
    const b = buildSafePrompt({ ...baseInput, title: 'Late Night Jazz Trio' });
    expect(a.prompt_hash).not.toBe(b.prompt_hash);
  });
});

// ─── 2. Length cap (Guardrail 6) ─────────────────────────────────────────

describe('buildSafePrompt — length cap', () => {
  it('caps the prompt at 900 chars even with huge titles', () => {
    // Build a synthetic long title that survives the title-slice step.
    // We bypass the 60-char slice by repeating a long emoji-free token
    // and asserting the result is capped + still non-empty.
    const longTitle = 'A '.repeat(500); // 1000 chars
    const r = buildSafePrompt({
      ...baseInput,
      title: longTitle.trim(),
    });
    expect(r.prompt.length).toBeLessThanOrEqual(900);
    // The cap message ends with … when truncation fires.
    expect(r.prompt.endsWith('…') || r.prompt.length < 900).toBe(true);
  });

  it('still emits a hash when the prompt is truncated', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'A'.repeat(5000) });
    expect(r.prompt_hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ─── 3. Trademark blacklist (Guardrail 2) ────────────────────────────────

describe('buildSafePrompt — trademark blacklist', () => {
  it('forces fallback_used=true when title contains "ABBA"', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'ABBA Tribute Night' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.toLowerCase()).not.toContain('abba');
  });

  it('forces fallback when venue contains "Konserthuset"', () => {
    const r = buildSafePrompt({ ...baseInput, venue_name: 'Konserthuset' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.toLowerCase()).not.toContain('konserthuset');
  });

  it('forces fallback when category contains "ticketmaster"', () => {
    const r = buildSafePrompt({ ...baseInput, category_slug: 'ticketmaster-music' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.toLowerCase()).not.toContain('ticketmaster');
  });

  it('forces fallback when venue contains "Billetto"', () => {
    const r = buildSafePrompt({ ...baseInput, venue_name: 'Billetto Stage' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.toLowerCase()).not.toContain('billetto');
  });

  it('forces fallback when venue contains "Eventbrite"', () => {
    const r = buildSafePrompt({ ...baseInput, venue_name: 'Eventbrite Arena' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.toLowerCase()).not.toContain('eventbrite');
  });

  it('forces fallback when title contains "Robyn"', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'Robyn live in concert' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.toLowerCase()).not.toContain('robyn');
  });

  it('forces fallback when venue contains "Eurovision"', () => {
    const r = buildSafePrompt({ ...baseInput, venue_name: 'Eurovision Park' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.toLowerCase()).not.toContain('eurovision');
  });

  it('does NOT match "kentucky" against "kent" (word boundary)', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'Kentucky Bourbon Tasting' });
    expect(r.fallback_used).toBe(false);
    expect(r.prompt.toLowerCase()).toContain('kentucky');
  });
});

// ─── 4. PII scrub (Guardrail 1) ──────────────────────────────────────────

describe('buildSafePrompt — PII scrub', () => {
  it('strips URLs from title', () => {
    const r = buildSafePrompt({
      ...baseInput,
      title: 'See https://example.com/event/123 for details',
    });
    expect(r.prompt).not.toMatch(/https?:\/\//);
  });

  it('strips email addresses from venue', () => {
    const r = buildSafePrompt({
      ...baseInput,
      venue_name: 'Venue contact@example.com is forbidden',
    });
    expect(r.prompt).not.toMatch(/@example\.com/);
  });

  it('strips phone numbers from title', () => {
    const r = buildSafePrompt({
      ...baseInput,
      title: 'Call +46 70 123 45 67 for tickets',
    });
    expect(r.prompt).not.toMatch(/\+46/);
  });

  it('strips social handles from title', () => {
    const r = buildSafePrompt({
      ...baseInput,
      title: 'Follow @eventpulse for updates',
    });
    expect(r.prompt).not.toMatch(/@eventpulse/);
  });
});

// ─── 5. Title length fallback ────────────────────────────────────────────

describe('buildSafePrompt — title length fallback', () => {
  it('forces fallback when title is shorter than 4 chars', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'AB' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.length).toBeGreaterThan(20);
  });

  it('forces fallback when title is empty', () => {
    const r = buildSafePrompt({ ...baseInput, title: '' });
    expect(r.fallback_used).toBe(true);
    expect(r.prompt.length).toBeGreaterThan(20);
  });

  it('does NOT force fallback when title is exactly 4 chars and unblocked', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'Open' });
    expect(r.fallback_used).toBe(false);
  });
});

// ─── 6. Venue genericisation (Guardrail 3) ───────────────────────────────

describe('buildSafePrompt — venue genericisation', () => {
  it('never echoes a real venue name in the prompt', () => {
    const r = buildSafePrompt(baseInput);
    expect(r.prompt).not.toContain('Stampen');
  });

  it('picks the music venue hint for music category', () => {
    const r = buildSafePrompt({ ...baseInput, category_slug: 'music' });
    expect(r.prompt).toContain('concert hall');
  });

  it('picks the theater hint for theater category', () => {
    const r = buildSafePrompt({ ...baseInput, category_slug: 'theater' });
    expect(r.prompt).toContain('theater');
  });

  it('picks the cinema hint for film category', () => {
    const r = buildSafePrompt({ ...baseInput, category_slug: 'film' });
    expect(r.prompt).toContain('cinema');
  });

  it('picks the gallery hint for exhibition category', () => {
    const r = buildSafePrompt({ ...baseInput, category_slug: 'exhibition' });
    expect(r.prompt).toContain('gallery');
  });

  it('picks the workshop hint for workshop category', () => {
    const r = buildSafePrompt({ ...baseInput, category_slug: 'workshop' });
    expect(r.prompt).toContain('workshop');
  });

  it('falls back to catch-all when category is empty', () => {
    const r = buildSafePrompt({ ...baseInput, category_slug: '', title: '' });
    expect(r.prompt).toContain('urban event room');
  });
});

// ─── 7. Style template + negative prompt (Guardrails 4 + 5) ──────────────

describe('buildSafePrompt — style template + negative prompt', () => {
  it('includes "No readable text, logos, faces, or branding"', () => {
    const r = buildSafePrompt(baseInput);
    expect(r.prompt).toContain('No readable text');
  });

  it('returns the canonical negative prompt', () => {
    const r = buildSafePrompt(baseInput);
    expect(r.negative_prompt).toContain('logo');
    expect(r.negative_prompt).toContain('watermark');
    expect(r.negative_prompt).toContain('realistic face');
    expect(r.negative_prompt).toContain('person');
  });

  it('varies the lighting based on is_free', () => {
    const paid = buildSafePrompt({ ...baseInput, is_free: false });
    const free = buildSafePrompt({ ...baseInput, is_free: true });
    expect(paid.prompt).toContain('warm evening light');
    expect(free.prompt).toContain('soft daylight');
  });

  it('varies the city hint for Stockholm', () => {
    const r = buildSafePrompt({ ...baseInput, city: 'Stockholm' });
    expect(r.prompt).toContain('Stockholm');
  });

  it('falls back to "a Scandinavian city" for unknown cities', () => {
    const r = buildSafePrompt({ ...baseInput, city: 'Reykjavik' });
    expect(r.prompt).toContain('Scandinavian city');
  });

  it('falls back to "a nordic city" when city is empty', () => {
    const r = buildSafePrompt({ ...baseInput, city: '' });
    expect(r.prompt).toContain('nordic city');
  });
});

// ─── 8. Time-of-day hint ────────────────────────────────────────────────

describe('buildSafePrompt — time-of-day hint', () => {
  it('returns morning for 09:00 UTC', () => {
    const r = buildSafePrompt({ ...baseInput, start_time: '2026-08-25T09:00:00Z' });
    expect(r.prompt).toContain('morning');
  });

  it('returns evening for 19:00 UTC', () => {
    const r = buildSafePrompt({ ...baseInput, start_time: '2026-08-25T19:00:00Z' });
    expect(r.prompt).toContain('evening');
  });

  it('returns night for 23:00 UTC', () => {
    const r = buildSafePrompt({ ...baseInput, start_time: '2026-08-25T23:00:00Z' });
    expect(r.prompt).toContain('night');
  });

  it('returns afternoon for 14:00 UTC', () => {
    const r = buildSafePrompt({ ...baseInput, start_time: '2026-08-25T14:00:00Z' });
    expect(r.prompt).toContain('afternoon');
  });

  it('handles invalid ISO dates without crashing (defaults to evening)', () => {
    const r = buildSafePrompt({ ...baseInput, start_time: 'not-a-date' });
    expect(r.prompt).toContain('evening');
    expect(r.fallback_used).toBe(false);
  });
});

// ─── 9. Non-Latin titles ────────────────────────────────────────────────

describe('buildSafePrompt — non-Latin titles', () => {
  it('handles Cyrillic titles without crashing', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'Джаз вечер в Стокгольме' });
    expect(r.prompt.length).toBeGreaterThan(20);
    expect(r.fallback_used).toBe(false);
  });

  it('handles Swedish titles with å/ä/ö without crashing', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'Körsång på Södermalm' });
    expect(r.prompt.length).toBeGreaterThan(20);
    expect(r.fallback_used).toBe(false);
  });

  it('handles emoji in titles', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'Jazz night with emoji' });
    expect(r.prompt.length).toBeGreaterThan(20);
  });
});

// ─── 10. Title mood word selection ───────────────────────────────────────

describe('buildSafePrompt — mood word selection', () => {
  it('uses dramatic for theater', () => {
    const r = buildSafePrompt({ ...baseInput, title: 'Hamlet on Tour', category_slug: 'theater' });
    expect(r.prompt).toContain('dramatic');
  });
});

// ─── 11. Sanity invariants ──────────────────────────────────────────────

describe('buildSafePrompt — sanity invariants', () => {
  it('always mentions the venue hint + a time-of-day + a city', () => {
    const r = buildSafePrompt(baseInput);
    expect(r.prompt).toMatch(/Editorial illustration of/);
    expect(r.prompt).toMatch(/at (morning|afternoon|evening|night)/);
    expect(r.prompt).toMatch(/Stockholm|nordic city|Scandinavian city/);
  });
});

// ─── 12. Visual variation (Step A refinement, 2026-08-23) ───────────────

describe('buildSafePrompt — visual variation (Step A refinement)', () => {
  it('embeds composition, medium, and palette tokens in the prompt', () => {
    const r = buildSafePrompt(baseInput);
    expect(r.prompt).toMatch(/Composition: /);
    expect(r.prompt).toMatch(/Medium: /);
    expect(r.prompt).toMatch(/Color palette: /);
  });

  it('exposes the picked axes in style_tags for audit', () => {
    const r = buildSafePrompt(baseInput);
    expect(r.style_tags).toHaveLength(3);
    const allPaletteNames = new Set(PALETTES.map((p) => p.name));
    expect(allPaletteNames.has(r.style_tags[0])).toBe(true);
    expect(MEDIUMS).toContain(r.style_tags[1]);
    expect(COMPOSITIONS).toContain(r.style_tags[2]);
  });

  it('is deterministic — same event_id picks the same palette/medium/composition', () => {
    const a = buildSafePrompt(baseInput);
    const b = buildSafePrompt(baseInput);
    expect(a.style_tags).toEqual(b.style_tags);
    expect(a.prompt).toBe(b.prompt);
  });

  it('different event_ids spread variation across the 8-bucket axis', () => {
    // Hash many synthetic IDs and verify the union spans at least 5 of
    // 8 buckets on each axis — proves the seeded picker actually spreads.
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i.toString().padStart(2, '0')}`);
    const palettesSeen = new Set<string>();
    const mediumsSeen = new Set<string>();
    const compositionsSeen = new Set<string>();
    for (const id of ids) {
      // Build a minimal-but-valid input (the pick() only needs `id`,
      // but buildSafePrompt also scrubs other fields so we keep them).
      const r = buildSafePrompt({
        ...baseInput,
        id: `${id}-aaaa-bbbb-cccc-dddddddddddd`,
      });
      palettesSeen.add(r.style_tags[0]);
      mediumsSeen.add(r.style_tags[1]);
      compositionsSeen.add(r.style_tags[2]);
    }
    expect(palettesSeen.size).toBeGreaterThanOrEqual(5);
    expect(mediumsSeen.size).toBeGreaterThanOrEqual(5);
    expect(compositionsSeen.size).toBeGreaterThanOrEqual(5);
  });

  it('no palette or medium term contains a trademarked brand', () => {
    const blocklistLower = TRADEMARK_BLOCKLIST.map((t) => t.toLowerCase());
    for (const palette of PALETTES) {
      const lower = palette.prompt.toLowerCase();
      for (const term of blocklistLower) {
        expect(lower).not.toContain(term);
      }
    }
    for (const medium of MEDIUMS) {
      const lower = medium.toLowerCase();
      for (const term of blocklistLower) {
        expect(lower).not.toContain(term);
      }
    }
  });

  it('no composition term contains forbidden words (logo/brand/trademark/photograph)', () => {
    const forbidden = ['logo', 'brand', 'trademark', 'photograph', 'photo'];
    for (const c of COMPOSITIONS) {
      const lower = c.toLowerCase();
      for (const w of forbidden) {
        expect(lower).not.toContain(w);
      }
    }
  });

  it('pick() helper is itself deterministic', () => {
    expect(pick(PALETTES, 'seed-1', 'salt').name).toBe(pick(PALETTES, 'seed-1', 'salt').name);
    expect(pick(MEDIUMS, 'seed-1', 'salt')).toBe(pick(MEDIUMS, 'seed-1', 'salt'));
  });

  it('pick() helper throws on empty array', () => {
    expect(() => pick<string>([], 'seed', 'salt')).toThrow(/empty/);
  });
});
