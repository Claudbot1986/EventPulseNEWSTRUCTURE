/**
 * workerConcurrency — hur många events som normaliseras parallellt.
 *
 * Varje jobb i `raw_events` gör två LLM-anrop (editorial-pipelinens
 * faktualitets- och oberoendekontroll), så jobbtiden domineras av väntan på
 * modellen — inte av CPU eller databas. Fler workers betyder mer parallell
 * LLM-trafik, men samma totala antal anrop.
 *
 * Mätt 2026-10-24 på riktig kö (scripts/measure-drain-concurrency.mjs):
 *
 *   c=5  → 45,5 jobb/min  (91 jobb på 120 s, 0 fel)
 *   c=10 → 88,5 jobb/min  (177 jobb på 120 s, 0 fel)
 *   c=10 → 91,5 jobb/min  (183 jobb på 120 s, 0 fel)
 *   c=20 → 382   jobb/min  (764 jobb på 120 s, 0 fel)
 *   c=20 → 321,6 jobb/min (536 jobb på 100 s, 0 fel)
 *
 * Nattens import köade in 5 304 jobb, men drainens budget är 90 min. Med
 * c=5 hanns 3 483 jobb (38,7/min) — kön växte med ~1 800 jobb varje natt,
 * och nattens extraherade events syntes inte i databasen förrän flera
 * nätter senare. c=10 ger 1,5× marginal mot nattens volym, c=20 ger 5,5×.
 *
 * Skalningen är superlinjär (c=5→10 dubblar, c=10→20 fyrdubblar). Det
 * passar med att jobbtiden domineras av modelllatens och att fler samtidiga
 * anrop ger bättre utnyttja av modellservern. Inga misslyckanden observerades
 * vid något värde.
 *
 * Modulen är beroendefri (som drainMode.ts) så att regeln kan testas utan
 * Redis och utan att en enda worker startas.
 */

/** Standardvärdet. Oförändrat tills mätning visar att något annat bär. */
export const DEFAULT_WORKER_CONCURRENCY = 5;

/** Minsta tillåtna värde — en worker som inte gör något är meningslös. */
export const MIN_WORKER_CONCURRENCY = 1;

/**
 * Tolka ett concurrency-värde.
 *
 * Returnerar heltalet, eller `null` om värdet inte går att använda. Kaller
 * bestämmer då själv vad som händer (fallback eller fel) — modellen
 * gissar inte tyst.
 *
 * @param raw rått värde från CLI-flagga eller miljövariabel
 */
export function resolveWorkerConcurrency(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;

  const floored = Math.floor(parsed);
  if (floored < MIN_WORKER_CONCURRENCY) return null;

  return floored;
}
