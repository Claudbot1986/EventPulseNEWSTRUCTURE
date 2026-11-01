import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  SourceCandidatePageSignal,
  SourceCandidateToolEvidence,
  SourceCandidateToolRunner,
  SourceCandidateToolRunnerInput,
  ToolStageSummary,
} from './types.js';
// 2026-11-01 — HTML-parsningen (JSON-LD, og:*, beskrivning) finns i
// ingestion-lagret, där berikningen också använder den. Samma parsning, två
// konsumenter — inte två kopior. Samma mönster som sandbox.ts →
// 02-Ingestion/tools/eventUrls.js.
import { probeRowPages } from './pageProbe.js';

const OUTPUT_QUEUES = [
  // 2026-10-21 — postA lades till. A-gates träff väg (direkt JSON-LD/API) hamnar
  // där, inte i någon av köerna nedan. Utan den rapporterades en lyckad A-körning
  // som winningPath='none' trots att A faktiskt hittade events — rapporten
  // skrev "1 persisted events via none".
  'postA-queue.jsonl',
  'preB-queue.jsonl',
  'postB-preC-queue.jsonl',
  'preUI-queue.jsonl',
  'postTestC-UI.jsonl',
  'postTestC-D.jsonl',
  'postD-UI.jsonl',
];

/**
 * Läs e2e-rapportens eventsFound för sandbox-källan.
 *
 * e2e.py:s bygg funktion (core/e2e_report.py:96) mäter detta två vägar:
 * källans statusrad i runtime/sources_status.jsonl, eller rålinjer i
 * extracted/, extracted/C/, extracted/D/. Den hamnade bara i rapportens
 * perSource[].eventsFound och skrevs aldrig tillbaka hit.
 *
 * 2026-10-21 — eventsPersisted hårdkodades till 0, vilket gjorde
 * decideSourceCandidateOutcome (decision.ts:77) alltid falla till
 * manual_review: promote kräver eventsPersisted > 0. Loopen kunde alltså
 * aldrig producera en ny källa, oavsett hur bra kandidaten var.
 *
 * Returnerar null när rapporten inte kan läsas — "vet inte" skiljs från noll.
 */
function readE2eEventsFound(input: SourceCandidateToolRunnerInput): number | null {
  const reportDir = path.join(input.projectRoot, 'Alltools-E2E', 'runtime', 'reports');
  if (!existsSync(reportDir)) return null;
  const files = readdirSync(reportDir)
    .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
    .map((f) => path.join(reportDir, f))
    .sort((a, b) => b.localeCompare(a));
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const perSource = (parsed?.perSource ?? []) as Array<{ sourceId?: string; eventsFound?: number }>;
      const row = perSource.find((r) => r.sourceId === input.sandboxSourceId);
      if (row && typeof row.eventsFound === 'number') return row.eventsFound;
    } catch { /* trasig rapport — prova nästa */ }
  }
  return null;
}

export class RealAbcdSourceCandidateRunner implements SourceCandidateToolRunner {
  async run(input: SourceCandidateToolRunnerInput): Promise<SourceCandidateToolEvidence> {
    seedSandboxRuntime(input.sandboxRoot, input.sandboxSourceId);
    const command = [
      'python3',
      'Alltools-E2E/e2e.py',
      '--from-preA',
      '--limit',
      '1',
      '--apply',
    ];
    const result = spawnSync(command[0], command.slice(1), {
      cwd: input.projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVENTPULSE_SANDBOX_ROOT: input.sandboxRoot,
        EVENTPULSE_ABCD_ONLY: '1',
      },
    });

    const errors = [
      ...(result.error ? [result.error.message] : []),
      ...(result.status && result.status !== 0 ? [`real A/B/C/D command exited ${result.status}`] : []),
      ...result.stderr.split('\n').filter(Boolean),
    ];
    const counts = countSandboxOutputs(input.sandboxRoot, input.sandboxSourceId);
    const toolSummaries = summarizeTools(counts, errors);
    // 2026-10-21 — postA Included: A-gates träffväg (direkt JSON-LD/API) hamnar
    // i postA, inte i UI-köerna. Utan denna rad räknades en lyckad A-körning som 0.
    const queueEvents = counts.postA + counts.preUI + counts.postTestCUI + counts.postDUI;
    // e2e-rapportens mätning är auktoritativ när den finns; annars räknas
    // könraderna. max() istället för ersättning så att en rapport som mäter 0
    // inte nollställer en kvörad summa.
    const reportEvents = readE2eEventsFound(input);
    const eventsFoundTotal = reportEvents === null ? queueEvents : Math.max(queueEvents, reportEvents);
    const eventsPersisted = eventsFoundTotal;

    const reportPath = writeReport(input, command, counts, errors, result.stdout);
    const eventRows = readSandboxEventRows(input.sandboxRoot, input.sandboxSourceId);
    const eventPageSignals = await readSandboxPageSignals(input.sandboxRoot, input.sandboxSourceId);

    return {
      commandsRun: [command],
      toolSummaries,
      eventsFoundTotal,
      eventsAfterNormalization: input.phase === 'smoke' ? eventsFoundTotal : 0,
      eventsPersisted,
      winningPath: winningPathFromCounts(counts),
      errors,
      reportPath,
      reportComplete: errors.length === 0 || eventsFoundTotal > 0,
      riskFlags: [],
      eventTitles: eventRows.map((r) => r.title),
      eventPageSignals,
    };
  }
}

function seedSandboxRuntime(root: string, sourceId: string): void {
  const runtimeDir = path.join(root, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    path.join(runtimeDir, 'preA-queue.jsonl'),
    `${JSON.stringify({
      sourceId,
      addedAt: new Date().toISOString(),
      addedBy: 'source_candidate_test_sandbox',
      reason: 'source candidate isolated A/B/C/D test',
      attempts: 0,
    })}\n`,
    'utf8',
  );
}

function countRowsForSource(root: string, fileName: string, sourceId: string): number {
  const filePath = path.join(root, 'runtime', fileName);
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      try {
        return JSON.parse(line).sourceId === sourceId;
      } catch {
        return false;
      }
    }).length;
}

/**
 * 2026-11-01 — raderna ur sandbox-körningen: rubrik + deras egen URL.
 *
 * Utan dem kan beslutet inte skilja ett evenemang från en artikel: "det
 * persisterats events" är lika sant för kollaboration.se (10 artikelrubrikor)
 * som för en riktig evenemangssida. Se `eventLikeness.ts`.
 *
 * Vi läser de extraherade eventfilerna i sandboxen — samma filer importen
 * senare läser, så det är exakt de raderna som hade hamnat i grafen.
 */
function readSandboxEventRows(root: string, sourceId: string): Array<{ title: string; url: string; sourceUrl: string }> {
  const base = path.join(root, '03-Queue', '03-extractedevents');
  const rows: Array<{ title: string; url: string }> = [];
  const candidates: string[] = [];
  for (const dir of ['', 'A', 'B', 'C', 'D']) {
    candidates.push(path.join(base, dir, `${sourceId}.jsonl`));
  }
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { title?: string; name?: string; url?: string; sourceUrl?: string };
        const title = typeof row.title === 'string' ? row.title : typeof row.name === 'string' ? row.name : '';
        const url = typeof row.url === 'string' ? row.url : '';
        // 2026-11-01 — sourceUrl måste följa med, annars kan vi inte skilja en
        // detaljrad (url ≠ sourceUrl) från en listningsrad (url === sourceUrl).
        // Listningsradens sida beskriver hela listan, inte raden.
        const sourceUrl = typeof row.sourceUrl === 'string' ? row.sourceUrl : '';
        if (title.trim()) rows.push({ title, url, sourceUrl });
      } catch {
        // Trasig rad — hoppa över.
      }
    }
  }
  return rows;
}

/**
 * 2026-11-01 — hämta DETALJSIDAN för raderna och läs vad sidan själv säger.
 *
 * Mätning (2026-11-01) på kollaboration.se: 10 rader, av vilka titelmönstren
 * fångar 4. Men sidans egen JSON-LD säger `Article` — och det fångar dem
 * alla. Det är därför gaten läser sidorna, inte bara rubrikerna.
 *
 * Budget: 5 sidor per kandidat. Smoke-fasen körs max 8 kandidater per natt,
 * så det är max 40 extra hämtningar per natt.
 */
async function readSandboxPageSignals(
  root: string,
  sourceId: string,
  limit = 5,
): Promise<SourceCandidatePageSignal[]> {
  const rows = readSandboxEventRows(root, sourceId);
  return probeRowPages(rows, { limit });
}

function countSandboxOutputs(root: string, sourceId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const queue of OUTPUT_QUEUES) {
    counts[queue] = countRowsForSource(root, queue, sourceId);
  }
  return {
    postA: counts['postA-queue.jsonl'],
    preB: counts['preB-queue.jsonl'],
    postBPreC: counts['postB-preC-queue.jsonl'],
    preUI: counts['preUI-queue.jsonl'],
    postTestCUI: counts['postTestC-UI.jsonl'],
    postTestCD: counts['postTestC-D.jsonl'],
    postDUI: counts['postD-UI.jsonl'],
  };
}

function summarizeTools(counts: Record<string, number>, errors: string[]): SourceCandidateToolEvidence['toolSummaries'] {
  const failed = errors.length > 0;
  return {
    // 2026-10-21 — A läser postA (direkt JSON-LD/API-träff) OCH preUI
    // (direkt träff som gått vidare till UI-kön). Båda är A-gates framgång.
    A: stage(failed ? 'failed' : counts.postA > 0 || counts.preUI > 0 ? 'success' : 'no_events', counts.postA + counts.preUI, errors),
    B: stage(failed ? 'failed' : counts.preB > 0 ? 'no_events' : 'not_run', 0, errors),
    C: stage(failed ? 'failed' : counts.postTestCUI > 0 ? 'success' : counts.postBPreC > 0 ? 'no_events' : 'not_run', counts.postTestCUI, errors),
    D: stage(failed ? 'failed' : counts.postDUI > 0 ? 'success' : counts.postTestCD > 0 ? 'no_events' : 'not_run', counts.postDUI, errors),
  };
}

function stage(status: ToolStageSummary['status'], eventsFound: number, errors: string[]): ToolStageSummary {
  return { status, eventsFound, errors: errors.length ? errors : undefined };
}

function winningPathFromCounts(counts: Record<string, number>) {
  if (counts.postA > 0 || counts.preUI > 0) return 'jsonld';
  if (counts.postTestCUI > 0) return 'html';
  if (counts.postDUI > 0) return 'render';
  if (counts.postBPreC > 0) return 'html';
  if (counts.preB > 0) return 'network';
  return 'none';
}

function writeReport(
  input: SourceCandidateToolRunnerInput,
  command: string[],
  counts: Record<string, number>,
  errors: string[],
  stdout: string,
): string {
  const reportDir = path.join(input.projectRoot, '07-Discovery', 'testResults', 'source-candidates');
  mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const reportPath = path.join(reportDir, `run-${timestamp}-${input.candidate.id}.json`);
  writeFileSync(
    reportPath,
    `${JSON.stringify({
      sourceCandidateId: input.candidate.id,
      sandboxSourceId: input.sandboxSourceId,
      phase: input.phase,
      command,
      counts,
      errors,
      stdout,
      sandboxRuntimeFiles: existsSync(path.join(input.sandboxRoot, 'runtime'))
        ? readdirSync(path.join(input.sandboxRoot, 'runtime'))
        : [],
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  );
  return path.relative(input.projectRoot, reportPath);
}
