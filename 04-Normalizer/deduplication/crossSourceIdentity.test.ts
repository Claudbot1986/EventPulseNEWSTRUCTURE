import { describe, it, expect } from 'vitest';
import {
  crossSourceIdentity,
  normalizeIdentityTitle,
  stockholmLocalDateTime,
  venueIdentityKey,
  hasKnownTime,
} from './crossSourceIdentity';

/**
 * Regressionstester för rotorsaken bakom dubblettkorten i appen
 * (2026-10-30): "MAFFIA COMEDY SUPERWEEKEND" syndes två gånger i
 * Utforska (livespot + evensos) med identisk titel/datum/tid.
 *
 * Negativa kontroller är lika viktiga som positiva: en dedup-regel som
 * slår ihop för mycket tar bort riktiga evenemang ur appen.
 */

describe('normalizeIdentityTitle', () => {
  it('tar bort diakritiska (Almén → Almen)', () => {
    expect(normalizeIdentityTitle('Elin Almén m.fl')).toBe('elin almen m fl');
  });

  it('behåller svenska bokstäcker åäö', () => {
    // "söder" och "soder" får INTE bli samma — det vore ett gissande.
    expect(normalizeIdentityTitle('Konsert på Söder')).toBe('konsert pa soder');
    expect(normalizeIdentityTitle('Konsert pa Soder')).toBe('konsert pa soder');
  });

  it('normaliserar skiljetecken och extra blanksteg', () => {
    expect(normalizeIdentityTitle('Kåldolmar & Club  Killers!')).toBe(
      'kaldolmar club killers',
    );
  });

  it('ger tom sträng för tom titel', () => {
    expect(normalizeIdentityTitle('')).toBe('');
    expect(normalizeIdentityTitle(null)).toBe('');
    expect(normalizeIdentityTitle(undefined)).toBe('');
  });
});

describe('stockholmLocalDateTime', () => {
  it('läser lokal datumdel (icke-UTC-midnatt)', () => {
    // 2026-11-13T23:30Z = 2026-11-14 00:30 i Stockholm.
    expect(stockholmLocalDateTime('2026-11-13T23:30:00Z')).toEqual({
      day: '2026-11-14',
      time: '00:30',
    });
  });

  it('läser lokal klockslag, inte UTC', () => {
    // 18:00 UTC i november (CET) = 19:00 lokal.
    expect(stockholmLocalDateTime('2026-11-04T18:00:00+00:00')).toEqual({
      day: '2026-11-04',
      time: '19:00',
    });
  });

  it('behandlar lokal 00:00 som OKÄND tid', () => {
    // Källor som bara vet datumet skriver 00:00. Det är inte midnatt.
    expect(stockholmLocalDateTime('2026-10-26T00:00:00+00:00')).toEqual({
      day: '2026-10-26',
      time: '',
    });
  });

  it('behandlar datum-only som OKÄND tid', () => {
    expect(stockholmLocalDateTime('2026-11-13')).toEqual({ day: '2026-11-13', time: '' });
  });

  it('returnerar null för trasig tidsstämpel', () => {
    expect(stockholmLocalDateTime('inte-en-tid')).toBeNull();
    expect(stockholmLocalDateTime(null)).toBeNull();
  });
});

describe('stockholmLocalDateTime — Date och ISO-sträng måste ge samma svar', () => {
  it('använder den LOKALA dagen vid lokal midnatt', () => {
    // 2026-10-25T23:00Z = 2026-10-26 00:00 i Stockholm (CET).
    // Dagen är den lokala — 26:e — inte UTC-dagen som är 25:e.
    const iso = '2026-10-25T23:00:00.000Z';
    expect(stockholmLocalDateTime(new Date(iso))).toEqual({
      day: '2026-10-26',
      time: '',
    });
  });

  it('håller Date- och strängvägen ihop över hela dygnet', () => {
    // Regression (2026-10-30): Date-vägen använde UTC-dagen medan
    // strängvägen använde Stockholmsdagen. Mellan 23:00–24:00 UTC
    // (vinter) / 22:00–24:00 UTC (sommar) gav det två OLIKA
    // identitetsnycklar för samma evenemang — beroende på vilken
    // kodväg som räknade. Mätt i live-DB: 1 186 rader berörda, och
    // skrivvägen (ingestion) hittade 27 dubblettgrupper där den
    // lagrade nyckeln bara hittade 2.
    for (const iso of [
      '2026-01-15T23:00:00.000Z', // vinter, lokal midnatt
      '2026-06-15T22:00:00.000Z', // sommar, lokal midnatt
      '2026-06-15T23:00:00.000Z', // sommar, lokal 01:00
      '2026-11-13T23:30:00.000Z', // vinter, lokal 00:30
      '2026-03-01T00:00:00.000Z', // UTC-midnatt → okänd tid
      '2026-11-20T19:00:00.000Z', // vanlig kväll
    ]) {
      expect(stockholmLocalDateTime(new Date(iso))).toEqual(
        stockholmLocalDateTime(iso),
      );
    }
  });

  it('ger samma identitetsnyckel oavsett Date eller sträng', () => {
    const base = {
      title: 'Workshop: Skapa julpynt i mässing',
      venueId: '11111111-2222-3333-4444-555555555555',
      venueName: 'Hallwylska museet',
    };
    const iso = '2026-11-14T23:00:00.000Z';
    expect(crossSourceIdentity({ ...base, startTime: new Date(iso) })).toBe(
      crossSourceIdentity({ ...base, startTime: iso }),
    );
  });
});

describe('venueIdentityKey', () => {
  it('föredrar venue-namn framför venue_id', () => {
    // Samma venue med olika venue_id-former i olika rader (mätt i DB:
    // Berwaldhallen bar både "0890b62c…" och NULL).
    expect(
      venueIdentityKey({ venueId: '0890b62c-1111', venueName: 'Berwaldhallen' }),
    ).toBe('vfn:berwaldhallen');
    expect(venueIdentityKey({ venueId: null, venueName: 'Berwaldhallen' })).toBe(
      'vfn:berwaldhallen',
    );
  });

  it('faller tillbaka på venue_id när namnet saknas', () => {
    expect(venueIdentityKey({ venueId: 'abc-123', venueName: null })).toBe('vid:abc-123');
  });

  it('ger tom nyckel när ingen plats finns', () => {
    expect(venueIdentityKey({ venueId: null, venueName: '' })).toBe('');
  });
});

describe('crossSourceIdentity', () => {
  const base = {
    title: 'MAFFIA COMEDY SUPERWEEKEND med Elin Almén m.fl',
    startTime: '2026-11-20T19:00:00+00:00',
    venueId: '83b660f4-f5d5-491a-bda5-e2dbc54ba808',
    venueName: 'Nalen',
  };

  it('ger samma nyckel för samma event från två källor', () => {
    // livespot + evensos → samma MAFFIA-show. Detta ÄR dubbletten i appen.
    const livespot = crossSourceIdentity(base);
    const evensos = crossSourceIdentity({ ...base, venueId: 'annan-venue-id' });
    expect(livespot).toBe(evensos);
  });

  it('ger olika nyckel för olika datum (samma serie, olika föreställning)', () => {
    // MAFFIA-serien har samma titel på flera datum — de är SKILDA events.
    const a = crossSourceIdentity(base);
    const b = crossSourceIdentity({ ...base, startTime: '2026-11-21T19:00:00+00:00' });
    expect(a).not.toBe(b);
  });

  it('ger olika nyckel för olika klockslag (två föreställningar samma dag)', () => {
    const a = crossSourceIdentity(base);
    const b = crossSourceIdentity({ ...base, startTime: '2026-11-20T20:30:00+00:00' });
    expect(a).not.toBe(b);
  });

  it('ger olika nyckel för olika plats', () => {
    const a = crossSourceIdentity(base);
    const b = crossSourceIdentity({ ...base, venueName: 'Berns', venueId: 'x' });
    expect(a).not.toBe(b);
  });

  it('ger olika nyckel när titeln skiljer sig', () => {
    const a = crossSourceIdentity(base);
    const b = crossSourceIdentity({
      ...base,
      title: 'MAFFIA COMEDY SUPERWEEKEND med Tobias Persson m.fl',
    });
    expect(a).not.toBe(b);
  });

  it('returnerar null när titeln saknas', () => {
    expect(crossSourceIdentity({ ...base, title: null })).toBeNull();
  });

  it('returnerar null när tiden är trasig', () => {
    expect(crossSourceIdentity({ ...base, startTime: 'skräp' })).toBeNull();
  });
});

describe('hasKnownTime', () => {
  it('sant för tidsatta events', () => {
    expect(hasKnownTime({ startTime: '2026-11-20T19:00:00+00:00' })).toBe(true);
  });

  it('falskt för datum-only', () => {
    expect(hasKnownTime({ startTime: '2026-11-20' })).toBe(false);
    expect(hasKnownTime({ startTime: '2026-11-20T00:00:00+00:00' })).toBe(false);
  });
});
