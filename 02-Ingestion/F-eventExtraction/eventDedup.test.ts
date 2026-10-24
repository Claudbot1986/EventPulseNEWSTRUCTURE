/**
 * Tester för eventDedup — R1 (identitet utan url) och R2 (bild-alt-text).
 *
 * Varje fallback har en positiv kontroll (fallet ska FALLERA) och en
 * negativ kontroll (fallet ska INTE fälla). Utan negativa kontroller
 * bevisar en grön test ingenting — regeln kan bara vara trasig.
 */
import { describe, it, expect } from 'vitest';
import {
  dedupeEvents,
  identityKey,
  isAltTextTitle,
  hasUrl,
  dayKey,
  ALT_TEXT_TITLE_SIGNAL,
  type DedupableEvent,
} from './eventDedup';

function evt(partial: Partial<DedupableEvent> & { title: string; date: string }): DedupableEvent {
  return {
    time: undefined,
    url: undefined,
    confidence: { signals: [] },
    ...partial,
  };
}

function alt(partial: Partial<DedupableEvent> & { title: string; date: string }): DedupableEvent {
  return evt({
    ...partial,
    confidence: { signals: [ALT_TEXT_TITLE_SIGNAL] },
  });
}

describe('eventDedup — hjälpfunktioner', () => {
  it('identityKey ignorerar url (R1)', () => {
    const a = evt({ title: 'Jag är Ulla Winblad', date: '2026-10-24', time: '18:00', url: 'https://x.se/a' });
    const b = evt({ title: 'Jag är Ulla Winblad', date: '2026-10-24', time: '18:00' });
    expect(identityKey(a)).toBe(identityKey(b));
  });

  it('identityKey skiljer på olika tid', () => {
    const a = evt({ title: 'Sagolek', date: '2026-10-24', time: '10:00' });
    const b = evt({ title: 'Sagolek', date: '2026-10-24', time: '11:30' });
    expect(identityKey(a)).not.toBe(identityKey(b));
  });

  it('hasUrl räknar tom sträng som ingen url', () => {
    expect(hasUrl(evt({ title: 'x', date: '2026-01-01', url: '' }))).toBe(false);
    expect(hasUrl(evt({ title: 'x', date: '2026-01-01', url: 'https://a.se' }))).toBe(true);
  });

  it('isAltTextTitle kräver signalen', () => {
    expect(isAltTextTitle(evt({ title: 'x', date: '2026-01-01' }))).toBe(false);
    expect(isAltTextTitle(alt({ title: 'x', date: '2026-01-01' }))).toBe(true);
  });

  it('dayKey använder bara datum', () => {
    expect(dayKey(evt({ title: 'x', date: '2026-11-18', time: '10:15' }))).toBe('2026-11-18');
  });
});

describe('R1 — samma titel+datum+tid är samma event', () => {
  it('slår ihop identiska rader som skiljer sig åt på url', () => {
    const res = dedupeEvents([
      evt({ title: 'Jag är Ulla Winblad', date: '2026-10-24', time: '18:00', url: 'https://folkoperan.se/x' }),
      evt({ title: 'Jag är Ulla Winblad', date: '2026-10-24', time: '18:00' }),
    ]);
    expect(res.kept).toHaveLength(1);
    expect(res.droppedDuplicate).toBe(1);
  });

  it('behåller varianten med url', () => {
    const res = dedupeEvents([
      evt({ title: 'Jag är Ulla Winblad', date: '2026-10-24', time: '18:00' }),
      evt({ title: 'Jag är Ulla Winblad', date: '2026-10-24', time: '18:00', url: 'https://folkoperan.se/x' }),
    ]);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0].url).toBe('https://folkoperan.se/x');
  });

  it('lämnar olika tider åt (samma titel, olika klockslag = två föreställningar)', () => {
    const res = dedupeEvents([
      evt({ title: 'Sagolek', date: '2026-10-24', time: '10:00' }),
      evt({ title: 'Sagolek', date: '2026-10-24', time: '11:30' }),
    ]);
    expect(res.kept).toHaveLength(2);
    expect(res.droppedDuplicate).toBe(0);
  });

  it('lämnar olika datum åt', () => {
    const res = dedupeEvents([
      evt({ title: 'Tisdag–söndagGuidade visningar', date: '2026-10-27' }),
      evt({ title: 'Tisdag–söndagGuidade visningar', date: '2026-11-18' }),
    ]);
    expect(res.kept).toHaveLength(2);
  });

  it('NEGATIV KONTROLL: samma titel+datum+tid med två OLIKA url → båda behålls', () => {
    // Konserthuset: klockan ligger bara i url:en, så detta är två olika
    // företrädanden. En naiv "en rad per identitet" hade tagit bort den ena.
    const res = dedupeEvents([
      evt({ title: 'Sagolek – Den lille prinsen', date: '2026-10-25', url: 'https://www.konserthuset.se/konserter/20261025-1000/' }),
      evt({ title: 'Sagolek – Den lille prinsen', date: '2026-10-25', url: 'https://www.konserthuset.se/konserter/20261025-1130/' }),
    ]);
    expect(res.kept).toHaveLength(2);
    expect(res.droppedDuplicate).toBe(0);
    expect(res.kept.map(e => e.url)).toEqual([
      'https://www.konserthuset.se/konserter/20261025-1000/',
      'https://www.konserthuset.se/konserter/20261025-1130/',
    ]);
  });

  it('NEGATIV KONTROLL: samma url två gånger → bara en behålls', () => {
    const res = dedupeEvents([
      evt({ title: 'Sagolek', date: '2026-10-25', url: 'https://www.konserthuset.se/konserter/20261025-1000/' }),
      evt({ title: 'Sagolek', date: '2026-10-25', url: 'https://www.konserthuset.se/konserter/20261025-1000/' }),
    ]);
    expect(res.kept).toHaveLength(1);
    expect(res.droppedDuplicate).toBe(1);
  });

  it('NEGATIV KONTROLL: rader utan date men med startTime slås inte ihop', () => {
    // Berwaldhallen: "Bowie in Berlin" 26/27/28 nov — samma titel, samma
    // url, men tre olika datum. Rader som saknar `date` får `startTime`
    // som reservdatum, annars skulle de kollapsa till en.
    const res = dedupeEvents([
      { title: 'Bowie in Berlin', date: '', url: 'https://boka.berwaldhallen.se/sv/buyingflow/tickets/30538/', startTime: '2026-11-26T00:00:00.000Z' },
      { title: 'Bowie in Berlin', date: '', url: 'https://boka.berwaldhallen.se/sv/buyingflow/tickets/30538/', startTime: '2026-11-27T00:00:00.000Z' },
      { title: 'Bowie in Berlin', date: '', url: 'https://boka.berwaldhallen.se/sv/buyingflow/tickets/30538/', startTime: '2026-11-28T00:00:00.000Z' },
    ]);
    expect(res.kept).toHaveLength(3);
    expect(res.droppedDuplicate).toBe(0);
  });
});

describe('R2 — bild-alt-text som titel', () => {
  it('tar bort bildtexten när ett riktigt event finns samma dag', () => {
    const res = dedupeEvents([
      alt({ title: 'Komikern Kirsty Armstrong med rödlockigt hår', date: '2026-12-04', time: '19:30' }),
      evt({ title: 'Standup x Oslipat: Kirsty Armstrong', date: '2026-12-04', time: '19:30', url: 'https://f.se/e' }),
    ]);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0].title).toBe('Standup x Oslipat: Kirsty Armstrong');
    expect(res.droppedAltText).toBe(1);
  });

  it('tar bort bildtexten även när tiden skiljer sig', () => {
    const res = dedupeEvents([
      alt({ title: 'Svartvit bild av en kvinna som dricker vin', date: '2026-12-31' }),
      evt({ title: 'Nyår på Fotografiska', date: '2026-12-31', time: '16:00', url: 'https://f.se/e' }),
    ]);
    expect(res.kept).toHaveLength(1);
    expect(res.droppedAltText).toBe(1);
  });

  it('NEGATIV KONTROLL: bildtext utan motsvarande event behålls', () => {
    const res = dedupeEvents([
      alt({ title: 'Bildtext', date: '2026-12-31' }),
      evt({ title: 'Anat annat event', date: '2027-01-05', url: 'https://f.se/e' }),
    ]);
    expect(res.kept).toHaveLength(2);
    expect(res.droppedAltText).toBe(0);
  });

  it('NEGATIV KONTROLL: bildtext med url behålls (den kan vara ett riktigt event)', () => {
    const res = dedupeEvents([
      alt({ title: 'Bildtext', date: '2026-12-31', url: 'https://f.se/e' }),
      evt({ title: 'Riktigt event', date: '2026-12-31', url: 'https://f.se/2' }),
    ]);
    expect(res.kept).toHaveLength(2);
    expect(res.droppedAltText).toBe(0);
  });

  it('NEGATIV KONTROLL: vanlig titel påverkas inte av R2', () => {
    const res = dedupeEvents([
      evt({ title: 'Ordinarie event', date: '2026-12-31' }),
      evt({ title: 'Tillhörande', date: '2026-12-31', url: 'https://f.se/e' }),
    ]);
    expect(res.kept).toHaveLength(2);
  });
});

describe('kombination — R1 före R2', () => {
  it('en bildtext som kollapsat in i en riktig rad räknas inte som "annat event"', () => {
    // Bildtexten har samma titel som den riktiga raden → R1 slår ihop dem,
    // sedan ska R2 inte se någon kvarvarande bildtext.
    const res = dedupeEvents([
      alt({ title: 'Samma', date: '2026-12-31' }),
      evt({ title: 'Samma', date: '2026-12-31', url: 'https://f.se/e' }),
    ]);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0].url).toBe('https://f.se/e');
    expect(res.droppedAltText).toBe(0);
  });

  it('behåller ordningen på de överlevande raderna', () => {
    const res = dedupeEvents([
      evt({ title: 'A', date: '2026-01-01' }),
      evt({ title: 'B', date: '2026-01-02' }),
      evt({ title: 'C', date: '2026-01-03' }),
    ]);
    expect(res.kept.map(e => e.title)).toEqual(['A', 'B', 'C']);
  });
});
