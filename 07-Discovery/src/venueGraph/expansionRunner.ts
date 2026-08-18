import type { ExpansionResult, ExpansionTask, VenueGraphRepository } from './types.js';

interface RunExpansionTaskOptions {
  repository: VenueGraphRepository;
  task: ExpansionTask;
}

export async function runExpansionTask(options: RunExpansionTaskOptions): Promise<ExpansionResult> {
  await options.repository.markExpansionTaskProcessing(options.task.id);
  const evidenceRefs = await options.repository.findExpansionEvidence(options.task);

  const result: ExpansionResult = {
    taskId: options.task.id,
    measured: true,
    resultSummary: [
      `Measured expansion for ${options.task.candidateName}`,
      `task_type=${options.task.taskType}`,
      `evidence_refs=${evidenceRefs.length}`,
      'source_candidates_created=0',
    ].join('; '),
    newNodesCount: 0,
    newEdgesCount: evidenceRefs.filter((evidence) => evidence.evidenceType === 'graph_edge').length,
    newVenueCandidatesCount: 0,
    newSourceCandidatesCount: 0,
    evidenceRefs,
  };

  await options.repository.completeExpansionTask(options.task.id, result);
  return result;
}

export async function runExpansionBatch(repository: VenueGraphRepository, limit = 5): Promise<ExpansionResult[]> {
  const tasks = await repository.fetchPendingExpansionTasks(limit);
  const results: ExpansionResult[] = [];

  for (const task of tasks) {
    try {
      results.push(await runExpansionTask({ repository, task }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repository.failExpansionTask(task.id, message);
    }
  }

  return results;
}
