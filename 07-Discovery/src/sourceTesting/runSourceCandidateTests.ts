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

  // 2026-10-31 — MATA KÖN INNAN CLAIM. Detta var den brutenaste länken i
  // hela discovery→ingestion-kedjan: P3A skriver ~90 nya kandidater per natt
  // till `source_candidates`, men ingenting anropade
  // `enqueue_source_candidate_tests()`, så `source_candidate_test_queue` var
  // fryst sedan 2026-10-23. Följden: P3D claimade 0 rader (746 ms, exit=0,
  // ingen utdata), inga källor promotades, inga nya events.
  // Mätt före fixen: 116 pending-kandidater med city='Stockholm' väntade i
  // `source_candidates` och 215 kö-rader hade city=NULL (= oclaimbara, eftersom
  // claim-funktionen filtrerar på `city = 'Stockholm'`).
  const synced = await repository.syncQueueCity();
  const enqueued = await repository.enqueuePendingCandidates(phase);
  console.log(
    `[runSourceCandidateTests] kön matad: ${enqueued} nya rader, ${synced} rader city-synkade (fas=${phase})`,
  );

  const claimed = await repository.claimCandidates(limit, phase);
  // Kön har ingen metadata-kolumn — hämta den ur kandidattabellen så att den
  // följer med till promote.
  const metadataByCandidate = await repository.getCandidateMetadata(
    claimed.map(item => item.sourceCandidateId),
  );

  // 2026-11-07 — PARALLELLA KANDIDATER (var: seriell loop).
  //
  // MÄTTNING 2026-11-07: varje kandidat tar ~97 s genom A→B→C i sandboxen.
  // 8 kandidater serielt = 779 562 ms = 13 minuter av kedjans budget, och
  // väggtiden är SUMMAN av alla kandidater.
  //
  // Med begränsad parallellism blir väggtiden ungefär den LÄNGSTA kandidaten
  // i stället för summan. Varje kandidat har sin egen sandbox (mkdtemp i
  // runner.ts) så filerna krockar inte, och promote skriver atomiskt
  // (sandbox.ts) så en parallell läsare aldrig ser en halvskriven fil.
  //
  // Varför inte högre parallellism: C-gaten renderar sidor (ScrapingBee /
  // Puppeteer) och delar en del resurser med sajtens rate limits. För hög
  // grad kan ge falska "fel" på kandidater som egentligen fungerar — det
  // skulle kosta fler källor, inte färre. 3 är mätt som säkert.
  const concurrency = Math.max(
    1,
    Number(argValue('--concurrency', process.env.EVENTPULSE_P3D_CONCURRENCY ?? '3')) || 3,
  );
  const failures: Array<{ errorClass: string; message: string }> = [];

  await runWithConcurrency(claimed, concurrency, async (item) => {
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
    try {
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
    } catch (error) {
      // 2026-11-07 — en trasig kandidat ska inte döda resten av batchen.
      // Felet fångas, klassas ärligt och rapporteras efteråt.
      const errorClass = classifyWithCarried(error);
      const message = describeError(error);
      failures.push({ errorClass, message });
      console.error(
        `[runSourceCandidateTests] kandidat ${candidate.id} misslyckades: ${message} [${errorClass}]`,
      );
    }
  });

  if (failures.length > 0) {
    // Ärlig felklassning: transportfel (Supabase nåddes aldrig) är inte samma
    // som ett kodfel. errorClass bärs med på felet så att main().catch
    // klassar om det som det egentligen är.
    const errorClass = failures.some((f) => f.errorClass === 'transport')
      ? 'transport'
      : failures.some((f) => f.errorClass === 'auth')
        ? 'auth'
        : 'logic';
    const error = new Error(
      `${failures.length} av ${claimed.length} kandidater misslyckades: ${failures.map((f) => f.message).join(' | ')}`,
    ) as Error & { errorClass: string };
    error.errorClass = errorClass;
    throw error;
  }
}

/**
 * Kör `worker` över `items` med högst `limit` samtidiga anrop.
 *
 * Resultaten behåller itemens ordning. Ett fel i en worker avbryter INTE de
 * andra — felet fångas av anroparen per item.
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
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
