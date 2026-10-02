/**
 * dateRange (2026-10-02): rena datum-hjälpare för Utforska sök.
 *
 * Extraherade från DateRangePicker-komponenten så de kan enhetstestas
 * utan att dra in react-native-calendars (vilket i sin tur kräver
 * native-moduler och kraschar vitest).
 *
 * `quickRange(key, today)` används av DateRangePicker för "Snabbval"-
 * chipsen (Idag / Imorgon / Helg / 7 dagar / 30 dagar / Alla) och
 * producerar `{ from, to }` som ISO YYYY-MM-DD relativt till `today`.
 */

const FRI = 5;
const SAT = 6;
const SUN = 0;

/** date (lokal tid) → YYYY-MM-DD. Undviker toISOString() som kan ge
 *  UTC-skift och flytta datumet en dag i vissa tidszoner. */
export function isoOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Nästa framtida veckodag (targetDow 0..6). targetDow === today → idag. */
export function nextWeekday(today, targetDow) {
  const diff = (targetDow - today.getDay() + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Snabbval-mappning. Returnerar alltid { from, to }; null-värden betyder
 * "inget intervall" (= "alla framtida events" i SearchScreen).
 *
 * @param {string} key   'today' | 'tomorrow' | 'weekend' | '7days' | '30days' | 'all'
 * @param {Date}   today referensdag (default new Date())
 * @returns {{ from: string|null, to: string|null }}
 */
export function quickRange(key, today = new Date()) {
  switch (key) {
    case 'today':
      return { from: isoOf(today), to: isoOf(today) };
    case 'tomorrow': {
      const d = new Date(today);
      d.setDate(d.getDate() + 1);
      return { from: isoOf(d), to: isoOf(d) };
    }
    case 'weekend': {
      // Helg = fre–sön (användarens val 2026-09-27 / 2026-10-02).
      // Speciallogik: om idag redan är fre/lör/sön vill vi visa
      // INNEVARANDE helg (fre = idag, lör = imorgon, sön = idag - 2).
      // Annars (mån–tor) vill vi visa NÄSTA helg (fre = +diff dagar).
      const dow = today.getDay();
      let fri;
      if (dow === FRI) {
        fri = new Date(today);
      } else if (dow === SAT) {
        fri = new Date(today);
        fri.setDate(fri.getDate() - 1);
      } else if (dow === SUN) {
        fri = new Date(today);
        fri.setDate(fri.getDate() - 2);
      } else {
        // Mon–Thu → next Friday
        const daysToFri = FRI - dow;
        fri = new Date(today);
        fri.setDate(fri.getDate() + daysToFri);
      }
      const sun = new Date(fri);
      sun.setDate(sun.getDate() + 2);
      return { from: isoOf(fri), to: isoOf(sun) };
    }
    case '7days': {
      const to = new Date(today);
      to.setDate(to.getDate() + 6);
      return { from: isoOf(today), to: isoOf(to) };
    }
    case '30days': {
      const to = new Date(today);
      to.setDate(to.getDate() + 29);
      return { from: isoOf(today), to: isoOf(to) };
    }
    case 'all':
    default:
      return { from: null, to: null };
  }
}

export const QUICK_RANGE_KEYS = [
  'today', 'tomorrow', 'weekend', '7days', '30days', 'all',
];
