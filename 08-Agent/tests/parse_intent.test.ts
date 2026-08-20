/**
 * Tests for parseIntentDeterministic.
 *
 * Run with:  npx vitest run 08-Agent/tests
 */

import { describe, expect, it } from 'vitest';
import { parseIntentDeterministic } from '../tools/parse_intent';

const TODAY = new Date('2026-08-17T10:00:00Z');

describe('parseIntentDeterministic', () => {
  it('detects Swedish language', () => {
    const r = parseIntentDeterministic('konsert ikväll i Stockholm', TODAY);
    expect(r.language).toBe('sv');
  });

  it('detects English language', () => {
    const r = parseIntentDeterministic('free jazz tonight', TODAY);
    expect(r.language).toBe('en');
  });

  it('extracts the music category', () => {
    const r = parseIntentDeterministic('jazz konsert ikväll', TODAY);
    expect(r.categories).toContain('music');
  });

  it('marks free intent when "gratis" appears', () => {
    const r = parseIntentDeterministic('gratis konsert ikväll', TODAY);
    expect(r.budget).toBe('free');
  });

  it('marks family intent when "familj" appears', () => {
    const r = parseIntentDeterministic('familj aktivitet på lördag', TODAY);
    expect(r.party).toBe('family');
  });

  it('maps "ikväll" to today (date_from === date_to)', () => {
    const r = parseIntentDeterministic('musik ikväll', TODAY);
    expect(r.date_from).toBe('2026-08-17');
    expect(r.date_to).toBe('2026-08-17');
  });

  it('always defaults city to Stockholm', () => {
    const r = parseIntentDeterministic('vad händer?', TODAY);
    expect(r.city).toBe('Stockholm');
  });

  it('captures exclude categories', () => {
    const r = parseIntentDeterministic('jazz men inte musik', TODAY);
    expect(r.exclude_categories).toContain('music');
  });

  it('keeps raw_query verbatim', () => {
    const q = '  Hej, något kul ikväll?  ';
    const r = parseIntentDeterministic(q, TODAY);
    expect(r.raw_query).toBe(q.trim());
  });

  // ── Workstream A — new date phrases (MASTERPLAN §18 D2) ─────────────────

  it('"på fredag" resolves to next Friday (today Mon 2026-08-17 → 2026-08-21)', () => {
    const r = parseIntentDeterministic('på fredag', TODAY);
    expect(r.date_from).toBe('2026-08-21');
    expect(r.date_to).toBe('2026-08-21');
  });

  it('"imorgon" resolves to tomorrow', () => {
    const r = parseIntentDeterministic('imorgon', TODAY);
    expect(r.date_from).toBe('2026-08-18');
    expect(r.date_to).toBe('2026-08-18');
  });

  it('"i morgon" also resolves to tomorrow (two-word form)', () => {
    const r = parseIntentDeterministic('i morgon', TODAY);
    expect(r.date_from).toBe('2026-08-18');
    expect(r.date_to).toBe('2026-08-18');
  });

  it('"i helgen" resolves to Sat–Sun', () => {
    const r = parseIntentDeterministic('i helgen', TODAY);
    expect(r.date_from).toBe('2026-08-22');
    expect(r.date_to).toBe('2026-08-23');
  });

  it('"idag" resolves to today', () => {
    const r = parseIntentDeterministic('idag', TODAY);
    expect(r.date_from).toBe('2026-08-17');
    expect(r.date_to).toBe('2026-08-17');
  });

  it('"i övermorgon" resolves to +2 days', () => {
    const r = parseIntentDeterministic('i övermorgon', TODAY);
    expect(r.date_from).toBe('2026-08-19');
    expect(r.date_to).toBe('2026-08-19');
  });

  it('"denna vecka" resolves to Mon..Sun of current Stockholm week', () => {
    const r = parseIntentDeterministic('denna vecka', TODAY);
    expect(r.date_from).toBe('2026-08-17');
    expect(r.date_to).toBe('2026-08-23');
  });

  it('"nästa månad" resolves to first..last day of next month', () => {
    const r = parseIntentDeterministic('nästa månad', TODAY);
    expect(r.date_from).toBe('2026-09-01');
    expect(r.date_to).toBe('2026-09-30');
  });

  it('every bare Swedish weekday resolves to a valid future YYYY-MM-DD', () => {
    const days = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
    for (const d of days) {
      const r = parseIntentDeterministic(`konsert på ${d}`, TODAY);
      expect(r.date_from, `weekday=${d}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.date_from).toBe(r.date_to);
    }
  });

  // ── Party parsing additions (MASTERPLAN §18 — gap 3) ───────────────────

  it('detects "sambo" as couple', () => {
    expect(partyOf('konsert med sambo ikväll')).toBe('couple');
  });

  it('detects "tjejen" as couple', () => {
    expect(partyOf('konsert med tjejen ikväll')).toBe('couple');
  });

  it('detects "dejta" as couple', () => {
    expect(partyOf('vill dejta ikväll')).toBe('couple');
  });

  it('detects "kompisarna" as friends', () => {
    expect(partyOf('öl med kompisarna')).toBe('friends');
  });

  it('detects "med barn" as family', () => {
    expect(partyOf('något med barn imorgon')).toBe('family');
  });
});

// Helper at module scope to keep the party assertions above compact.
function partyOf(q: string): string {
  return parseIntentDeterministic(q, TODAY).party;
}
