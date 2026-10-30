/**
 * Script Scan — icke-latina skript i användartext.
 *
 * Syfte: hitta tecken som INTE hör hemma i det språk appen visar just nu
 * (t.ex. kinesiska han-tecken i ett svenskt eventkort), utan att förstöra
 * legitimt innehåll. En rysk teaterföreställning eller en kinesisk bokcirkel
 * är inte ett fel — men den ska visas på det språk användaren läser.
 *
 * Designprinciper:
 *   1. RENA funktioner, inga I/O, inga beroenden — samma modul används av
 *      DB-skriptet, UI-skyddet och verifieringsdrivern.
 *   2. Skript-medvetenhet: "har kinesiska tecken" är inte samma sak som
 *      "är fel". Funktionerna nedan svarar på "vilka skript förekommer" och
 *      "vilka av dem passar språket som visas".
 *   3. Punktuation (CJK-tecken, fullbredd) räknas INTE som eget skript —
 *      de tillhör texten runorna de står i, annars skulle "Kinesisk bokcirkel
 *      中文读书会。" splittas i två främmande delar.
 *
 * @typedef {'han'|'kana'|'hangul'|'cyrillic'|'greek'|'arabic'|'hebrew'|'devanagari'|'thai'|'bengali'|'tamil'|'telugu'|'kannada'|'malayalam'|'gujarati'|'gurmukhi'|'sinhala'|'tibetan'|'myanmar'|'khmer'|'lao'|'georgian'|'armenian'} ScriptId
 */

/**
 * Starka skript — varje tecken tillhör högst ett. Ordningen är viktig:
 * Han-tecken (U+4E00) ligger utanför Hangul/CJK-punctuation, men CJK-
 * punctuation (U+3000–U+303F) kan INTE matcha Han eftersom dess intervall
 * slutar på U+9FFF. Vi kör ändå starka skript först och lämnar
 * punctuation som sista fallback.
 */
const STRONG_SCRIPTS = [
  { id: 'han', label: 'Kinesiska (han)', range: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/ },
  { id: 'kana', label: 'Japanska (kana)', range: /[\u3040-\u30FF\u31F0-\u31FF]/ },
  { id: 'hangul', label: 'Koreanska (hangul)', range: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/ },
  { id: 'cyrillic', label: 'Cyrilliska', range: /[\u0400-\u04FF\u0500-\u052F]/ },
  { id: 'greek', label: 'Grekiska', range: /[\u0370-\u03FF\u1F00-\u1FFF]/ },
  { id: 'arabic', label: 'Arabiska', range: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/ },
  { id: 'hebrew', label: 'Hebreiska', range: /[\u0590-\u05FF\uFB1D-\uFB4F]/ },
  { id: 'devanagari', label: 'Devanagari', range: /[\u0900-\u097F]/ },
  { id: 'bengali', label: 'Bengali', range: /[\u0980-\u09FF]/ },
  { id: 'gurmukhi', label: 'Gurmukhi', range: /[\u0A00-\u0A7F]/ },
  { id: 'gujarati', label: 'Gujarati', range: /[\u0A80-\u0AFF]/ },
  { id: 'tamil', label: 'Tamil', range: /[\u0B80-\u0BFF]/ },
  { id: 'telugu', label: 'Telugu', range: /[\u0C00-\u0C7F]/ },
  { id: 'kannada', label: 'Kannada', range: /[\u0C80-\u0CFF]/ },
  { id: 'malayalam', label: 'Malayalam', range: /[\u0D00-\u0D7F]/ },
  { id: 'sinhala', label: 'Sinhala', range: /[\u0D80-\u0DFF]/ },
  { id: 'thai', label: 'Thailändska', range: /[\u0E00-\u0E7F]/ },
  { id: 'lao', label: 'Lao', range: /[\u0E80-\u0EFF]/ },
  { id: 'tibetan', label: 'Tibetanska', range: /[\u0F00-\u0FFF]/ },
  { id: 'myanmar', label: 'Burmesiska', range: /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/ },
  { id: 'khmer', label: 'Kambodja', range: /[\u1780-\u17FF\u19E0-\u19FF]/ },
  { id: 'georgian', label: 'Georgiska', range: /[\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]/ },
  { id: 'armenian', label: 'Armeniska', range: /[\u0530-\u058F]/ },
];

/** Punctuation som hör till CJK-text — tillhör en runa, aldrig ett eget skript. */
const CJK_PUNCTUATION = /[\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]/;

/**
 * Dekorativa tecken som används som ren ornamentik (t.ex. "༻" före en
 * Eventbrite-titel). De är INTE språk — de tillhör texten de står i och
 * räknas därför som punctuation, inte som ett främmande skript.
 */
const DECORATIVE_MARKS = /[\u0F3B-\u0F3F\u2766-\u2767\uFE50-\uFE52\uFE54-\uFE5E\uFF3B-\uFF3C\uFF3F\u2042]/;

/** Skript som appen använder eller rimligen kan visa. */
const LATIN_SCRIPT_LANGUAGES = new Set([
  'sv', 'en', 'de', 'no', 'fi', 'da', 'nl', 'fr', 'it', 'pl', 'tr', 'so',
]);

/**
 * Språk → tillåtna skript. En app som visar arabiska FÅR visa arabiska
 * tecken — det är inte ett fel. Språk som inte finns här behandlas som
 * latinbaserade (konservativt: vi rapporterar hellre för mycket än
 * godkänner främmande skript).
 */
export const LANGUAGE_SCRIPTS = {
  sv: ['latin'], en: ['latin'], de: ['latin'], no: ['latin'], fi: ['latin'],
  da: ['latin'], nl: ['latin'], fr: ['latin'], it: ['latin'], pl: ['latin'],
  tr: ['latin'], so: ['latin'],
  'zh-Hans': ['han', 'latin'],
  ar: ['arabic', 'latin'],
  fa: ['arabic', 'latin'],
};

/** Skript som användaren specifikt frågade efter (kinesiska + asiatiska). */
export const ASIAN_SCRIPT_IDS = Object.freeze([
  'han', 'kana', 'hangul',
  'devanagari', 'bengali', 'gurmukhi', 'gujarati', 'tamil', 'telugu',
  'kannada', 'malayalam', 'sinhala', 'thai', 'lao', 'tibetan', 'myanmar',
  'khmer', 'georgian', 'armenian',
]);

/**
 * Skript → skriptgrupp (för rapportering: "asiatiska" vs "övriga").
 * @type {Record<ScriptId, 'cjk'|'asian'|'other'>}
 */
export const SCRIPT_GROUP = Object.freeze({
  han: 'cjk', kana: 'cjk', hangul: 'cjk',
  devanagari: 'asian', bengali: 'asian', gurmukhi: 'asian', gujarati: 'asian',
  tamil: 'asian', telugu: 'asian', kannada: 'asian', malayalam: 'asian',
  sinhala: 'asian', thai: 'asian', lao: 'asian', tibetan: 'asian',
  myanmar: 'asian', khmer: 'asian', georgian: 'asian', armenian: 'asian',
  cyrillic: 'other', greek: 'other', arabic: 'other', hebrew: 'other',
});

const SCRIPT_LABEL = Object.fromEntries(STRONG_SCRIPTS.map((s) => [s.id, s.label]));

/**
 * Vilket skript tillhör ett tecken? 'latin' för västliga, 'punct' för
 * CJK-punctuation, null för tecken utan skript (siffror, emoji, mellanslag).
 *
 * @param {string} char
 * @returns {ScriptId|'latin'|'punct'|null}
 */
export function scriptOfChar(char) {
  if (!char) return null;
  if (CJK_PUNCTUATION.test(char)) return 'punct';
  if (DECORATIVE_MARKS.test(char)) return 'punct';
  for (const script of STRONG_SCRIPTS) {
    if (script.range.test(char)) return script.id;
  }
  // Latin räknas som "latin" om det är ett bokstavtecken. Siffror,
  // interpunktion och emoji har inget skript och returnerar null.
  if (/[A-Za-zÀ-ÿĀ-ſƀ-ɏ]/.test(char)) return 'latin';
  return null;
}

/**
 * Tillåtna skript-id:n för ett språk.
 * @param {string} language
 * @returns {ScriptId[]}
 */
export function allowedScriptIds(language) {
  // 'latin' är alltid tillåtet (och hanteras som "aldrig främmande" i
  // findForeignScriptRuns). Övriga grupper är de skript som FÅR förekomma.
  const groups = (LANGUAGE_SCRIPTS[language] || ['latin']).filter((g) => g !== 'latin');
  return groups;
}

/**
 * Finns något skript i texten som INTE passar språket som visas?
 *
 * @param {string} text
 * @param {string} language
 * @returns {boolean}
 */
export function isCompatibleWithLanguage(text, language) {
  return findForeignScriptRuns(text, language).length === 0;
}

/**
 * Hitta de delar av texten som är skrivna i ett skript som inte hör hemma
 * i språket som visas. CJK-punctuation räknas som en del av en främmande
 * runa (aldrig en egen runa).
 *
 * @param {string} text
 * @param {string} language
 * @returns {Array<{ text: string, scriptIds: ScriptId[], start: number, end: number }>}
 */
export function findForeignScriptRuns(text, language) {
  if (typeof text !== 'string' || !text) return [];
  const allowed = new Set(allowedScriptIds(language));
  const chars = Array.from(text);
  const scripts = chars.map((char) => scriptOfChar(char));
  const foreignAt = scripts.map((script) => (
    script && script !== 'latin' && script !== 'punct' && !allowed.has(script) ? script : null
  ));

  const runs = [];
  let i = 0;
  while (i < chars.length) {
    if (!foreignAt[i]) {
      i += 1;
      continue;
    }

    const script = foreignAt[i];
    const scriptIds = new Set([script]);
    const start = i;
    let end = i;
    let j = i + 1;

    while (j < chars.length) {
      if (foreignAt[j]) {
        // Nytt skript → en ny främmande runa (t.ex. koreanska följt av kinesiska).
        if (foreignAt[j] !== script) break;
        end = j;
        scriptIds.add(foreignAt[j]);
        j += 1;
        continue;
      }
      // CJK-punctuation tillhör den främmande texten den står i.
      if (scripts[j] === 'punct') {
        end = j;
        j += 1;
        continue;
      }
      // Mellanslag tillhör frasen OM nästa tecken är samma skript — annars
      // slutar frasen här ("왕의 정원" är en fras, "ПАПА МИЯ! и" är två).
      if (isWhitespace(chars[j])) {
        let k = j;
        while (k < chars.length && isWhitespace(chars[k])) k += 1;
        if (k < chars.length && foreignAt[k] === script) {
          end = k - 1;
          j = k;
          continue;
        }
      }
      break;
    }

    runs.push({
      text: chars.slice(start, end + 1).join(''),
      scriptIds: Array.from(scriptIds),
      start,
      end,
    });
    i = j;
  }

  return runs;
}

function isWhitespace(char) {
  return typeof char === 'string' && /\s/.test(char);
}

/**
 * Sammanfattning av en texts skript.
 *
 * @param {string} text
 * @param {string} [language]
 * @returns {{ scripts: Array<{ id: ScriptId, label: string, group: string, count: number, sample: string }>, foreign: Array<{ text: string, scriptIds: ScriptId[] }>, compatible: boolean }}
 */
export function summarizeText(text, language) {
  const counts = new Map();
  if (typeof text === 'string' && text) {
    for (const char of Array.from(text)) {
      const script = scriptOfChar(char);
      if (!script || script === 'latin' || script === 'punct') continue;
      const entry = counts.get(script) || { id: script, label: SCRIPT_LABEL[script], group: SCRIPT_GROUP[script], count: 0, sample: '' };
      entry.count += 1;
      if (!entry.sample) entry.sample = char;
      counts.set(script, entry);
    }
  }

  const scripts = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  const foreign = language ? findForeignScriptRuns(text, language) : [];

  return {
    scripts,
    foreign,
    compatible: language ? foreign.length === 0 : true,
  };
}

/**
 * Ta bort de främmande runorna. Används som SISTA utväg vid rendering —
 * bättre en titel utan den kinesiska delen än en titel som blandar skript.
 *
 * @param {string} text
 * @param {string} language
 * @returns {string}
 */
export function stripForeignScriptRuns(text, language) {
  const runs = findForeignScriptRuns(text, language);
  if (runs.length === 0) return text;
  const chars = Array.from(text);
  const drop = new Set();
  for (const run of runs) {
    for (let i = run.start; i <= run.end; i += 1) drop.add(i);
  }
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    if (!drop.has(i)) out += chars[i];
  }
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:!?\-–—]+/, '')
    .trim();
}

/**
 * Har texten asiatiska/kinesiska tecken? (den fråga användaren ställde)
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasAsianCharacters(text) {
  if (typeof text !== 'string' || !text) return false;
  for (const char of Array.from(text)) {
    const script = scriptOfChar(char);
    if (script && script !== 'latin' && script !== 'punct' && ASIAN_SCRIPT_IDS.includes(script)) {
      return true;
    }
  }
  return false;
}

/**
 * Räkna asiatiska/kinesiska tecken i en text.
 *
 * @param {string} text
 * @returns {number}
 */
export function countAsianCharacters(text) {
  if (typeof text !== 'string' || !text) return 0;
  let count = 0;
  for (const char of Array.from(text)) {
    const script = scriptOfChar(char);
    if (script && script !== 'latin' && script !== 'punct' && ASIAN_SCRIPT_IDS.includes(script)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Språkkoder som appen stödjer — speglar 06-UI/i18n/languages.js.
 * Hålls här som data så att DB-skriptet kan veta vilka språk det är
 * rimligt att översätta till.
 */
export const SUPPORTED_LANGUAGES = Object.freeze([
  'sv', 'en', 'de', 'no', 'fi', 'da', 'nl', 'fr', 'zh-Hans', 'it', 'ar', 'fa', 'so', 'pl', 'tr',
]);

/**
 * Språk vars skript INTE är latin — för dessa är icke-latina tecken
 * naturliga och ska därför aldrig rapporteras som "främmande".
 */
export function isNonLatinLanguage(language) {
  return (LANGUAGE_SCRIPTS[language] || ['latin']).some((g) => g !== 'latin');
}
