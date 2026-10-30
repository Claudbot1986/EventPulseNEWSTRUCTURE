/**
 * Tester för scriptScan — den delade skript-detektorn.
 *
 * Fokus: skilja på "detta är främmande skript för det språk som visas" och
 * "detta är legitimt innehåll". En kinesisk bokcirkel ska inte rapporteras
 * som fel i en kinesisk app — och inte heller raderas bort i en svensk app.
 */

import { describe, it, expect } from 'vitest';
import {
  findForeignScriptRuns,
  summarizeText,
  stripForeignScriptRuns,
  isCompatibleWithLanguage,
  hasAsianCharacters,
  countAsianCharacters,
  scriptOfChar,
} from './scriptScan.js';

describe('scriptOfChar', () => {
  it('känner igen han, kana och hangul', () => {
    expect(scriptOfChar('中')).toBe('han');
    expect(scriptOfChar('の')).toBe('kana');
    expect(scriptOfChar('왕')).toBe('hangul');
  });

  it('känner igen cyrilliska och arabiska', () => {
    expect(scriptOfChar('П')).toBe('cyrillic');
    expect(scriptOfChar('ک')).toBe('arabic');
  });

  it('känner igen latin och CJK-punctuation', () => {
    expect(scriptOfChar('A')).toBe('latin');
    expect(scriptOfChar('å')).toBe('latin');
    expect(scriptOfChar('、')).toBe('punct');
    expect(scriptOfChar('，')).toBe('punct');
  });

  it('räknar dekorativa tecken som punctuation, inte som skript', () => {
    expect(scriptOfChar('༻')).toBe('punct');
    expect(scriptOfChar('❦')).toBe('punct');
  });

  it('returnerar null för tecken utan skript', () => {
    expect(scriptOfChar('5')).toBeNull();
    expect(scriptOfChar(' ')).toBeNull();
  });
});

describe('findForeignScriptRuns', () => {
  it('hittar den kinesiska delen i en svensk titel', () => {
    const runs = findForeignScriptRuns('Kinesisk bokcirkel 中文读书会', 'sv');
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('中文读书会');
    expect(runs[0].scriptIds).toEqual(['han']);
  });

  it('hittar koreanska i ett svenskt fält', () => {
    const runs = findForeignScriptRuns('Evenemang på 왕의 정원 i Stockholm', 'sv');
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('왕의 정원');
    expect(runs[0].scriptIds).toEqual(['hangul']);
  });

  it('foldar CJK-punctuation in i den främmande runan', () => {
    const runs = findForeignScriptRuns('中文读书会。', 'sv');
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('中文读书会。');
  });

  it('räknar INTE kinesiska tecken som främmande i en kinesisk app', () => {
    const runs = findForeignScriptRuns('Kinesisk bokcirkel 中文读书会', 'zh-Hans');
    expect(runs).toHaveLength(0);
  });

  it('räknar INTE arabiska tecken som främmande i en arabisk app', () => {
    const runs = findForeignScriptRuns('کلوپ شعر و موسیقی', 'ar');
    expect(runs).toHaveLength(0);
  });

  it('räknar kinesiska tecken som främmande i en arabisk app', () => {
    const runs = findForeignScriptRuns('حفل 中文读书会', 'ar');
    expect(runs).toHaveLength(1);
    expect(runs[0].scriptIds).toEqual(['han']);
  });

  it('hittar inget i ren svensk text', () => {
    expect(findForeignScriptRuns('Konsert med ABBA på Avicii Arena', 'sv')).toHaveLength(0);
  });

  it('hittar flera runor i samma text', () => {
    const runs = findForeignScriptRuns('ПАПА МИЯ и 中文读书会', 'sv');
    expect(runs).toHaveLength(2);
    expect(runs[0].scriptIds).toEqual(['cyrillic']);
    expect(runs[1].scriptIds).toEqual(['han']);
  });
});

describe('isCompatibleWithLanguage', () => {
  it('sant för ren svensk text', () => {
    expect(isCompatibleWithLanguage('Konsert på Kungsträdgården', 'sv')).toBe(true);
  });

  it('falskt när kinesiska tecken finns i svensk text', () => {
    expect(isCompatibleWithLanguage('Kinesisk bokcirkel 中文读书会', 'sv')).toBe(false);
  });
});

describe('summarizeText', () => {
  it('sammanfattar skript med antal och grupp', () => {
    const result = summarizeText('Kinesisk bokcirkel 中文读书会', 'sv');
    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0].id).toBe('han');
    expect(result.scripts[0].group).toBe('cjk');
    expect(result.scripts[0].count).toBe(5);
    expect(result.compatible).toBe(false);
  });

  it('grupperar thai som asiatiskt och arabiska som övrigt', () => {
    expect(summarizeText('งานเลี้ยง', 'sv').scripts[0].group).toBe('asian');
    expect(summarizeText('کلوپ شعر', 'sv').scripts[0].group).toBe('other');
  });
});

describe('stripForeignScriptRuns', () => {
  it('tar bort den främmande delen och städar mellanrum', () => {
    expect(stripForeignScriptRuns('Kinesisk bokcirkel 中文读书会', 'sv')).toBe('Kinesisk bokcirkel');
  });

  it('tar bort koreanska mellanrumsruna', () => {
    expect(stripForeignScriptRuns('Evenemang på 왕의 정원 i Stockholm', 'sv')).toBe('Evenemang på i Stockholm');
  });

  it('lämnar oförändrad text som redan är ren', () => {
    expect(stripForeignScriptRuns('Konsert på Kungsträdgården', 'sv')).toBe('Konsert på Kungsträdgården');
  });
});

describe('hasAsianCharacters / countAsianCharacters', () => {
  it('hittar kinesiska och koreanska', () => {
    expect(hasAsianCharacters('中文读书会')).toBe(true);
    expect(hasAsianCharacters('왕의 정원')).toBe(true);
    expect(countAsianCharacters('왕의 정원')).toBe(4);
  });

  it('räknar INTE cyrilliska eller arabiska som asiatiska', () => {
    expect(hasAsianCharacters('ПАПА МИЯ!')).toBe(false);
    expect(hasAsianCharacters('کلوپ شعر')).toBe(false);
  });

  it('räknar INTE vanlig svensk text', () => {
    expect(hasAsianCharacters('PÅ för hela sh*t i Kungsträdgården')).toBe(false);
    expect(countAsianCharacters('PÅ för hela sh*t')).toBe(0);
  });

  it('räknar INTE dekorativa tecken som asiatiska', () => {
    expect(hasAsianCharacters('༻ Join our online Meditation Community!')).toBe(false);
    expect(findForeignScriptRuns('༻ Join our online Meditation Community!', 'sv')).toHaveLength(0);
  });
});
