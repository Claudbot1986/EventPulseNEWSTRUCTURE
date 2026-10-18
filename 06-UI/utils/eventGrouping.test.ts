/**
 * eventGrouping.test.ts — enhetstester för occurrence-gruppering.
 *
 * Säkrar:
 *   - canonical_event_id vinner över title+venue-gruppering
 *   - normalizeEventTitle hanterar whitespace, accenter, parens
 *   - extraOccurrencesCount räknar andra, inte sig själv
 *   - otherOccurrences sorteras på start_time
 *   - tomma titlar / saknade fält hanteras gracefully (null/0)
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeEventTitle,
  occurrenceGroupKey,
  groupOccurrences,
  extraOccurrencesCount,
  otherOccurrences,
} from './eventGrouping';

describe('normalizeEventTitle', () => {
  it('lowercasar och trimmar', () => {
    expect(normalizeEventTitle('  Chicago - the Musical  ')).toBe('chicago - the musical');
  });

  it('tar bort accenter', () => {
    expect(normalizeEventTitle('Föreläsning')).toBe('forelasning');
  });

  it('tar bort parens-suffix', () => {
    expect(normalizeEventTitle('Chicago (lördag)')).toBe('chicago');
    expect(normalizeEventTitle('Chicago [Familj]')).toBe('chicago');
  });

  it('tar bort ändelse-interpunktion', () => {
    expect(normalizeEventTitle('Chicago!')).toBe('chicago');
    expect(normalizeEventTitle('Chicago.')).toBe('chicago');
  });

  it('hanterar null/undefined/tom sträng', () => {
    expect(normalizeEventTitle(null)).toBe('');
    expect(normalizeEventTitle(undefined)).toBe('');
    expect(normalizeEventTitle('')).toBe('');
    expect(normalizeEventTitle(123)).toBe(''); // fel typ
  });
});

describe('occurrenceGroupKey', () => {
  it('returnerar canonical_event_id-prefixad nyckel om satt', () => {
    const key = occurrenceGroupKey({
      id: 'a',
      title_sv: 'Hej',
      canonical_event_id: 'foo123',
    });
    expect(key).toBe('can:foo123');
  });

  it('canonical vinner över title+venue', () => {
    const key = occurrenceGroupKey({
      id: 'a',
      title_sv: 'Hej',
      venue_id: 'venue-1',
      canonical_event_id: 'can-x',
    });
    expect(key).toBe('can:can-x');
  });

  it('grupperar på title + venue_id', () => {
    const k1 = occurrenceGroupKey({ title_sv: 'Chicago', venue_id: 'v1' });
    const k2 = occurrenceGroupKey({ title_sv: 'CHICAGO', venue_id: 'v1' });
    expect(k1).toBe(k2);
    expect(k1).toBe('ttl:chicago|vid:v1');
  });

  it('grupperar på title + venue_full_name om venue_id saknas', () => {
    const k = occurrenceGroupKey({ title_sv: 'Amnesi', venue_full_name: 'Lejonkulan' });
    expect(k).toBe('ttl:amnesi|vfn:lejonkulan');
  });

  it('skiljer events på olika venues även vid samma titel', () => {
    const k1 = occurrenceGroupKey({ title_sv: 'Konsert', venue_full_name: 'A' });
    const k2 = occurrenceGroupKey({ title_sv: 'Konsert', venue_full_name: 'B' });
    expect(k1).not.toBe(k2);
  });

  it('returnerar null om titel saknas helt', () => {
    expect(occurrenceGroupKey({ id: 'a' })).toBeNull();
    expect(occurrenceGroupKey({ id: 'a', title_sv: '' })).toBeNull();
  });
});

describe('groupOccurrences', () => {
  it('grupperar recurring events samma canonical', () => {
    const events = [
      { id: '1', title_sv: 'Chicago', venue_id: 'v', start_time: '2027-01-22T18:30:00Z', canonical_event_id: 'c1' },
      { id: '2', title_sv: 'Chicago', venue_id: 'v', start_time: '2027-02-12T18:30:00Z', canonical_event_id: 'c1' },
      { id: '3', title_sv: 'Amnesi', venue_id: 'l', start_time: '2027-01-10T14:00:00Z' },
    ];
    const groups = groupOccurrences(events);
    expect(groups.size).toBe(2);
    expect(groups.get('can:c1')?.length).toBe(2);
    expect(groups.get('ttl:amnesi|vid:l')?.length).toBe(1);
  });

  it('tom input → tom map', () => {
    expect(groupOccurrences([]).size).toBe(0);
    expect(groupOccurrences(null).size).toBe(0);
  });

  it('skippar events utan titel', () => {
    const groups = groupOccurrences([
      { id: '1' }, // ingen titel
      { id: '2', title_sv: 'X' },
    ]);
    expect(groups.size).toBe(1);
  });
});

describe('extraOccurrencesCount', () => {
  it('returnerar antal andra i samma grupp', () => {
    const events = [
      { id: '1', title_sv: 'Chicago', venue_id: 'v', start_time: '2027-01-22T18:30:00Z' },
      { id: '2', title_sv: 'Chicago', venue_id: 'v', start_time: '2027-02-12T18:30:00Z' },
      { id: '3', title_sv: 'Chicago', venue_id: 'v', start_time: '2027-02-06T18:30:00Z' },
      { id: '4', title_sv: 'Amnesi', venue_id: 'l' },
    ];
    const groups = groupOccurrences(events);
    const current = events[0];
    expect(extraOccurrencesCount(current, groups)).toBe(2);
  });

  it('returnerar 0 om enskild', () => {
    const events = [{ id: '1', title_sv: 'Solo', venue_id: 'v' }];
    const groups = groupOccurrences(events);
    expect(extraOccurrencesCount(events[0], groups)).toBe(0);
  });

  it('returnerar 0 för event som inte är i groups', () => {
    const groups = new Map();
    expect(extraOccurrencesCount({ id: 'x', title_sv: 'Y' }, groups)).toBe(0);
  });
});

describe('otherOccurrences', () => {
  it('returnerar peers sorterade på start_time', () => {
    const events = [
      { id: 'a', title_sv: 'Show', venue_id: 'v', start_time: '2027-02-01T19:00:00Z' },
      { id: 'b', title_sv: 'Show', venue_id: 'v', start_time: '2027-01-15T19:00:00Z' },
      { id: 'c', title_sv: 'Show', venue_id: 'v', start_time: '2027-01-22T19:00:00Z' },
    ];
    const groups = groupOccurrences(events);
    const current = events[0];
    const others = otherOccurrences(current, groups);
    expect(others.map((o) => o.id)).toEqual(['b', 'c']);
  });

  it('exkluderar currentEvent från listan', () => {
    const events = [
      { id: 'self', title_sv: 'X', venue_id: 'v' },
    ];
    const groups = groupOccurrences(events);
    expect(otherOccurrences(events[0], groups)).toEqual([]);
  });
});
