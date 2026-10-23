/**
 * Vilket läge ska drainen köra i?
 *
 * `--status` är READ-ONLY: det skriver ködjup och avslutar. Det får ALDRIG
 * fortsätta in i dräneringen — mätt 2026-10-23: en muterad variant av
 * drainQueue.ts (utan `process.exit(0)` i status-grenen) föll rakt in i
 * dräneringen, skapade en normalizer-worker på den riktiga kön och pickade
 * upp 26 väntande jobb. Eftersom Redis-sockarna redan var stängda i samma
 * process dog de med "Connection is closed." — trots att deras events var
 * persisterade i databasen.
 *
 * Modulen är avsiktligt fri från beroenden (ingen Redis, ingen dotenv) så
 * att regeln kan testas utan att starta något som kör mot produktion.
 */

export type DrainMode = 'status' | 'drain';

export function resolveDrainMode(argv: string[]): DrainMode {
  return argv.includes('--status') ? 'status' : 'drain';
}
