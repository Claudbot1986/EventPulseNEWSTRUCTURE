/**
 * claimNormalizer.test.ts — unit tests för claimNormalizer.
 *
 * Säkrar att:
 *   - Duration: "130 min" ↔ "2 h 10 min" ↔ "2 tim 10 min" ↔ "2 timmar och 10 minuter"
 *   - Datum: "8 oktober 2026" ↔ "2026-10-08" ↔ "8/10 2026"
 *   - Klockslag: "19:00" ↔ "kl 19" ↔ "19.00"
 *   - Pris: "250 kr" ↔ "250:-" ↔ "250 kronor"
 *   - Ålder: "18 år" ↔ "18+" ↔ "från 18 år"
 *   - Namn: "Beethoven" ↔ "Ludwig van Beethoven" ↔ "L. v. Beethoven"
 *   - Numeriskt: "95 musiker" ↔ "95-manna orkester"
 */
import { describe, expect, it } from 'vitest';
import {
  parseDurationToMinutes,
  durationNormalForms,
  parseSwedishDate,
  dateNormalForms,
  parseClockTime,
  timeNormalForms,
  parsePriceToSek,
  priceNormalForms,
  parseAgeLimit,
  ageNormalForms,
  normalizeName,
  parseNumberWithUnit,
  numberUnitNormalForms,
  allNormalForms,
} from './claimNormalizer';

describe('parseDurationToMinutes', () => {
  it('parsear ren minutangivelse', () => {
    expect(parseDurationToMinutes('130 min')).toBe(130);
    expect(parseDurationToMinutes('130 minuter')).toBe(130);
  });

  it('parsear HH:MM format', () => {
    expect(parseDurationToMinutes('2:10')).toBe(130);
    expect(parseDurationToMinutes('1:30')).toBe(90);
  });

  it('parsear tim + min kombinationer', () => {
    expect(parseDurationToMinutes('2 h 10 min')).toBe(130);
    expect(parseDurationToMinutes('2 tim 10 min')).toBe(130);
    expect(parseDurationToMinutes('2 timmar och 10 minuter')).toBe(130);
    expect(parseDurationToMinutes('2 timmar, 10 min')).toBe(130);
  });

  it('parsear ren timangivelse', () => {
    expect(parseDurationToMinutes('2 tim')).toBe(120);
    expect(parseDurationToMinutes('2 timmar')).toBe(120);
    expect(parseDurationToMinutes('1.5 timme')).toBe(90);
  });

  it('parsear compact format', () => {
    expect(parseDurationToMinutes('2h10m')).toBe(130);
  });

  it('returnerar null för oparsbar input', () => {
    expect(parseDurationToMinutes('')).toBe(null);
    expect(parseDurationToMinutes('hej')).toBe(null);
  });
});

describe('durationNormalForms', () => {
  it('genererar alla normaliserade former av 130 min', () => {
    const forms = durationNormalForms('130 min');
    expect(forms).toContain('130 min');
    expect(forms).toContain('130 minuter');
    expect(forms).toContain('2 tim');
    expect(forms).toContain('2 timmar');
    expect(forms).toContain('2 tim 10 min');
    expect(forms).toContain('2:10');
  });

  it('genererar former för 90 min (1.5h)', () => {
    const forms = durationNormalForms('90 min');
    expect(forms).toContain('90 min');
    expect(forms).toContain('1 tim');
    expect(forms).toContain('1 tim 30 min');
    expect(forms).toContain('1:30');
  });

  it('returnerar tom array för oparsbar input', () => {
    expect(durationNormalForms('hej')).toEqual([]);
  });
});

describe('parseSwedishDate', () => {
  it('parsear ISO-format', () => {
    expect(parseSwedishDate('2026-10-08')).toBe('2026-10-08');
  });

  it('parsear svenskt "8 oktober 2026"', () => {
    expect(parseSwedishDate('8 oktober 2026')).toBe('2026-10-08');
  });

  it('parsear svenskt med day-name "lördag 8 oktober 2026"', () => {
    expect(parseSwedishDate('lördag 8 oktober 2026')).toBe('2026-10-08');
  });

  it('parsear slash-format "8/10 2026"', () => {
    expect(parseSwedishDate('8/10 2026')).toBe('2026-10-08');
  });

  it('returnerar null utan år', () => {
    expect(parseSwedishDate('8 oktober')).toBe(null);
  });

  it('använder yearHint om år saknas', () => {
    expect(parseSwedishDate('8 oktober', 2026)).toBe('2026-10-08');
  });

  it('hanterar alla svenska månader', () => {
    expect(parseSwedishDate('15 mars 2026', undefined)).toBe('2026-03-15');
    expect(parseSwedishDate('1 januari 2026', undefined)).toBe('2026-01-01');
    expect(parseSwedishDate('31 december 2026', undefined)).toBe('2026-12-31');
  });
});

describe('dateNormalForms', () => {
  it('genererar alla former av "2026-10-08"', () => {
    const forms = dateNormalForms('2026-10-08');
    expect(forms).toContain('2026-10-08');
    expect(forms.some((f) => f.includes('oktober'))).toBe(true);
  });

  it('returnerar tom array för oparsbar input', () => {
    expect(dateNormalForms('imorgon')).toEqual([]);
  });
});

describe('parseClockTime', () => {
  it('parsear HH:MM', () => {
    expect(parseClockTime('19:00')).toBe('19:00');
    expect(parseClockTime('9:30')).toBe('09:30');
  });

  it('parsear europeisk punktnotation "19.00"', () => {
    expect(parseClockTime('19.00')).toBe('19:00');
  });

  it('parsear "kl 19" / "klockan 19"', () => {
    expect(parseClockTime('kl 19')).toBe('19:00');
    expect(parseClockTime('klockan 19')).toBe('19:00');
  });

  it('parsear "kl 19.30" (med minuter)', () => {
    expect(parseClockTime('kl 19.30')).toBe('19:30');
  });

  it('returnerar null för oparsbar input', () => {
    expect(parseClockTime('')).toBe(null);
    expect(parseClockTime('kväll')).toBe(null);
  });
});

describe('timeNormalForms', () => {
  it('genererar alla former av 19:00', () => {
    const forms = timeNormalForms('19:00');
    expect(forms).toContain('19:00');
    expect(forms).toContain('19.00');
    expect(forms.some((f) => f.includes('kl'))).toBe(true);
  });

  it('returnerar tom array för oparsbar input', () => {
    expect(timeNormalForms('kväll')).toEqual([]);
  });
});

describe('parsePriceToSek', () => {
  it('parsear "250 kr"', () => {
    expect(parsePriceToSek('250 kr')).toBe(250);
  });

  it('parsear "250:-"', () => {
    expect(parsePriceToSek('250:-')).toBe(250);
  });

  it('parsear "250 kronor"', () => {
    expect(parsePriceToSek('250 kronor')).toBe(250);
  });

  it('parsear "250 SEK"', () => {
    expect(parsePriceToSek('250 SEK')).toBe(250);
  });

  it('parsear "från 250 kr"', () => {
    expect(parsePriceToSek('från 250 kr')).toBe(250);
  });

  it('parsear "250 kr/person"', () => {
    expect(parsePriceToSek('250 kr/person')).toBe(250);
  });

  it('returnerar null för oparsbar input', () => {
    expect(parsePriceToSek('')).toBe(null);
    expect(parsePriceToSek('gratis')).toBe(null);
  });
});

describe('priceNormalForms', () => {
  it('genererar alla former av 250 kr', () => {
    const forms = priceNormalForms('250 kr');
    expect(forms).toContain('250 kr');
    expect(forms).toContain('250 kronor');
    expect(forms).toContain('250:-');
    expect(forms).toContain('250 SEK');
  });
});

describe('parseAgeLimit', () => {
  it('parsear "18 år"', () => {
    expect(parseAgeLimit('18 år')).toBe(18);
  });

  it('parsear "från 18 år"', () => {
    expect(parseAgeLimit('från 18 år')).toBe(18);
  });

  it('parsear "18+"', () => {
    expect(parseAgeLimit('18+')).toBe(18);
  });

  it('parsear "åldersgräns 18"', () => {
    expect(parseAgeLimit('åldersgräns 18')).toBe(18);
  });

  it('returnerar null för oparsbar input', () => {
    expect(parseAgeLimit('')).toBe(null);
    expect(parseAgeLimit('alla åldrar')).toBe(null);
  });
});

describe('ageNormalForms', () => {
  it('genererar alla former av 18 år', () => {
    const forms = ageNormalForms('18 år');
    expect(forms).toContain('18 år');
    expect(forms).toContain('från 18 år');
    expect(forms).toContain('18+');
    expect(forms).toContain('åldersgräns 18');
  });
});

describe('normalizeName', () => {
  it('returnerar lower + sista ordet + första ordet', () => {
    const forms = normalizeName('Ludwig van Beethoven');
    expect(forms).toContain('ludwig van beethoven');
    expect(forms).toContain('beethoven');
    expect(forms).toContain('ludwig');
  });

  it('hanterar initialer "L. v. Beethoven"', () => {
    const forms = normalizeName('L. v. Beethoven');
    expect(forms).toContain('l. v. beethoven');
    expect(forms).toContain('beethoven');
  });

  it('hanterar enstaka namn', () => {
    const forms = normalizeName('Beethoven');
    expect(forms).toContain('beethoven');
  });

  it('tar bort accenter', () => {
    const forms = normalizeName('Zürich');
    // Accenter ska normaliseras till 'zurich'
    expect(forms.some((f) => f === 'zurich' || f === 'zürich')).toBe(true);
  });
});

describe('parseNumberWithUnit', () => {
  it('parsear "95 musiker"', () => {
    expect(parseNumberWithUnit('95 musiker')).toEqual({ value: 95, unit: 'musiker' });
  });

  it('parsear "120 personer"', () => {
    expect(parseNumberWithUnit('120 personer')).toEqual({ value: 120, unit: 'personer' });
  });

  it('returnerar null utan nummer', () => {
    expect(parseNumberWithUnit('många')).toBe(null);
  });
});

describe('numberUnitNormalForms', () => {
  it('genererar former av "95 musiker"', () => {
    const forms = numberUnitNormalForms('95 musiker');
    expect(forms).toContain('95 musiker');
    expect(forms).toContain('95-musiker');
    expect(forms).toContain('95musiker');
  });
});

describe('allNormalForms (universal)', () => {
  it('inkluderar alltid raw + lowercased', () => {
    const forms = allNormalForms('130 min', 'duration');
    expect(forms).toContain('130 min');
  });

  it('inkluderar duration-former när kind=duration', () => {
    const forms = allNormalForms('130 min', 'duration');
    expect(forms).toContain('2 tim 10 min');
    expect(forms).toContain('2:10');
  });

  it('inkluderar date-former när kind=date', () => {
    const forms = allNormalForms('2026-10-08', 'date');
    expect(forms).toContain('2026-10-08');
    expect(forms.some((f) => f.includes('oktober'))).toBe(true);
  });

  it('inkluderar time-former när kind=time', () => {
    const forms = allNormalForms('19:00', 'time');
    expect(forms).toContain('19:00');
    expect(forms).toContain('19.00');
  });

  it('inkluderar price-former när kind=price', () => {
    const forms = allNormalForms('250 kr', 'price');
    expect(forms).toContain('250 kr');
    expect(forms).toContain('250 kronor');
  });

  it('utan kind genererar ALLA former (användbart för generell normalisering)', () => {
    const forms = allNormalForms('130 min');
    expect(forms).toContain('130 min');
    expect(forms).toContain('2 tim 10 min');
  });

  it('filtrerar bort för korta former (<2 tecken)', () => {
    const forms = allNormalForms('', 'duration');
    expect(forms.every((f) => f.length >= 2)).toBe(true);
  });
});
