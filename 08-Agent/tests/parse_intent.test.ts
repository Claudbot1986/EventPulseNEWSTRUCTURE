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
});
