import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { RealAbcdSourceCandidateRunner } from './realToolRunner.js';
import { runSourceCandidateTest } from './runner.js';
import { createSupabaseSourceCandidateTestRepository } from './supabaseRepository.js';
import type { SourceCandidate, SourceCandidateTestPhase } from './types.js';

dotenv.config({ path: '.env', override: true });

function argValue(name: string, fallback?: string): string | undefined {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : fallback;
}

async function main(): Promise<void> {
  const phase = (argValue('--phase', 'sanity') ?? 'sanity') as SourceCandidateTestPhase;
  const limit = Number(argValue('--limit', '1'));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  const repository = createSupabaseSourceCandidateTestRepository(createClient(url, key));
  const toolRunner = new RealAbcdSourceCandidateRunner();
  const claimed = await repository.claimCandidates(limit, phase);

  for (const item of claimed) {
    const candidate: SourceCandidate = {
      id: item.sourceCandidateId,
      candidateUrl: item.candidateUrl,
      sourceName: item.candidateName,
      city: null,
      priorityScore: item.priorityScore,
      confidenceScore: item.priorityScore,
      originPath: item.originPath,
      evidenceRefs: [],
    };
    const result = await runSourceCandidateTest({
      candidate,
      phase: item.phase,
      projectRoot: process.cwd(),
      repository,
      toolRunner,
    });
    console.log(JSON.stringify({
      sourceCandidateId: candidate.id,
      phase: item.phase,
      runId: result.runId,
      decision: result.decision.decision,
      reason: result.decision.reason,
    }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
