/**
 * bounded-text.mjs — läs stegets utdata utan att samla den i minnet.
 *
 * VARFÖR (2026-10-28). Kedjan buffrade barnprocessens stdout och stderr
 * hela i minnet för att kunna klassa felet och räkna events efteråt. Den 26
 * okt skrev importen 583 KB felrader — och kedjan höll alla i RAM. Inget
 * tog stopp för hur mycket ett steg kunde skriva.
 *
 * FÖRSTA LÖSNINGEN (och varför den inte räckte). En takad buffert som
 * behöll börden och slutet (32 KB + 32 KB) och släppte mitten. Mätt på en
 * verklig logg — `worker-drain-2026-10-28T06-07-38-030Z.err.log`, 1 213 321
 * byte — låg den enda transportmarkören ("fetch failed") på byte 119 988,
 * alltså i den kastade mitten. Kedjan klassade steget 'logic', avslutade
 * exit 0 och skrev "klar" — exakt det tysta fel kedjan finns för att döda.
 *
 * RÄTT LÖSNING. Trunkering får inte släppa bort signal. Texten läses
 * STRÖMMANDE, rad för rad, och bara det svaret behövs behålls:
 *
 *   - felklassen    → den värsta klassen över alla rader (net-error.mjs)
 *   - antalet events→ den sista matchningen i stdout (denna modul)
 *
 * Minnesanvändningen är O(1) oavsett hur mycket steget skriver, och ingen
 * rad försvinner. Raderna finns kvar på disk i
 * `runtime/ingestion-cron/steps/*.log` och `*.err.log` för den som vill
 * läsa hela loggen.
 */

/**
 * Strömmande "sista matchningen vinner" — O(1) minne, hela strömmen täckt.
 *
 * Varför (2026-10-28). `parseStepCounts` i scripts/ingestion-cron.ts läser
 * antalet ur stegets stdout med regeln "sista matchningen vinner" (den
 * sammanfattande raden skrivs efter per-källa-raderna). Om stdout lästes ur
 * en trunkerad buffert kunde den sista matchningen ligga i den kastade
 * mitten, och kedjan hade rapporterat ett ÄLDRE antal utan att säga till.
 *
 * @param {RegExp} recipe måste ha en fångstgrupp; m.flaggat (`m`) rekommenderas
 * @returns {{
 *   append: (text: string) => void,
 *   flush: () => void,
 *   readonly lastValue: string | null,
 * }}
 */
export function createLastMatchScanner(recipe) {
  // Klon utan `g`: ett globalt regex bär på lastIndex mellan exec-anrop,
  // vilket skulle ge växlande träffar beroende på hur många rader som lästs.
  const re = new RegExp(recipe.source, recipe.flags.replace(/g/g, ''));
  let partial = '';
  /** @type {string | null} */
  let lastValue = null;

  /** @param {string} line */
  function consider(line) {
    if (!line) return;
    const match = re.exec(line);
    if (match && match[1] !== undefined) lastValue = match[1];
  }

  return {
    append(text) {
      if (!text) return;
      const combined = partial + text;
      const parts = combined.split('\n');
      // Sista delen är inte en komplett rad ännu — den kan fortsätta i nästa
      // chunk. Utan detta skulle en träff som delas mellan två chunks gå
      // förlorad.
      partial = parts.pop() ?? '';
      for (const line of parts) consider(line);
    },

    flush() {
      if (!partial) return;
      consider(partial);
      partial = '';
    },

    get lastValue() {
      return lastValue;
    },
  };
}
