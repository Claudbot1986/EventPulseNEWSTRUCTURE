/**
 * gateEvalReport — formatter för per-gate eval-rapporter.
 *
 * Stream A.1 (Agent Trust Plan 2026-10-09) / Pstack-princip
 * #sequence-verifiable-units + #explain-the-number: varje gate-eval
 * ska kunna skriva en rapport där man direkt ser vad som mättes,
 * varför, och hur det gick.
 *
 * Vad detta löser:
 * Tidigare: post-ingest eval-hook (Stream A.2) loggade en kort summary-rad
 * till stdout. Den var svår att jämföra över körningar och gick inte att
 * återanvända i AI-analys. Med denna formatter blir rapporten en maskinläsbar
 * artefakt i C-testRig-format (se `02-Ingestion/C-htmlGate/C-testRig-reporting.md`).
 *
 * Designregler:
 *  - REN formatter. Inga filsystem-IO, inga nätverksanrop, inga sidoeffekter.
 *    Det är upp till callern att skriva strängen till disk / logg / databas.
 *  - `formatGateReport(input)` returnerar alltid en icke-tom sträng,
 *    även för tom input (rapporterar "0 sources, 0 events").
 *  - Fältnamn 1:1 med C-testRig Lag 1 (Batchrapport) — se README i denna mapp.
 *  - Använder IngestState från `./ingestState` för att räkna
 *    validated/failed/archived, så samma typ-system gäller hela vägen.
 */

import { type IngestState, type FailureReason } from './ingestState';

/**
 * En enskild rad i gate-eval — vad en source gjorde i denna körning.
 * Spegel av C-testRig Lag 2 (Källrapport), men bara de fält vi faktiskt
 * kan fylla i från IngestState (sourceId + slut-state + eventsFound + reason).
 */
export interface SourceEvalRow {
  sourceId: string;
  finalState: IngestState;
  eventsFound: number;
}

/**
 * Input till rapportformattering — det eval-körningen producerar.
 */
export interface GateEvalInput {
  gateId: string;            // t.ex. "A-to-B", "B-to-C", "C-to-D"
  batchId: string;           // t.ex. "batch-2026-10-09-A"
  roundNumber: 1 | 2 | 3;
  rows: ReadonlyArray<SourceEvalRow>;
  /** Hypotes som testades i rundan (eller null för baseline). */
  hypothesis: string | null;
  /** Faktisk ändring som kördes (eller null för baseline). */
  changeApplied: string | null;
  /** Generationsargument: varför var ändringen generell (multi-site)? */
  whyGeneral: string | null;
}

/**
 * Räknar antal källor per slut-state-kind.
 * Använder IngestState-kind direkt — ingen parallell string-typar som kan
 * driftar isär.
 */
function countByKind(rows: ReadonlyArray<SourceEvalRow>): {
  validated: number;
  failed: number;
  archived: number;
} {
  let validated = 0;
  let failed = 0;
  let archived = 0;
  for (const row of rows) {
    if (row.finalState.kind === 'validated') validated++;
    else if (row.finalState.kind === 'failed') failed++;
    else if (row.finalState.kind === 'archived') archived++;
    // raw = "fortfarande i ingångskön" — räknas inte som slut-state.
  }
  return { validated, failed, archived };
}

/**
 * Räknar antal failures per FailureReason — spegel av
 * C-testRig Lag 1 `failTypeDistribution`.
 */
function countFailureReasons(rows: ReadonlyArray<SourceEvalRow>): Record<FailureReason, number> {
  const allReasons: FailureReason[] = [
    'serialization_bug',
    'geographic_scope_violation',
    'missing_required_field',
    'duplicate',
    'upstream_timeout',
    'parse_error',
    'unverified',
  ];
  const counts = Object.fromEntries(allReasons.map((r) => [r, 0])) as Record<FailureReason, number>;
  for (const row of rows) {
    if (row.finalState.kind === 'failed') {
      counts[row.finalState.reason]++;
    }
  }
  return counts;
}

function formatDistribution(record: Record<string, number>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) return '- (tom)';
  return entries.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

function totalEvents(rows: ReadonlyArray<SourceEvalRow>): number {
  return rows.reduce((sum, r) => sum + r.eventsFound, 0);
}

/**
 * `formatGateReport(input)` — formatterar en gate-eval som markdown.
 * Följer C-testRig Lag 1 (Batchrapport) — se
 * `02-Ingestion/C-htmlGate/C-testRig-reporting.md` §3.
 */
export function formatGateReport(input: GateEvalInput): string {
  const counts = countByKind(input.rows);
  const failReasons = countFailureReasons(input.rows);
  const events = totalEvents(input.rows);
  const totalRows = input.rows.length;
  const stopsReason = inferStopReason(input);

  const lines: string[] = [];
  lines.push(`## Gate-rapport ${input.gateId} (${input.batchId})`);
  lines.push('');
  lines.push('| Fält | Värde |');
  lines.push('|------|-------|');
  lines.push(`| batchId | ${input.batchId} |`);
  lines.push(`| gateId | ${input.gateId} |`);
  lines.push(`| roundNumber | ${input.roundNumber} |`);
  lines.push(`| sourcesIn | ${totalRows} |`);
  lines.push(`| validated | ${counts.validated} |`);
  lines.push(`| failed | ${counts.failed} |`);
  lines.push(`| archived | ${counts.archived} |`);
  lines.push(`| totalEventsExtracted | ${events} |`);
  lines.push(`| stopReason | ${stopsReason} |`);
  lines.push('');

  lines.push('### failTypeDistribution');
  lines.push(formatDistribution(failReasons));
  lines.push('');

  if (input.hypothesis) {
    lines.push('### hypothesis');
    lines.push(input.hypothesis);
    lines.push('');
  }

  if (input.changeApplied) {
    lines.push('### changeApplied');
    lines.push(input.changeApplied);
    lines.push('');
  }

  if (input.whyGeneral) {
    lines.push('### whyGeneral');
    lines.push(input.whyGeneral);
    lines.push('');
  }

  lines.push('### beforeSummary / afterSummary');
  lines.push('(single-rapport — ingen före/efter-jämförelse i detta format;');
  lines.push(' använd `compareGateReports(before, after)` för diff.)');
  lines.push('');

  lines.push('### nextStep');
  lines.push(inferNextStep(input, counts, events));
  lines.push('');

  return lines.join('\n');
}

/**
 * Vilken stopReason gäller — baserat på antal rader och utfall.
 * Spegel av C-testRig `stopReason`-värdena.
 */
function inferStopReason(input: GateEvalInput): string {
  if (input.rows.length === 0) return 'no-sources-available';
  if (input.changeApplied === null) return 'baseline';
  if (input.roundNumber === 3) return 'max-rounds-reached';
  return 'round-pending';
}

/**
 * Vad bör nästa steg vara — kort, konkret, ingen vag rekommendation.
 * Använder siffror från rapporten för att undvika "boosta X" utan evidens.
 */
function inferNextStep(
  input: GateEvalInput,
  counts: { validated: number; failed: number; archived: number },
  events: number,
): string {
  if (input.rows.length === 0) {
    return 'Tom eval — ingen källa att utvärdera. Kontrollera gate-input.';
  }
  if (events === 0 && counts.validated === 0) {
    const topReason = Object.entries(countFailureReasons(input.rows))
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])[0];
    if (topReason) {
      return `0 events, alla fail. Vanligaste orsak: ${topReason[0]} (${topReason[1]} st). Undersök denna specifikt i nästa runda.`;
    }
    return '0 events, alla fail. Inspektera käll-rapporter för root cause.';
  }
  if (counts.failed > 0) {
    return `${counts.failed} fail kvar — kör ny runda med ny hypotes som adresserar vanligaste FailureReason.`;
  }
  return 'Inga fail — kör ny runda med ny hypotes (t.ex. höj eventsFound per validated).';
}

/**
 * `compareGateReports(before, after)` — diff mellan två körningar.
 * Returnerar markdown som visar förändringen per metric.
 */
export function compareGateReports(before: GateEvalInput, after: GateEvalInput): string {
  const b = countByKind(before.rows);
  const a = countByKind(after.rows);
  const bEvents = totalEvents(before.rows);
  const aEvents = totalEvents(after.rows);

  const lines: string[] = [];
  lines.push(`## Jämförelse ${before.batchId} → ${after.batchId}`);
  lines.push('');
  lines.push('| Metric | Before | After | Δ |');
  lines.push('|--------|--------|-------|---|');
  lines.push(`| sourcesIn | ${before.rows.length} | ${after.rows.length} | ${signed(after.rows.length - before.rows.length)} |`);
  lines.push(`| validated | ${b.validated} | ${a.validated} | ${signed(a.validated - b.validated)} |`);
  lines.push(`| failed | ${b.failed} | ${a.failed} | ${signed(a.failed - b.failed)} |`);
  lines.push(`| archived | ${b.archived} | ${a.archived} | ${signed(a.archived - b.archived)} |`);
  lines.push(`| totalEvents | ${bEvents} | ${aEvents} | ${signed(aEvents - bEvents)} |`);
  lines.push('');
  lines.push('### decision');
  if (a.validated > b.validated && aEvents > bEvents) {
    lines.push('keep (fler validerade + fler events)');
  } else if (a.validated < b.validated || aEvents < bEvents) {
    lines.push('revert (färre validerade eller färre events)');
  } else {
    lines.push('unclear (ingen tydlig förbättring — omtolka hypotes)');
  }
  lines.push('');
  return lines.join('\n');
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
