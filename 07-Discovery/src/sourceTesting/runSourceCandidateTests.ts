import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { RealAbcdSourceCandidateRunner } from './realToolRunner.js';
import { runSourceCandidateTest } from './runner.js';
import { createSupabaseSourceCandidateTestRepository } from './supabaseRepository.js';
import type { SourceCandidate, SourceCandidateTestPhase } from './types.js';
import { classifyWithCarried, describeError } from '../../../scripts/lib/net-error.mjs';

// 2026-10-28 — .env laddas med override:false så att en explicit satt
// miljövariabel (t.ex. i verifieringskörningar) vinner över .env. Med
// override:true kunde .env peka om en avsiktligt trasig anslutning — det
// var precis vad som gjorde fail-fast-testet grönt trots att världen var död.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false });

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
  // Kön har ingen metadata-kolumn — hämta den ur kandidattabellen så att den
  // följer med till promote.
  const metadataByCandidate = await repository.getCandidateMetadata(
    claimed.map(item => item.sourceCandidateId),
  );

  for (const item of claimed) {
    const candidate: SourceCandidate = {
      id: item.sourceCandidateId,
      candidateUrl: item.candidateUrl,
      sourceName: item.candidateName,
      city: item.city ?? null,
      priorityScore: item.priorityScore,
      confidenceScore: item.priorityScore,
      originPath: item.originPath,
      evidenceRefs: [],
      metadata: metadataByCandidate[item.sourceCandidateId],
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

main().catch((error: unknown) => {
  // 2026-10-28 — ärlig exitkod. Ett transportfel (Supabase nåddes aldrig)
  // är inte detsamma som ett kodfel, och P3D är ett kedjsteg: exit 1 där
  // låg kedjan se "ett steg gick sönder", exit 69 säger "världen var död".
  //
  // classifyWithCarried: repository-lagret fångar felet, klassar det
  // ORIGINELLA felet och lägger klassen på det omsluta Error-objektet.
  // Klassar vi om det omsluta felet försvinner den informationen — ett
  // transportfel i en insert blev 'logic' (exit 1) i stället för
  // 'transport' (exit 69).
  const cls = classifyWithCarried(error);
  console.error(`[runSourceCandidateTests] ${describeError(error)} [${cls}]`);
  process.exitCode = cls === 'transport' ? 69 : cls === 'auth' ? 77 : 1;
});
