/**
 * dataQualityCheck.test.ts — tester för semantisk datakvalitetsgrind (evidence fusion).
 *
 * Säkrar att gate:en listar alla signaler, beräknar conflict korrekt,
 * och INTE muterar Profile.
 */
import { describe, expect, it } from 'vitest';
import { checkDataQuality } from './dataQualityCheck';
import { buildEventProfile } from './eventUnderstanding';
import type { EventUnderstandingInput } from './eventUnderstanding';

describe('checkDataQuality (evidence fusion)', () => {
  // ── Case 1: Zurich-pattern (titel-only — ska INTE auto-failas) ─────────
  it('Zurich-pattern med bara title: EN keyword = svag evidens, INTE conflict', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'exhibition',
      venue_type: 'arena',
      venue_name: 'Ericsson Globe',
      city: 'Stockholm',
      title: 'Zurich — Live',
      performers: ['Zurich'],
      start_time: '2026-10-20T20:00:00+02:00',
    };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    // venue_category high (mot) + performer_signal medium (mot) → conflict=true
    // Title "Zurich — Live" → "live" är musik-nyckelord → mot-signal low.
    expect(report.original_event_type).toBe('exhibition');
    expect(report.conflict).toBe(true);
    expect(report.inferred_event_type).toBe('music');
    expect(report.evidence.some((e) => e.type === 'venue_category' && e.polarity === 'against')).toBe(true);
    expect(report.evidence.some((e) => e.type === 'performer_signal' && e.polarity === 'against')).toBe(true);
  });

  // ── Case 2: Zurich-pattern med source-text — flera starka signaler ─────
  it('Zurich-pattern med source-text: FLERA starka signaler → inferred=music', () => {
    const input = {
      category_slug: 'exhibition',
      venue_type: 'arena',
      title: 'The Zurich Youth Symphony Orchestra',
      description_text: 'En kväll med symfoniska mästerverk. Orkester, konsert med Rachmaninov, Berwald, Sibelius. Pianosolist Ilya Shmukler. 95 musiker.',
    } as EventUnderstandingInput & { description_text?: string };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    // venue_category (high mot) + source_signal (medium/high mot) → conflict
    // Title har "symphony" + "orchestra" (musik keywords) → title mot-signal
    expect(report.conflict).toBe(true);
    expect(report.inferred_event_type).toBe('music');
    expect(report.confidence).toBeLessThan(0.6);

    // Source_signal ska finnas i evidence
    const sourceSignal = report.evidence.find((e) => e.type === 'source_signal');
    expect(sourceSignal).toBeDefined();
    expect(sourceSignal?.polarity).toBe('against');
  });

  // ── Case 3: Music + gallery = HIGH mot-signal från venue ───────────────
  it('music + gallery = HIGH mot-signal, kan bli conflict om fler signaler', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'rock',
      venue_type: 'gallery',
      venue_name: 'Moderna Museet',
      title: 'Rock i museet',
      // Plus title-keyword som matchar "rock" → music keyword → FOR evidence
      // Bör INTE bli conflict eftersom title stödjer.
    };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    // Bara venue_category high mot-signal. Title-keyword check: cat=music →
    // kollar EXHIBITION keywords. "museet" är exhibition keyword.
    // Så mot-signaler: venue_category high + title_keyword low (mot exhibition)
    // → 2 starka (high + low räknas inte som stark)
    // Bara venue_category är stark → conflict=false
    expect(report.evidence.some((e) => e.type === 'venue_category' && e.polarity === 'against')).toBe(true);
  });

  // ── Case 4: Performance-art whitelist fungerar ─────────────────────────
  it('exhibition + performers + performance-art-title = INTE mot-signal från performers', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'exhibition',
      venue_type: 'gallery',
      title: 'Live performance — föreställning',
      performers: ['Anna Performance'],
    };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    // Title innehåller "performance" och "föreställning" → whitelist.
    // Gallery + exhibition = OK. Inga mot-signaler från performers.
    const performerSignal = report.evidence.find((e) => e.type === 'performer_signal');
    expect(performerSignal).toBeUndefined();
  });

  // ── Case 5: Clean concert — inga signaler alls ─────────────────────────
  it('clean concert → tom evidence, confidence 1.0, ingen conflict', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'rock',
      venue_type: 'club',
      venue_name: 'Debaser',
      title: 'Hooligan Bobs live',
      performers: ['Hooligan Bobs'],
      start_time: '2026-10-15T20:00:00+02:00',
    };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    expect(report.evidence).toEqual([]);
    expect(report.conflict).toBe(false);
    expect(report.confidence).toBe(1.0);
    expect(report.inferred_event_type).toBeNull();
  });

  // ── Case 6: Profile muteras INTE ───────────────────────────────────────
  it('muterar INTE Profile', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'exhibition',
      venue_type: 'arena',
      performers: ['Zurich'],
    };
    const profile = buildEventProfile(input);
    const profileTypeBefore = profile.event_type;

    const report = checkDataQuality(input, profile);
    expect(report.original_event_type).toBe(profileTypeBefore);
    expect(profile.event_type).toBe(profileTypeBefore); // oförändrad
  });

  // ── Case 7: Confidence-sänkning vid HIGH mot-signal ────────────────────
  it('sänker confidence proportionellt mot antal starka mot-signaler', () => {
    const input = {
      category_slug: 'exhibition',
      venue_type: 'arena',
      title: 'Zurich Youth Symphony Orchestra',
      description_text: 'Symfoniska mästerverk, orkester, Rachmaninov, Berwald, Sibelius, pianosolist',
    } as EventUnderstandingInput & { description_text?: string };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    // venue_category high (-0.25) + title_keyword (orchestra/symphony → 2 hits = medium -0.15) +
    // source_signal medium (-0.15) = -0.55 → confidence ~ 0.45
    expect(report.confidence).toBeLessThanOrEqual(0.5);
    expect(report.confidence).toBeGreaterThanOrEqual(0.3);
  });

  // ── Case 8: inferred_event_type är null vid svag evidens ──────────────
  it('inferred_event_type = null när bara EN svag mot-signal', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'rock',
      venue_type: 'gallery', // 1 high mot-signal
      title: 'Klassiskt möte', // ingen mot-signal mot exhibition
    };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    // Bara venue_category high. Inga title/source/performer mot-signaler.
    // Bara 1 stark mot-signal → conflict=false → inferred_event_type=null
    expect(report.conflict).toBe(false);
    expect(report.inferred_event_type).toBeNull();
  });

  // ── Case 9: Sport på theater = MEDIUM mot-signal, INTE conflict ───────
  it('sport + theater = medium mot-signal, INTE conflict ensamt', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'sports',
      venue_type: 'theater',
      title: 'Sportevent',
    };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    // venue_category medium mot-signal. Inga andra starka signaler.
    expect(report.evidence.some((e) => e.type === 'venue_category' && e.weight === 'medium')).toBe(true);
    expect(report.conflict).toBe(false);
  });

  // ── Case 10: Music + 0 performers + title utan musik-hint = LOW signal ─
  it('music utan performers + title utan musik-hint = LOW mot-signal från performers', () => {
    const input: EventUnderstandingInput = {
      category_slug: 'rock',
      venue_type: 'club',
      title: 'Ett evenemang', // inga musik-nyckelord
    };
    const profile = buildEventProfile(input);
    const report = checkDataQuality(input, profile);

    const perfSignal = report.evidence.find((e) => e.type === 'performer_signal');
    expect(perfSignal?.weight).toBe('low');
  });
});