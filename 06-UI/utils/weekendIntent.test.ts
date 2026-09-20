/**
 * Pins the weekend-intent matcher (utils/weekendIntent.js) — every chip or
 * prompt text that mentions the weekend, in any of the 10 app locales, must
 * be detected; non-weekend prompts must not.
 *
 * Run:  npx vitest run 06-UI/utils/weekendIntent.test.ts
 */

import { describe, it, expect } from 'vitest';

import { hasWeekendIntent } from './weekendIntent';

describe('hasWeekendIntent — matches real chips/prompts across locales', () => {
  const positives: Array<[string, string]> = [
    // [prompt text, locale it represents]
    ['Vad händer i helgen?', 'sv'],
    ['Gratis evenemang i Stockholm i helgen?', 'sv (curated chip)'],
    ['Utställningar i Stockholm öppna i helgen?', 'sv (curated chip)'],
    ['Familjevänliga evenemang i Stockholm i helgen?', 'sv (curated chip)'],
    ['Saker att göra i helg med barn', 'sv (indefinite)'],
    ['What is on this weekend?', 'en'],
    ['Free things to do in Stockholm this weekend?', 'en (curated chip)'],
    ['Was läuft am Wochenende in Stockholm?', 'de'],
    ['Hva skjer i helgen?', 'no'],
    ['Mitä tapahtuu tänä viikonloppuna?', 'fi'],
    ['Hvad sker der i weekenden?', 'da'],
    ['Wat is er dit weekend te doen?', 'nl'],
    ['Que faire ce week-end à Stockholm ?', 'fr'],
    ['这个周末有什么活动？', 'zh-Hans'],
    ['Cosa fare nel fine settimana a Stoccolma?', 'it'],
  ];

  for (const [text, locale] of positives) {
    it(`detects weekend intent (${locale}): "${text}"`, () => {
      expect(hasWeekendIntent(text)).toBe(true);
    });
  }
});

describe('hasWeekendIntent — rejects non-weekend prompts', () => {
  const negatives: string[] = [
    'Vad händer ikväll?',
    'Gratis museum i Stockholm?',
    'Konserter i morgon',
    'Live music tonight',
    'Teater denna vecka',
    'Jazz på fredag', // weekday friday ≠ weekend
  ];
  for (const text of negatives) {
    it(`does not flag: "${text}"`, () => {
      expect(hasWeekendIntent(text)).toBe(false);
    });
  }

  it('handles null / undefined / empty / non-string', () => {
    expect(hasWeekendIntent(null as unknown as string)).toBe(false);
    expect(hasWeekendIntent(undefined as unknown as string)).toBe(false);
    expect(hasWeekendIntent('')).toBe(false);
    expect(hasWeekendIntent(42 as unknown as string)).toBe(false);
  });
});
