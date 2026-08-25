import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type {
  SourceCandidateToolEvidence,
  SourceCandidateToolRunner,
  SourceCandidateToolRunnerInput,
  ToolStageSummary,
} from './types.js';

const OUTPUT_QUEUES = [
  'preB-queue.jsonl',
  'postB-preC-queue.jsonl',
  'preUI-queue.jsonl',
  'postTestC-UI.jsonl',
  'postTestC-D.jsonl',
  'postD-UI.jsonl',
];

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
    const eventsFoundTotal = counts.preUI + counts.postTestCUI + counts.postDUI;

    return {
      commandsRun: [command],
      toolSummaries,
      eventsFoundTotal,
      eventsAfterNormalization: input.phase === 'smoke' ? counts.preUI + counts.postTestCUI + counts.postDUI : 0,
      eventsPersisted: 0,
      winningPath: winningPathFromCounts(counts),
      errors,
      reportPath: writeReport(input, command, counts, errors, result.stdout),
      reportComplete: errors.length === 0 || eventsFoundTotal > 0,
      riskFlags: [],
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

function countSandboxOutputs(root: string, sourceId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const queue of OUTPUT_QUEUES) {
    counts[queue] = countRowsForSource(root, queue, sourceId);
  }
  return {
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
    A: stage(failed ? 'failed' : counts.preUI > 0 ? 'success' : 'no_events', counts.preUI, errors),
    B: stage(failed ? 'failed' : counts.preB > 0 ? 'no_events' : 'not_run', 0, errors),
    C: stage(failed ? 'failed' : counts.postTestCUI > 0 ? 'success' : counts.postBPreC > 0 ? 'no_events' : 'not_run', counts.postTestCUI, errors),
    D: stage(failed ? 'failed' : counts.postDUI > 0 ? 'success' : counts.postTestCD > 0 ? 'no_events' : 'not_run', counts.postDUI, errors),
  };
}

function stage(status: ToolStageSummary['status'], eventsFound: number, errors: string[]): ToolStageSummary {
  return { status, eventsFound, errors: errors.length ? errors : undefined };
}

function winningPathFromCounts(counts: Record<string, number>) {
  if (counts.preUI > 0) return 'jsonld';
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
