/**
 * Tests for toStatusExpanded — maps adapter-status strings to the strict
 * events.status_expanded enum. Validated against the CHECK constraint in
 * 05-Supabase/migrations/20260927-0002-status-expanded-not-yet-on-sale.sql.
 */
import { describe, it, expect } from 'vitest';
import { toStatusExpanded } from './extractor';

describe('toStatusExpanded', () => {
  describe('canonical enum values pass through', () => {
    const cases: Array<[string, string]> = [
      ['scheduled', 'scheduled'],
      ['cancelled', 'cancelled'],
      ['postponed', 'postponed'],
      ['rescheduled', 'rescheduled'],
      ['sold_out', 'sold_out'],
      ['not_yet_on_sale', 'not_yet_on_sale'],
    ];
    for (const [input, expected] of cases) {
      it(`${input} → ${expected}`, () => {
        expect(toStatusExpanded(input)).toBe(expected);
      });
    }
  });

  describe('aliases map to canonical', () => {
    const cases: Array<[string, string]> = [
      ['canceled', 'cancelled'], // US spelling
      ['SoldOut', 'sold_out'],    // camelCase
      ['SLUTSÅLD', 'sold_out'],   // Swedish
      ['slutsalt', 'sold_out'],   // misspelled
      ['Ej Öppet', 'not_yet_on_sale'],
    ];
    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} → ${expected}`, () => {
        expect(toStatusExpanded(input)).toBe(expected);
      });
    }
  });

  describe('non-status values map to null', () => {
    const cases = [
      ['available', null],
      ['few_tickets', null],     // UI badge only — not in status_expanded enum
      ['posted', null],           // universal-extractor default; treated as null
      ['unknown', null],
      ['', null],
      ['Some Random String', null],
    ];
    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} → ${expected}`, () => {
        expect(toStatusExpanded(input as string)).toBe(expected);
      });
    }
  });

  it('undefined → null', () => {
    expect(toStatusExpanded(undefined)).toBe(null);
  });
});