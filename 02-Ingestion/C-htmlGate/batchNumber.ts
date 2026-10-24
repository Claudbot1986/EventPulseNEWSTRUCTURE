/**
 * Batch-nummerering för C-htmlGate.
 *
 * 2026-10-24 — den här logiken låg inline i run-batch-from-sources.ts och
 * var trasig: `.test(d)?.[1]` ger alltid undefined (test() returnerar
 * boolean, inte en match-array), så max blev 0 och varje operatörskörning
 * fick batch-nummer 1. Följden: körning två och tre resume:ade batch-1:s
 * pool-state, körde ingen enda källa och rapporterade den första
 * körningens siffror ("exited 3", fel källa).
 *
 * Två saker ska gälla:
 *   1. numret är högre än alla batch-kataloger som finns, och
 *   2. det är inte ett nummer som redan har en pool-state — ett sådant
 *      nummer resume:ar den gamla körningen i stället för att köra om.
 */
import { existsSync, readdirSync } from 'fs';
import path from 'path';

export function nextBatchNumber(reportsDir: string): number {
  if (!existsSync(reportsDir)) return 1;
  const used = readdirSync(reportsDir)
    .map(d => /^batch-(\d+)$/.exec(d)?.[1])
    .filter((n): n is string => !!n)
    .map(Number);
  const max = used.reduce((a, b) => Math.max(a, b), 0);
  let candidate = max + 1;
  while (
    used.includes(candidate) &&
    existsSync(path.join(reportsDir, `batch-${candidate}`, 'pool-state.json'))
  ) {
    candidate++;
  }
  return candidate;
}
