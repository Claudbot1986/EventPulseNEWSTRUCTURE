/**
 * deliverExtracted — ta C-gatens extraherade events in i databasen.
 *
 * PROBLEMET (2026-10-24). C-gaten skriver sina events till
 * `03-Queue/03-extractedevents/C/<sourceId>.jsonl`. De når databasen via
 * `importToEventPulse.ts` (BullMQ) → `drainQueue.ts` (normalizer → Supabase).
 * De två stegen körs BARA i nattens cron-kedja.
 *
 * Följden: en operatör som kör C-gaten manuellt (vilket är exakt vad
 * `run-batch-from-sources.ts` gör) får events på disk men noll rader i
 * databasen. Under en hel dag 2026-10-24 extraherades 10 events för
 * historiska-museet, livrustkammaren och kammarencom — ingen av dem syntes i
 * Supabase förrän importen kördes manuellt. Uppgiften "kör ingestion så den
 * faktiskt ger events" var alltså obevisad av pipeline-svar på egen.
 *
 * VAD DETTA MODUL GÖR. Den bygger en leveransplan (import → drain) och
 * kör den. Importen körs FÖRE drainen, och en misslyckad import stoppar
 * kedjan — annars skulle drainen köra på en tom kö och lämna jobb
 * strandade i Redis.
 *
 * Varför inte bara anropa `importSource()` direkt? Den ligger i 03-Queue och
 * 03-Queue importerar redan 02-Ingestion (`lib/quarantineGuard`). Att låta
 * 02-Ingestion importera 03-Queue vore en cykel i modulnivå — därför körs
 * importen och drainen som barnprocesser, precis som cron gör.
 *
 * Användning:
 *   npx tsx 02-Ingestion/tools/deliverExtracted.ts --sources="a,b,c"
 */

import { existsSync, readdirSync } from 'fs';
import path from 'path';

/** Kör ett kommando och returnerar exit-koden. 0 = success. */
export type CommandRunner = (command: string, args: string[]) => Promise<number>;

export interface DeliveryOptions {
  /** Repo-roten där .env och 03-Queue ligger. */
  repoRoot: string;
  /** Hur länge drainen får köra (ms). */
  drainMs?: number;
  /** Antal parallella workers i drainen. */
  concurrency?: number;
}

export interface DeliveryPlan {
  /** Bara källor som faktiskt har en extraherad fil. */
  sourceIds: string[];
  importArgs: string[];
  drainArgs: string[];
}

export interface DeliveryResult {
  /** Sant om någon import faktiskt kördes. */
  imported: boolean;
  /** Sant om drainen kördes (och inte avbröts av importfel). */
  drained: boolean;
  importExitCode: number | null;
  drainExitCode: number | null;
}

const DEFAULT_DRAIN_MS = 600_000;
const DEFAULT_CONCURRENCY = 5;

/**
 * Finns det en extraherad fil för källan?
 *
 * Importen läser både `03-Queue/03-extractedevents/<id>.jsonl` (legacy) och
 * gate-underkataloger (`A/`, `B/`, `C/`, `D/`). Vi letar i båda.
 */
export function hasExtractedFile(repoRoot: string, sourceId: string): boolean {
  const base = path.join(repoRoot, '03-Queue', '03-extractedevents');
  if (existsSync(path.join(base, `${sourceId}.jsonl`))) return true;
  if (!existsSync(base)) return false;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(path.join(base, entry.name, `${sourceId}.jsonl`))) return true;
  }
  return false;
}

/**
 * Bygg leveransplanen. Källor utan extraherad fil utesluts — de har inget
 * att leverera, och att skicka dem till importen ger bara brus.
 */
export function planDelivery(sourceIds: string[], options: DeliveryOptions): DeliveryPlan {
  const present = sourceIds.filter((id) => hasExtractedFile(options.repoRoot, id));
  const drainMs = options.drainMs ?? DEFAULT_DRAIN_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  return {
    sourceIds: present,
    importArgs: present.length > 0 ? ['03-Queue/importToEventPulse.ts', '--source', present.join(',')] : [],
    drainArgs: ['03-Queue/drainQueue.ts', '--max-ms', String(drainMs), '--concurrency', String(concurrency)],
  };
}

/**
 * Kör planen: import först, sedan drain.
 *
 * Kedjan bryts vid importfel — drainen på en tom kö är meningslös, och
 * jobb som lämnas i Redis utan att dras är värre än inget jobb alls.
 */
export async function deliverExtractedToDatabase(
  plan: DeliveryPlan,
  run: CommandRunner,
  options: DeliveryOptions
): Promise<DeliveryResult> {
  if (plan.sourceIds.length === 0) {
    return { imported: false, drained: false, importExitCode: null, drainExitCode: null };
  }

  const importExitCode = await run('npx', ['tsx', ...plan.importArgs]);
  if (importExitCode !== 0) {
    return { imported: true, drained: false, importExitCode, drainExitCode: null };
  }

  const drainExitCode = await run('npx', ['tsx', ...plan.drainArgs]);
  return { imported: true, drained: true, importExitCode, drainExitCode };
}
