/**
 * fallbackHierarchy.test.ts — tester för fallback-kedjan (FACT → MINIMAL → NULL).
 *
 * Säkrar att:
 *   - FACT-nivå bygger faktalista från Profile (aldrig meningar)
 *   - MINIMAL-nivå ger titel + venue + datum
 *   - Tom profile → null (inte ens MINIMAL)
 *   - chooseFallback väljer rätt nivå baserat på vad Profile har
 *   - Texten är deterministisk (samma input → samma output)
 */
import { describe, expect, it } from 'vitest';
import {
  buildFactBasedFallback,
  buildMinimalFallback,
  chooseFallback,
} from './fallbackHierarchy';
import type { EventProfile } from './types';
import type { EventUnderstandingInput } from './eventUnderstanding';

const RICH_PROFILE: EventProfile = {
  event_type: 'music',
  performers: ['Hooligan Bobs', 'The Vibes'],
  genres: ['rock', 'punk'],
  content: ['livemusik', 'låtar från debutalbumet'],
  experience_characteristics: ['live', 'högljudd', 'publiken dansar'],
  language: ['sv'],
  setting: 'klubb',
  duration_minutes: 90,
  target_audience: ['vuxna'],
  repertoire: ['Hooligan Anthem', 'Stockholm Nights'],
  ensemble: undefined,
  concept: 'Stockholms punkrock-kvartett',
  audience_participation: ['dans', 'sång'],
  performance_style: 'högenergisk',
  production_characteristics: [],
  provenance: {},
};

const MINIMAL_PROFILE: EventProfile = {
  event_type: 'community',
  performers: [],
  genres: [],
  content: [],
  experience_characteristics: [],
  language: ['sv'],
  provenance: {},
};

const EMPTY_EVENT: EventUnderstandingInput = {
  category_slug: 'community',
  title: '',
};

describe('buildFactBasedFallback', () => {
  it('RICH profile → FACT-lista med typ + performers + genres + duration + setting', () => {
    const event: EventUnderstandingInput = {
      category_slug: 'rock',
      title: 'Hooligan Bobs live',
      venue_name: 'Debaser',
      start_time: '2026-10-15T20:00:00+02:00',
    };
    const r = buildFactBasedFallback(RICH_PROFILE, event);
    expect(r.level).toBe('FACT');
    expect(r.text).toContain('Hooligan Bobs');
    expect(r.text).toContain('rock');
    expect(r.text).toContain('Längd');
    expect(r.text).toContain('klubb');
    expect(r.info_level).toBe('LOW');
  });

  it('utan duration → inget Längd-fält i texten', () => {
    const profile = { ...RICH_PROFILE, duration_minutes: undefined };
    const r = buildFactBasedFallback(profile, {
      category_slug: 'rock',
      title: 'X',
    });
    expect(r.text).not.toContain('Längd');
  });

  it('utan 2 fält → returnerar null (gå vidare till MINIMAL)', () => {
    const profile: EventProfile = {
      event_type: 'community',
      performers: [],
      genres: [],
      content: [],
      experience_characteristics: [],
      language: ['sv'],
      provenance: {},
    };
    const r = buildFactBasedFallback(profile, { category_slug: 'x', title: 'X' });
    expect(r.level).toBeNull();
    expect(r.text).toBe('');
  });

  it('deterministisk — samma input → samma output', () => {
    const event: EventUnderstandingInput = {
      category_slug: 'rock',
      title: 'X',
      venue_name: 'Debaser',
    };
    const r1 = buildFactBasedFallback(RICH_PROFILE, event);
    const r2 = buildFactBasedFallback(RICH_PROFILE, event);
    expect(r1.text).toBe(r2.text);
  });

  it('innehåller ALDRIG meningar från source-text (bara entiteter)', () => {
    const event: EventUnderstandingInput = {
      category_slug: 'rock',
      title: 'Hooligan Bobs live på Debaser',
    };
    const r = buildFactBasedFallback(RICH_PROFILE, event);
    // [FAS 5.2 2026-10-14] Title är första mening (ger unikhet per event).
    // Title är strukturerat fält (från events-tabellen), INTE source-text.
    // Resterande meningar ska börja med känt label-ord.
    const allowedLabels = [
      'Typ', 'Medverkande', 'Genre', 'Längd', 'Lokal', 'Koncept',
      'Repertoar', 'Ensemble', 'För', 'Plats', 'Datum', 'Pris', 'Type',
    ];
    const sentences = r.text.split(/\.\s+/);
    // Första meningen ska vara title
    expect(sentences[0]?.trim()).toBe(event.title);
    // Resterande meningar ska börja med label
    for (let i = 1; i < sentences.length; i++) {
      const trimmed = sentences[i].trim();
      if (trimmed.length === 0) continue;
      const firstWord = trimmed.split(/[\s:]/)[0];
      expect(allowedLabels).toContain(firstWord);
    }
  });

  it('genre-värden separeras med ", " inte meningar', () => {
    const r = buildFactBasedFallback(RICH_PROFILE, {
      category_slug: 'rock',
      title: 'X',
    });
    // Förväntar "rock, punk" — INTE "rock. punk. ..."
    expect(r.text).toMatch(/rock,\s*punk/);
  });

  it('sources innehåller alla använda Profile-fält', () => {
    const r = buildFactBasedFallback(RICH_PROFILE, {
      category_slug: 'rock',
      title: 'X',
    });
    expect(r.sources).toContain('performers');
    expect(r.sources).toContain('genres');
    expect(r.sources).toContain('duration_minutes');
  });
});

describe('buildMinimalFallback', () => {
  it('titel + venue + datum → MINIMAL med alla tre', () => {
    const r = buildMinimalFallback({
      category_slug: 'rock',
      title: 'Hooligan Bobs live',
      venue_name: 'Debaser',
      start_time: '2026-10-15T20:00:00+02:00',
    });
    expect(r.level).toBe('MINIMAL');
    expect(r.text).toContain('Hooligan Bobs live');
    expect(r.text).toContain('Debaser');
    expect(r.text).toContain('15 oktober 2026');
    expect(r.info_level).toBe('VERY_LOW');
  });

  it('utan venue → MINIMAL med bara titel + datum', () => {
    const r = buildMinimalFallback({
      category_slug: 'rock',
      title: 'X',
      start_time: '2026-10-15T20:00:00+02:00',
    });
    expect(r.text).toBe('X, 15 oktober 2026.');
  });

  it('utan datum → MINIMAL med titel + venue', () => {
    const r = buildMinimalFallback({
      category_slug: 'rock',
      title: 'X',
      venue_name: 'Y',
    });
    expect(r.text).toBe('X — Y.');
  });

  it('is_free=true → lägger till "(gratis)"', () => {
    const r = buildMinimalFallback({
      category_slug: 'rock',
      title: 'X',
      venue_name: 'Y',
      is_free: true,
    });
    expect(r.text).toContain('(gratis)');
  });

  it('price_min_sek > 0 → lägger till pris', () => {
    const r = buildMinimalFallback({
      category_slug: 'rock',
      title: 'X',
      venue_name: 'Y',
      price_min_sek: 150,
    });
    expect(r.text).toContain('150 kr');
  });

  it('tom titel → returnerar null', () => {
    const r = buildMinimalFallback(EMPTY_EVENT);
    expect(r.level).toBeNull();
  });

  it('datum formateras på svenska ("8 oktober 2026")', () => {
    const r = buildMinimalFallback({
      category_slug: 'rock',
      title: 'X',
      start_time: '2026-10-08T19:00:00+02:00',
    });
    expect(r.text).toMatch(/8 oktober 2026/);
  });

  it('ogiltigt datum → utelämnas tyst', () => {
    const r = buildMinimalFallback({
      category_slug: 'rock',
      title: 'X',
      start_time: 'inte-ett-datum',
    });
    expect(r.text).toBe('X.');
  });
});

describe('chooseFallback', () => {
  it('RICH profile → väljer FACT', () => {
    const r = chooseFallback(RICH_PROFILE, {
      category_slug: 'rock',
      title: 'X',
      venue_name: 'Debaser',
    });
    expect(r.level).toBe('FACT');
    expect(r.info_level).toBe('LOW');
  });

  it('MINIMAL profile + datum → FACT (Typ + Datum räcker som 2 fält)', () => {
    // [FAS 5.2 2026-10-14] Med title-prefix + datum/venue/price i FACT har vi
    // 3 fält som standard (title + Typ + Datum) — FACT väljs framför MINIMAL.
    const profile: EventProfile = {
      ...MINIMAL_PROFILE,
      event_type: 'community',
    };
    const r = chooseFallback(profile, {
      category_slug: 'community',
      title: 'Ett evenemang',
      venue_name: 'Platsen',
      start_time: '2026-10-15T18:00:00+02:00',
    });
    expect(r.level).toBe('FACT');
  });

  it('helt tom profile + titel → MINIMAL (med bara titel)', () => {
    const r = chooseFallback(MINIMAL_PROFILE, {
      category_slug: 'community',
      title: 'Någonting',
    });
    expect(r.level).toBe('MINIMAL');
    expect(r.text).toContain('Någonting');
  });

  it('helt tom (ingen titel) → null', () => {
    const r = chooseFallback(MINIMAL_PROFILE, EMPTY_EVENT);
    expect(r.level).toBeNull();
    expect(r.text).toBe('');
  });

  it('trappstegsordning: FACT > MINIMAL > null', () => {
    // Profile med bara typ+en sak → FACT har inte 2 fält → MINIMAL
    const profile: EventProfile = {
      ...MINIMAL_PROFILE,
      event_type: 'music',
    };
    const r = chooseFallback(profile, {
      category_slug: 'music',
      title: 'X',
      venue_name: 'Y',
    });
    // FACT ger "Typ: music." + 1 fält (venue) = 2 fält, så FACT ska väljas
    // Hmm, MINIMAL_PROFILE har inga andra fält, så bara typ → 1 fält
    // → FACT returnerar null (kräver 2) → MINIMAL
    expect(r.level).toBe('MINIMAL');
  });
});

describe('fallback determinism & säkerhet', () => {
  it('FACT-text innehåller inga HTML/markdown', () => {
    const r = buildFactBasedFallback(RICH_PROFILE, {
      category_slug: 'rock',
      title: 'X',
    });
    expect(r.text).not.toMatch(/<[^>]+>/);
    expect(r.text).not.toMatch(/\[.*\]\(.*\)/);
  });

  it('FACT-text är max 500 tecken (rimlig för fallback)', () => {
    const r = buildFactBasedFallback(RICH_PROFILE, {
      category_slug: 'rock',
      title: 'X',
    });
    expect(r.text.length).toBeLessThan(500);
  });

  it('MINIMAL-text är max 200 tecken', () => {
    const r = buildMinimalFallback({
      category_slug: 'rock',
      title: 'X',
      venue_name: 'Y',
      start_time: '2026-10-15T20:00:00+02:00',
    });
    expect(r.text.length).toBeLessThan(200);
  });
});
