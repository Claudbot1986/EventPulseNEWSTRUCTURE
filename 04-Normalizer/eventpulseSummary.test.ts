/**
 * Tests for eventpulseSummary — T0201 (2026-10-05).
 *
 * User contract (sections 3, 5, 6, 11, 12 of the request):
 *   A. Marketing text in source → facts extracted, summary based on facts,
 *      original NOT published automatically.
 *   B. "Dörrar 18:30" in source → doors_time = 18:30 and used in summary.
 *   C. No age limit in source → do NOT invent one.
 *   F. Multiple sources with complementary facts → summary uses verified facts.
 *   G. Two sources contradict → deterministic source/confidence policy wins,
 *      AI does NOT pick.
 *
 * Run: npx vitest run 04-Normalizer/eventpulseSummary.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  buildEventpulseFacts,
  buildEventpulseSummary,
  extractDoorsTime,
  extractAgeLimit,
  extractSupportAct,
  categoryToEventType,
  formatSwedishDate,
  chooseFact,
  SOURCE_PRIORITY,
  __test__,
} from './eventpulseSummary';

const { extractDate, extractTime } = __test__;

// ─── extractDoorsTime (test B) ────────────────────────────────────────────────

describe('extractDoorsTime (B)', () => {
  it('extracts Swedish "Dörrar 18:30"', () => {
    expect(extractDoorsTime('Välkommen! Dörrar 18:30, konsert 19:30.')).toBe('18:30');
  });

  it('extracts "Dörrarna öppnar 19.30" with period', () => {
    expect(extractDoorsTime('Dörrarna öppnar 19.30. Bar öppen hela kvällen.')).toBe('19:30');
  });

  it('extracts English "Doors 18:30"', () => {
    expect(extractDoorsTime('Doors 18:30, show starts 20:00.')).toBe('18:30');
  });

  it('extracts "Doors open 19:00"', () => {
    expect(extractDoorsTime('Doors open 19:00 — come early!')).toBe('19:00');
  });

  it('extracts "Insläpp 17:30"', () => {
    expect(extractDoorsTime('Insläpp 17:30. Föreställare 18:00.')).toBe('17:30');
  });

  it('pads single-digit hours to HH:MM', () => {
    expect(extractDoorsTime('Dörrar 9:00')).toBe('09:00');
  });

  it('returns null when no doors-time pattern found', () => {
    expect(extractDoorsTime('Konsert med artist X. Vi ses där!')).toBe(null);
  });

  it('returns null for invalid times (25:99)', () => {
    expect(extractDoorsTime('Dörrar 25:99')).toBe(null);
  });

  it('returns null for null/undefined', () => {
    expect(extractDoorsTime(null)).toBe(null);
    expect(extractDoorsTime(undefined)).toBe(null);
  });
});

// ─── extractAgeLimit (test C — must NOT invent) ─────────────────────────────

describe('extractAgeLimit (C — never invent)', () => {
  it('extracts Swedish "18 år"', () => {
    expect(extractAgeLimit('Åldersgräns 18 år.')).toBe('18');
  });

  it('extracts "21+"', () => {
    expect(extractAgeLimit('Endast 21+')).toBe('21');
  });

  it('extracts English "age limit 18"', () => {
    expect(extractAgeLimit('Age limit: 18 years')).toBe('18');
  });

  it('extracts "från 18 år"', () => {
    expect(extractAgeLimit('Från 18 år. Välkommen!')).toBe('18');
  });

  it('returns "all ages" for "fri ålder"', () => {
    expect(extractAgeLimit('Fri ålder — alla är välkomna!')).toBe('all ages');
  });

  it('returns null when no age limit mentioned (CRITICAL: never invent)', () => {
    expect(extractAgeLimit('Konsert med artist X på Avicii Arena.')).toBe(null);
    expect(extractAgeLimit('Välkommen till en magisk kväll med musik!')).toBe(null);
    expect(extractAgeLimit(null)).toBe(null);
    expect(extractAgeLimit(undefined)).toBe(null);
  });
});

// ─── extractSupportAct ──────────────────────────────────────────────────────

describe('extractSupportAct', () => {
  it('extracts "Support: Y"', () => {
    expect(extractSupportAct('Konsert med X. Support: Y Band.')).toBe('Y Band');
  });

  it('extracts "förband: Z"', () => {
    expect(extractSupportAct('Med X som förband: Z Singel.')).toBe('Z Singel');
  });

  it('returns null when no support mentioned', () => {
    expect(extractSupportAct('Konsert med X.')).toBe(null);
  });
});

// ─── categoryToEventType ────────────────────────────────────────────────────

describe('categoryToEventType', () => {
  it('maps known slugs', () => {
    expect(categoryToEventType('music')).toBe('concert');
    expect(categoryToEventType('concert')).toBe('concert');
    expect(categoryToEventType('theater')).toBe('theater');
    expect(categoryToEventType('teater')).toBe('theater');
    expect(categoryToEventType('standup')).toBe('standup');
    expect(categoryToEventType('comedy')).toBe('standup');
    expect(categoryToEventType('art-exhibitions')).toBe('exhibition');
    expect(categoryToEventType('festival')).toBe('festival');
    expect(categoryToEventType('workshop')).toBe('workshop');
    expect(categoryToEventType('film')).toBe('screening');
    expect(categoryToEventType('community')).toBe('community');
  });

  it('returns "other" for unknown slug', () => {
    expect(categoryToEventType('unicorn-races')).toBe('other');
  });

  it('returns null for null/undefined', () => {
    expect(categoryToEventType(null)).toBe(null);
    expect(categoryToEventType(undefined)).toBe(null);
  });
});

// ─── extractDate / extractTime ──────────────────────────────────────────────

describe('extractDate / extractTime (helpers)', () => {
  it('extracts date from ISO with Z', () => {
    expect(extractDate('2026-11-14T19:30:00Z')).toBe('2026-11-14');
  });
  it('extracts date from ISO with timezone offset', () => {
    expect(extractDate('2026-11-14T19:30:00+02:00')).toBe('2026-11-14');
  });
  it('extracts time HH:MM from ISO (Stockholm local time, NOT UTC)', () => {
    // 2026-11-14 är vinter-stockholm (CET = UTC+1).
    // 19:30 UTC → 20:30 CET (inte 19:30 — detta var den gamla UTC-buggen).
    expect(extractTime('2026-11-14T19:30:00Z')).toBe('20:30');
    expect(extractTime('2026-11-14T09:05:00Z')).toBe('10:05');
    // Sommar-stockholm (CEST = UTC+2).
    expect(extractTime('2026-07-14T19:30:00Z')).toBe('21:30');
    // ISO med explicit offset respekteras korrekt.
    expect(extractTime('2026-11-14T19:30:00+02:00')).toBe('18:30');
  });
  it('returns null for malformed strings', () => {
    expect(extractDate('not-an-iso')).toBe(null);
    expect(extractTime('not-an-iso')).toBe(null);
  });
});

// ─── formatSwedishDate ──────────────────────────────────────────────────────

describe('formatSwedishDate', () => {
  it('formats valid dates', () => {
    expect(formatSwedishDate('2026-11-14')).toBe('14 november');
    expect(formatSwedishDate('2026-01-01')).toBe('1 januari');
    expect(formatSwedishDate('2026-12-25')).toBe('25 december');
  });
  it('returns null for malformed input', () => {
    expect(formatSwedishDate('2026/11/14')).toBe(null);
    expect(formatSwedishDate(null)).toBe(null);
  });
});

// ─── buildEventpulseFacts ───────────────────────────────────────────────────

describe('buildEventpulseFacts', () => {
  it('extracts structured fields from event row', () => {
    const { facts, provenance } = buildEventpulseFacts({
      category_slug: 'music',
      venue_name: 'Avicii Arena',
      city: 'Stockholm',
      // 2026-10-07 — TZ-aware: 19:30 UTC → 20:30 CET (Stockholm local).
      // Använd +02:00-offset explicit för att undvika mock-data beroende
      // av TZ-beteende i Date-konstruktorn.
      start_time: '2026-11-14T19:30:00+01:00',
      end_time: '2026-11-14T22:00:00+01:00',
      is_free: false,
      price_min_sek: 450,
      price_max_sek: 650,
      title: 'Artist X - Stockholm',
      raw_description: 'Dörrar 18:30. Föreställare Artist Y som support.',
      source: 'sthlmlist',
    });

    expect(facts.event_type).toBe('concert');
    expect(facts.artist).toBe('Artist X');
    expect(facts.venue).toBe('Avicii Arena');
    expect(facts.city).toBe('Stockholm');
    expect(facts.date).toBe('2026-11-14');
    expect(facts.start_time).toBe('19:30');
    expect(facts.end_time).toBe('22:00');
    expect(facts.is_free).toBe(false);
    expect(facts.price_min_sek).toBe(450);
    expect(facts.price_max_sek).toBe(650);
    expect(facts.doors_time).toBe('18:30');
    expect(facts.support_act).toBe('Artist Y');
    expect(facts.language).toBe('sv');
    expect(provenance.doors_time).toBe('raw_description');
  });

  it('leaves fields null when no supporting data (C — never invent)', () => {
    const { facts } = buildEventpulseFacts({
      category_slug: 'music',
      venue_name: 'Debaser',
      start_time: '2026-10-18T20:00:00Z',
      title: 'Standup med X',
      raw_description: null,  // Ingen description
    });

    expect(facts.age_limit).toBe(null);  // ← INTE påhittat
    expect(facts.doors_time).toBe(null);
    expect(facts.support_act).toBe(null);
    expect(facts.is_free).toBe(null);  // ← INTE false på hårt
    expect(facts.language).toBe(null);  // ← INTE 'en' bara för att default
  });

  it('detects Swedish from rendered language', () => {
    const { facts: f1 } = buildEventpulseFacts({ raw_description: 'Välkommen till en kväll med musik.' });
    expect(f1.language).toBe('sv');

    const { facts: f2 } = buildEventpulseFacts({ raw_description: 'Welcome to an evening with music.' });
    expect(f2.language).toBe('en');
  });
});

// ─── buildEventpulseSummary — the GOOD/BAD examples from user §11 ───────────

describe('buildEventpulseSummary', () => {
  it('GOOD example: "Standup med X på Norra Brunn..."', () => {
    const summary = buildEventpulseSummary({
      event_type: 'standup',
      artist: 'X',
      support_act: null,
      venue: 'Norra Brunn',
      city: 'Stockholm',
      date: '2026-11-12',
      start_time: '20:00',
      end_time: null,
      doors_time: null,
      age_limit: '18',
      language: 'sv',
      is_free: null,
      price_min_sek: null,
      price_max_sek: null,
      accessibility: null,
      organizer: null,
    });
    expect(summary).toContain('Standup med X');
    expect(summary).toContain('Norra Brunn');
    expect(summary).toContain('Stockholm');
    expect(summary).toContain('12 november');
    expect(summary).toContain('20:00');
    expect(summary).toContain('18-årsgräns');
    // Inga marknadsföringsord
    expect(summary).not.toMatch(/fantastisk|otrolig|oförglömlig|makalös|anrika/i);
  });

  it('GOOD example: "Konsert med Artist X på Avicii Arena..."', () => {
    const summary = buildEventpulseSummary({
      event_type: 'concert',
      artist: 'Artist X',
      support_act: 'Artist Y',
      venue: 'Avicii Arena',
      city: 'Stockholm',
      date: '2026-11-14',
      start_time: '19:30',
      end_time: null,
      doors_time: '18:30',
      age_limit: null,
      language: 'sv',
      is_free: false,
      price_min_sek: 450,
      price_max_sek: 650,
      accessibility: null,
      organizer: null,
    });
    expect(summary).toContain('Konsert med Artist X');
    expect(summary).toContain('Avicii Arena');
    expect(summary).toContain('14 november');
    expect(summary).toContain('Dörrarna öppnar 18:30');
    expect(summary).toContain('Artist Y medverkar som support');
  });

  it('returns null when too few facts (no event_type or no date)', () => {
    const noType = buildEventpulseSummary({
      event_type: null,
      artist: 'X',
      venue: 'Y',
      city: 'Z',
      date: '2026-11-14',
      start_time: null, end_time: null, doors_time: null, age_limit: null,
      language: null, is_free: null, price_min_sek: null, price_max_sek: null,
      support_act: null, accessibility: null, organizer: null,
    });
    expect(noType).toBe(null);

    const noDate = buildEventpulseSummary({
      event_type: 'concert',
      artist: 'X',
      venue: 'Y',
      city: 'Z',
      date: null,
      start_time: null, end_time: null, doors_time: null, age_limit: null,
      language: null, is_free: null, price_min_sek: null, price_max_sek: null,
      support_act: null, accessibility: null, organizer: null,
    });
    expect(noDate).toBe(null);
  });

  it('omits marketing language (BAD example from user §11)', () => {
    const summary = buildEventpulseSummary({
      event_type: 'concert',
      artist: 'X',
      support_act: null,
      venue: 'Norra Brunn',
      city: 'Stockholm',
      date: '2026-11-12',
      start_time: '20:00',
      end_time: null, doors_time: null, age_limit: null,
      language: 'sv', is_free: null, price_min_sek: null, price_max_sek: null,
      accessibility: null, organizer: null,
    });
    // Inga marknadsföringsord — användaren explicit förbjuder
    expect(summary).not.toMatch(/förbered dig|fantastisk|otrolig|komiker|scenen|anrika|oförglömlig/i);
  });

  it('handles "all ages" age limit', () => {
    const summary = buildEventpulseSummary({
      event_type: 'community',
      artist: 'Familj X',
      support_act: null,
      venue: 'Kulturhuset',
      city: 'Stockholm',
      date: '2026-12-01',
      start_time: '14:00',
      end_time: null, doors_time: null, age_limit: 'all ages',
      language: 'sv', is_free: true, price_min_sek: null, price_max_sek: null,
      accessibility: null, organizer: null,
    });
    expect(summary).toContain('Fri ålder');
    expect(summary).toContain('Gratis inträde');
  });
});

// ─── chooseFact (test G — multi-source conflict) ────────────────────────────

describe('chooseFact (G — deterministic source priority, NO AI pick)', () => {
  it('picks highest-priority source when they conflict', () => {
    // ticketmaster-se (90) beats sthlmlist (60) — even if sthlmlist is first
    const result = chooseFact<string>([
      { source: 'sthlmlist', value: '19:00' },
      { source: 'ticketmaster-se', value: '19:30' },
    ]);
    expect(result).toBe('19:30');
  });

  it('breaks ties deterministically (alphabetical source name)', () => {
    // Båda har samma priority (0 = okänd källa) → 'A' vinner
    const result = chooseFact<string>([
      { source: 'zebra-source', value: '20:00' },
      { source: 'apple-source', value: '19:30' },
    ]);
    expect(result).toBe('19:30');  // apple-source vinner via tie-break
  });

  it('ignores null values — picks non-null over null', () => {
    const result = chooseFact<string | null>([
      { source: 'sthlmlist', value: null },
      { source: 'ticketmaster-se', value: '19:30' },
    ]);
    expect(result).toBe('19:30');
  });

  it('returns null when ALL sources have null', () => {
    const result = chooseFact<string | null>([
      { source: 'a', value: null },
      { source: 'b', value: null },
    ]);
    expect(result).toBe(null);
  });

  it('returns single value when only one source has non-null', () => {
    const result = chooseFact<string | null>([
      { source: 'a', value: null },
      { source: 'b', value: null },
      { source: 'c', value: '20:00' },
    ]);
    expect(result).toBe('20:00');
  });

  it('SOURCE_PRIORITY has sensible default values', () => {
    // Ticketmaster och kulturhuset > scraped aggregator-sajter
    expect(SOURCE_PRIORITY['ticketmaster-se']).toBeGreaterThan(SOURCE_PRIORITY['sthlmlist']);
    expect(SOURCE_PRIORITY['kulturhuset']).toBeGreaterThan(SOURCE_PRIORITY['gratisistockholm']);
  });
});

// ─── End-to-end: marketing text (A) → facts → summary ─────────────────────

describe('end-to-end: marketing text → facts → summary (A)', () => {
  it('extracts facts from marketing-heavy source text and produces neutral summary', () => {
    const SOURCE = `Efter förra årets makalösa succé återupver den älskade artisten X
      äntligen till Stockholm för en oförglömlig kväll fylld av magi och värme.
      Dörrar 18:30. Konsert 19:30. Support: Artist Y. Biljetter från 450 kr.`;

    const { facts } = buildEventpulseFacts({
      category_slug: 'music',
      venue_name: 'Avicii Arena',
      city: 'Stockholm',
      start_time: '2026-11-14T19:30:00Z',
      is_free: false,
      price_min_sek: 450,
      title: 'Artist X',
      raw_description: SOURCE,
    });

    // Fakta extraherade
    expect(facts.doors_time).toBe('18:30');
    expect(facts.support_act).toBe('Artist Y');
    expect(facts.start_time).toBe('19:30');
    // Marknadsföringsorden fångas inte som fakta
    expect(facts.age_limit).toBe(null);
    expect(facts.accessibility).toBe(null);

    // Summary är neutral, baserad på fakta
    const summary = buildEventpulseSummary(facts);
    expect(summary).toContain('Konsert med Artist X');
    expect(summary).toContain('Avicii Arena');
    expect(summary).toContain('Dörrarna öppnar 18:30');
    // Original marknadsföring INTE i summary
    expect(summary).not.toMatch(/makalös|oförglömlig|magi|älskade/i);
    // Inga hittade-på-fakta
    expect(summary).not.toContain('årsgräns');  // vi hittade ingen
    expect(summary).not.toContain('450–');  // vi har bara price_min, ingen range
  });
});

// ─── End-to-end: multi-source facts merge (F) ──────────────────────────────

describe('end-to-end: multi-source facts merge (F)', () => {
  it('combines complementary facts from multiple sources via chooseFact', () => {
    // Källa 1 (sthlmlist) har doors_time + age_limit i description
    const { facts: f1 } = buildEventpulseFacts({
      category_slug: 'music',
      venue_name: 'Göta Lejon',
      city: 'Stockholm',
      start_time: '2026-10-04T20:00:00Z',
      title: 'Dexys',
      raw_description: 'Dörrar 19:00. Åldersgräns 18 år.',
    });

    // Källa 2 (kulturhuset) har inte doors men har korrekt artist
    const { facts: f2 } = buildEventpulseFacts({
      category_slug: 'music',
      venue_name: 'Göta Lejon',
      city: 'Stockholm',
      start_time: '2026-10-04T20:00:00Z',
      title: 'Dexys Midnight Runners',
      raw_description: null,
    });

    // Merging: strukturfält från båda (samma värden), description-only från f1
    const merged = {
      ...f2,  // strukturerade fält från primär källa
      doors_time: chooseFact([
        { source: 'sthlmlist', value: f1.doors_time },
        { source: 'kulturhuset', value: f2.doors_time },
      ]),
      age_limit: chooseFact([
        { source: 'sthlmlist', value: f1.age_limit },
        { source: 'kulturhuset', value: f2.age_limit },
      ]),
    };

    expect(merged.doors_time).toBe('19:00');
    expect(merged.age_limit).toBe('18');
  });
});