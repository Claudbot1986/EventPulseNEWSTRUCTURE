/**
 * Regressionstester för venue_full_-fältens textskydd (2026-10-23).
 *
 * Bakgrund: JSON-LD anger venue/address/organizer som OBJEKT. `String(obj)` →
 * '[object Object]'. Fixen i universal-extractor.ts stoppar det vid källan,
 * men gamla extraherade filer (halmstad-konserthus-2, downtown-2, lulea-hf-2,
 * globen-3) innehåller fortfarande artefakten, och normalizern skrev den
 * rakt vidare till events.venue_full_address.
 *
 * Mätt: 116 events hade venue_full_address = '[object Object]' (0 av dem hade
 * venue_id — de kom från raw.venue_address), och venues-tabellen hade 2
 * rader med address = '[object Object]'.
 *
 * Skyddet måste sitta vid PERSISTERINGSGRÄNSEN, inte bara i extraktorn:
 * annars kommer varje gammal fil att skriva skräp tillbaka.
 */

import { describe, it, expect } from 'vitest';
import { isUsableText, isValidVenueName } from './normalizer';

describe('isUsableText — artefakter ska aldrig bli fältvärden', () => {
  it('accepterar vanlig text', () => {
    expect(isUsableText('Birger Jarlsgatan 57')).toBe(true);
    expect(isUsableText('Oscarsteatern')).toBe(true);
    expect(isUsableText('Stockholm')).toBe(true);
  });

  it('avvisar stringifierade JS-objekt', () => {
    expect(isUsableText('[object Object]')).toBe(false);
    expect(isUsableText('[object Array]')).toBe(false);
    expect(isUsableText('  [object Object]  ')).toBe(false);
  });

  it('avvisar "undefined"/"null"/"None"-strängar', () => {
    expect(isUsableText('undefined')).toBe(false);
    expect(isUsableText('null')).toBe(false);
    expect(isUsableText('None')).toBe(false);
  });

  it('avvisar tomma värden', () => {
    expect(isUsableText('')).toBe(false);
    expect(isUsableText('   ')).toBe(false);
    expect(isUsableText(null)).toBe(false);
    expect(isUsableText(undefined)).toBe(false);
  });

  it('avvisar icke-strängar', () => {
    expect(isUsableText({ name: 'x' } as unknown as string)).toBe(false);
    expect(isUsableText(42 as unknown as string)).toBe(false);
  });
});

describe('isValidVenueName — använder samma skydd', () => {
  it('avvisar fortfarande artefakter', () => {
    expect(isValidVenueName('[object Object]')).toBe(false);
    expect(isValidVenueName('undefined')).toBe(false);
  });

  it('accepterar ett riktigt platsnamn', () => {
    expect(isValidVenueName('Oscarsteatern')).toBe(true);
  });

  it('accepterar ett objekt som inte är en sträng', () => {
    expect(isValidVenueName({ name: 'Oscarsteatern' } as unknown as string)).toBe(false);
  });
});
