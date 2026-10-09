/**
 * gazetteerCache.test.ts — verifierar lookup-logik, alias-hantering, case-insensitivity.
 */
import { describe, expect, it } from 'vitest';
import {
  lookupArtist,
  lookupArtists,
  gazetteerStats,
} from './gazetteerCache';

describe('gazetteerCache', () => {
  it('Total antal artister i curerad JSON är minst 15', () => {
    const { totalArtists } = gazetteerStats();
    expect(totalArtists).toBeGreaterThanOrEqual(15);
  });

  it('Donovan Woods har country=CA och genrer', () => {
    const e = lookupArtist('Donovan Woods');
    expect(e).not.toBeNull();
    expect(e?.country).toBe('CA');
    expect(e?.genres).toContain('folk');
    expect(e?.genres).toContain('country');
  });

  it('Case-insensitive lookup', () => {
    const a = lookupArtist('donovan woods');
    const b = lookupArtist('DONOVAN WOODS');
    const c = lookupArtist('Donovan Woods');
    expect(a?.name).toBe(c?.name);
    expect(b?.name).toBe(c?.name);
  });

  it('Alias-match fungerar (Hakan Hellstrom → Håkan Hellström)', () => {
    const e = lookupArtist('Hakan Hellstrom');
    expect(e?.name).toBe('Håkan Hellström');
    expect(e?.country).toBe('SE');
  });

  it('Okänd artist returnerar null (Quidam, Big in Japan finns inte)', () => {
    expect(lookupArtist('Quidam')).toBeNull();
    expect(lookupArtist('Big in Japan')).toBeNull();
  });

  it('Null/empty input ger null (försvar mot felaktiga anrop)', () => {
    expect(lookupArtist(null)).toBeNull();
    expect(lookupArtist('')).toBeNull();
    expect(lookupArtist(undefined)).toBeNull();
  });

  it('Radiokören (oralt körnamn) har type=Choir', () => {
    const e = lookupArtist('Radiokören');
    expect(e?.type).toBe('Choir');
    expect(e?.country).toBe('SE');
  });

  it('Peter Dijkstra är NL (holländare) inte SE', () => {
    const e = lookupArtist('Peter Dijkstra');
    expect(e?.country).toBe('NL');
    expect(e?.type).toBe('Person');
  });

  it('lookupArtists() returnerar map med null för okända', () => {
    const result = lookupArtists(['Veronica Maggio', 'Quidam', 'Donovan Woods']);
    expect(result['Veronica Maggio']?.country).toBe('SE');
    expect(result['Donovan Woods']?.country).toBe('CA');
    expect(result['Quidam']).toBeNull();
  });
});
