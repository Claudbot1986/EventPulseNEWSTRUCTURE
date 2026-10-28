#!/usr/bin/env node
/**
 * drainQueue — dränerar normalizer-kön och AVSLUTAR rent.
 *
 * Varför detta finns (2026-10-23): alla producenter i ingestion-kedjan skriver
 * till BullMQ-kön `raw_events`, men ingen dränerar den. `runDaily.ts:224` har
 * en 15-minuters drain — men det är INTE det som launchd kör. Plisten
 * com.eventpulse.ingestion kör scripts/ingestion-cron.ts, som saknar
 * drain-steg helt. Mätt 2026-10-23: 3 548 jobb väntande, äldsta från
 * 2026-10-20, 0 persisterade av nattens 1 147 "funna" events.
 *
 * Kedjan producerade alltså events som aldrig nådde databasen. Det här steget
 * är den sista milen.
 *
 * Bounded: avslutar när kön är tom, när maxMs gått, eller vid SIGTERM.
 * Avslutas via closeAllQueues() + stopAiImageWorker() — annars håller en öppen
 * ioredis-socket eventloopen levande för alltid (samma fel som B-gates hade).
 *
 * Usage:
 *   npx tsx 03-Queue/drainQueue.ts                    # töm kön, max 30 min
 *   npx tsx 03-Queue/drainQueue.ts --max-ms 300000   # max 5 min
 *   npx tsx 03-Queue/drainQueue.ts --concurrency 10   # 10 workers parallellt
 *   npx tsx 03-Queue/drainQueue.ts --status           # bara djup, ingen drain
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 03-Queue/drainQueue.ts ligger i samma katalog som queue.ts, så .env ligger
// ETT steg upp: '../.env'. Med '../../.env' laddades 0 variabler ("injecting
// env (0)") och queue.ts föll tillbaka på 'redis://host.docker.internal:6379'
// — en dator som inte kör Docker — vilket gav "Connection is closed" (2026-10-23).
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });

import { createNormalizerWorker, closeAllQueues, rawEventsQueue } from './queue.js';
import { withRedisTimeout } from './redisClient.mjs';
import { classifyError, exitCodeFor } from '../scripts/lib/net-error.mjs';
import { drainOutcome } from './drainOutcome.mjs';
import { flushStdout } from './stdoutFlush.mjs';
import { loadLedger, saveLedger, markPersisted, ledgerChanged, LEDGER_RELATIVE_PATH } from './importLedger.mjs';
// 2026-10-23 — processor:n MÅSTE vara den riktiga normalizern. Tidigare skickades
// en räknande stub: `createNormalizerWorker(async () => { completed++ })`. Det
// markeraade varje jobb som "completed" utan att persistera en enda rad — en
// fejk-drain som såg grön ut i loggen. Se .cursor/rules/no-simulated-production-
// ingestion.mdc. countWorkerCompletions() i verify-fixes.mjs räknar
// "[worker] Job completed"-rader, så en stub-räknare hade gett E3 grönt på
// noll persisterade events.
import { processRawEvent } from '../04-Normalizer/normalizer.js';
import { stopAiImageWorker } from '../08-Agent/workers/aiImageWorker.js';

const args = process.argv.slice(2);

/** Ledgerfilen — samma sökväg som importen använder. */
const LEDGER_PATH = path.resolve(__dirname, '..', LEDGER_RELATIVE_PATH);

/**
 * Markera ledger-rader som persisterade — men bara med BEVIS.
 *
 * Varför (2026-10-28). Importen registrerar en källa i fasen 'queued' — jobben
 * ligger bara i Redis. Först när dräneringen har skrivit dem till databasen
 * blir källan 'persisted'. Utan detta: dräneringen dör (Redis dör, ingen
 * persistence) → jobben borta → ledger säger ändå "importerad" → nästa natt
 * hoppar importen över källan → eventen förlorade för alltid.
 *
 * BEVIS (femte rundan). "Kön är tom" är INTE bevis — Redis kan ha dött och
 * tömtt kön utan att jobben persisterats. Beviset är RÄKNINGEN: en rad får
 * bara 'persisted' om antalet körda jobb täcker det importeraren köade upp
 * för DEN FILEN. Räkningen är per FIL (jobbets `import_file`) — inte per
 * kanonisk källa. Två filer kan ge samma kanoniska källa, och då skulle ett
 * bevis kunna "lånas" mellan dem: fil A:s bevis täckte fil B:s krav, B
 * flippa till 'persisted' utan att B:s jobb kördes, och B:s events försvann.
 *
 * Markeras bara när kön är TOM och inget jobb misslyckades. Ett misslyckat
 * jobb betyder att ett event inte kom in — då ska källan importeras om.
 *
 * @param {Map<string, number>} persistedByFile
 * @returns {number} antal källor som markerades
 */
function markLedgerPersisted(persistedByFile: Map<string, number>): number {
  try {
    const ledger = loadLedger(LEDGER_PATH);
    const queued = [...ledger.values()].filter((row) => row.state === 'queued').length;
    if (queued === 0) return 0;
    const marked = markPersisted(ledger, persistedByFile);
    // 2026-10-28 — skriv bara om något faktiskt ändrats. Annars rörs
    // ledgerfilen (mtime) varje natt utan att innehållet ändras — och
    // gaten L3 i GATES.md påstår "ledgerfilen röds INTE". Det ska vara
    // sant, inte bara ungefär sant.
    if (!ledgerChanged(ledger, marked)) return 0;
    saveLedger(LEDGER_PATH, marked);
    let count = 0;
    for (const [sourceId, row] of marked) {
      const before = ledger.get(sourceId);
      if (before && before.state === 'queued' && row.state === 'persisted') count += 1;
    }
    return count;
  } catch (err) {
    // Ledger-fel får inte stoppa dräneringen — den är bara en optimering.
    //
    // 2026-10-28 — men felet får INTE vara tyst. Här låg ett stavnamn
    // ('persistedBySource' istället för 'persistedByFile') som gjorde att
    // beviset ALDRIG skrevs, medan dräneringen avslutade exit 0 och kedjan
    // gick grön. Utan DEGRADED-markören hade kedjan klassat raden som ett
    // vanligt kodfel och fortsatt som inget hänt.
    console.error(
      `[drain] DEGRADED kunde inte uppdatera ledger: ${err instanceof Error ? err.message : String(err)} ` +
        '— källorna stannar i "queued" och importeras om nästa natt',
    );
    return 0;
  }
}
const maxMsIdx = args.indexOf('--max-ms');
const maxMs = maxMsIdx !== -1 && args[maxMsIdx + 1] ? parseInt(args[maxMsIdx + 1], 10) : 1_800_000;
const POLL_MS = 2_000;
/** Hur länge vi väntar på in-flight jobb innan vi avslutar hårt. */
const WORKER_CLOSE_TIMEOUT_MS = 30_000;

/**
 * Vilket läge ska drainen köra i? Se 03-Queue/drainMode.ts för resonemanget.
 * Modulen är beroendefri så att regeln kan testas utan Redis.
 */
export { resolveDrainMode, type DrainMode } from './drainMode.js';
import { resolveDrainMode } from './drainMode.js';
import {
  resolveWorkerConcurrency,
  DEFAULT_WORKER_CONCURRENCY,
} from './workerConcurrency.js';

/**
 * Hur många workers som ska köra. Flaggan `--concurrency N` vinner över
 * miljövariabeln NORMALIZER_CONCURRENCY, som vinner över standardvärdet.
 * Ett ogiltigt värde är ett fel — inte något att gissa bort.
 */
function resolveConcurrency(): number {
  const flagIdx = args.indexOf('--concurrency');
  const fromFlag = flagIdx !== -1 ? args[flagIdx + 1] : undefined;
  const raw = fromFlag ?? process.env.NORMALIZER_CONCURRENCY;

  if (raw === undefined || String(raw).trim() === '') {
    return DEFAULT_WORKER_CONCURRENCY;
  }

  const resolved = resolveWorkerConcurrency(raw);
  if (resolved === null) {
    console.error(
      `[drain] ogiltigt concurrency-värde "${raw}" — förväntar ett heltal >= 1`,
    );
    process.exit(2);
  }
  return resolved;
}

async function depth(): Promise<{ waiting: number; active: number; delayed: number; failed: number }> {
  // Utan argument returnerar getJobCounts alla typer. Med typer som argument
  // returnerar den bara de som finns i just det anropet — vilket gav undefined
  // i startloggen när kön var full (2026-10-23).
  //
  // 2026-10-28 — 'delayed' räknas också. Ett fördröjt jobb ligger kvar i
  // kön men körs inte: utan den skulle dräneringen säga "kö tom" medan
  // jobben låg kvar — och ledger skulle sakna bevis för dem.
  const counts = await rawEventsQueue.getJobCounts();
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
  };
}

/**
 * 2026-10-28 — ködjup med tidsgräns.
 *
 * Varför: `getJobCounts()` väntar på Redis. Om Redis är otillgängligt kan
 * anropet hänga — och det gör det i SIGTERM-handlern (stop()), där ett hängande
 * anrop betyder att processen ALDRIG avslutas. launchd ser då en process som
 * lever fast i en död kedja.
 *
 * Med optionerna i 03-Queue/redisClient.mjs (enableOfflineQueue: false)
 * misslyckas kommandot snabbt, men en explicit gräns är ändå rätt: den
 * fångar fall där Redis svarar men inte gör framsteg.
 */
const DEPTH_TIMEOUT_MS = 10_000;

async function depthWithTimeout(): Promise<{ waiting: number; active: number; delayed: number; failed: number }> {
  const result = await withRedisTimeout(() => depth(), DEPTH_TIMEOUT_MS);
  if (result.ok && result.value) return result.value;
  const error = result.error instanceof Error ? result.error : new Error(String(result.error));
  const code = (error as NodeJS.ErrnoException).code ?? 'okänt';
  console.error(`[drain] kunde inte läsa ködjup (${code}) — avbryter`);
  throw error;
}

/** Stäng alla Redis-sockets. Kan inte hänga: båda stegen har timeout. */
async function closeRedis(): Promise<void> {
  await stopAiImageWorker();
  await closeAllQueues();
}

async function main(): Promise<void> {
  const mode = resolveDrainMode(args);
  const start = await depthWithTimeout();

  if (mode === 'status') {
    console.log(JSON.stringify(start, null, 2));
    // --status importerar stopAiImageWorker, vilket öppnar två Redis-sockets på
    // modulnivå. Utan att stänga dem avslutas processen aldrig — mätt 2026-10-23
    // levde tre --status-processer kvar i timmar (lsof: 1 etablerad socket vardera).
    await closeRedis();
    await flushStdout();
    process.exit(0);
  }

  const concurrency = resolveConcurrency();
  console.log(
    `[drain] start: waiting=${start.waiting} active=${start.active} failed=${start.failed} ` +
      `maxMs=${maxMs} concurrency=${concurrency}`,
  );

  let completed = 0;
  /**
   * Misslyckade FÖRSÖK. BullMQ:s 'failed'-händelse skickas på VARJE misslyckat
   * försök — inte bara det sista. Med `attempts: 3` (03-Queue/queue.ts) kan
   * ett jobb ge tre 'failed'-rader och ändå lyckas på tredje försöket.
   *
   * 2026-10-28 — detta var en av anledningarna till att kedjan gick röd på en
   * fullständigt lyckad körning: en nätverksfläck som räddades av retry skrev
   * "fetch failed" till stderr, och kedjans klassificering läste det som ett
   * TRANSPORTFEL trots att jobbet senare lyckades.
   */
  let failedAttempts = 0;
  /**
   * Misslyckade jobb som SLUTADE som misslyckade — alla försök förbrukade.
   * Det är dessa som innebär att ett event inte kom in, och det är dessa
   * dräneringen måste rapportera med en icke-noll exitkod.
   *
   * BullMQ räknar `attemptsMade` INNAN 'failed'-händelsen skickas
   * (job.js: moveToFailed → `attemptsMade += 1` → worker.js: emit('failed')),
   * så ett jobb är TERMINALT när `attemptsMade >= opts.attempts`.
   */
  let terminalFailures = 0;
  /** Det första terminala felet — används för att klassa exitkoden. */
  let firstTerminalError: unknown = null;
  // 2026-10-28 — BEVIS för ledger. Räknar körda jobb per FIL (jobbets
  // `import_file`), så dräneringen kan visa att en specifik FIL faktiskt
  // persisterades. Utan detta fick ledger flippa till 'persisted' på
  // antagandet att en tom kö betyder "allt kom in".
  const persistedByFile = new Map<string, number>();
  const worker = createNormalizerWorker(async (job) => {
    await processRawEvent(job);
    completed += 1;
    const file = job.data?.import_file;
    if (typeof file === 'string' && file) {
      persistedByFile.set(file, (persistedByFile.get(file) ?? 0) + 1);
    }
    console.log(`[worker] Job completed — ${completed}/${start.waiting}`);
  }, 'raw_events', concurrency);
  worker.on('failed', (job, err) => {
    failedAttempts += 1;
    const attemptsAllowed = job?.opts?.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    const isTerminal = attemptsMade >= attemptsAllowed;
    if (isTerminal) {
      terminalFailures += 1;
      if (!firstTerminalError) firstTerminalError = err;
      console.error(
        `[drain] job failed (SLUTGILTIGT, försök ${attemptsMade}/${attemptsAllowed}): ${err.message}`,
      );
      return;
    }
    // Försöket misslyckades men jobbet försöker igen. Det är en FÖRSÖMRAD
    // försämring, inte ett fel — markören DEGRADED gör att kedjan inte
    // klassar steget som transportfel (se scripts/lib/net-error.mjs).
    console.warn(
      `[drain] DEGRADED job misslyckades (försök ${attemptsMade}/${attemptsAllowed}, försöker igen): ${err.message}`,
    );
  });

  /**
   * Stäng av dräneringen — idempotent.
   *
   * SIGTERM, "kö tom" och maxMs kan träffa samtidigt. Utan single-flight
   * skulle två anrop köra stängsekvensen parallellt, där den andra kunde
   * stänga Redis-sockarna medan den första fortfarande väntade på jobb.
   *
   * @param reason     mänsklig läsbar orsak (går i loggen)
   * @param queueEmpty true = kön var TOM när dräneringen avslutade
   */
  let stopPromise: Promise<void> | null = null;
  const stop = (reason: string, queueEmpty: boolean): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      // 2026-10-28 — djupet läses med tidsgräns. Utan den kunde SIGTERM
      // hänga i getJobCounts() när Redis var dött, och processen avslutades
      // aldrig → launchd trodde kedjan levde.
      let d = { waiting: -1, active: -1, delayed: -1, failed: -1 };
      try {
        d = await depthWithTimeout();
      } catch {
        // Djupet är okänt — vi avslutar ändå, bara med sanningen i loggen.
      }
      // Loggradens format är maskinellt läst (STEP_COUNT_RECIPES i
      // scripts/ingestion-cron.ts och verify-chain-live.mjs) — därför står
      // fälten i fast ordning.
      //
      // `failed` = jobb som SLUTADE som misslyckade (alla försök förbrukade).
      // Före detta räknades VARJE misslyckat försök hit, så ett jobb som
      // retry räddade såg ut som ett misslyckat jobb.
      // `misslyckade-försök` = antal försök som föll, oavsett utfall.
      console.log(
        `[drain] avslutar (${reason}): completed=${completed} failed=${terminalFailures} ` +
          `misslyckade-försök=${failedAttempts} ` +
          `kvar=${d.waiting} active=${d.active} delayed=${d.delayed}`,
      );
      // 2026-10-28 — besluten (ledger-flipp + exitkod) ligger i
      // 03-Queue/drainOutcome.mjs, som är testad utan Redis. Här tillämpas
      // bara regeln.
      const outcome = drainOutcome({
        // 2026-10-28 — beslutet bygger på den FÄRSKA djupmätningen, inte på
        // anroparens äldre snapshot (poll-loopen läser varannan sekund).
        // Gick mätningen inte att göra — Redis svarade inte — faller vi
        // tillbaka på anroparens snapshot: samma beteende som förut, aldrig
        // sämre. Utan detta kunde kedjan få "kö tom" (exit 0) medan loggen
        // visade att jobb stod kvar.
        queueEmpty: d.waiting >= 0
          ? d.waiting === 0 && d.active === 0 && d.delayed === 0
          : queueEmpty,
        terminalFailures,
        errorClass: terminalFailures > 0 ? classifyError(firstTerminalError) : 'logic',
      });
      // 2026-10-28 — tvåfas-ledger. Bara en dränering som avslutades för att
      // kön var TOM får markera källorna som persisterade. Annars skulle
      // ledger ljuga: "importerad" medan jobben inte finns kvar.
      //
      // Och bara källor vars antal körda jobb TÄCKER det importeraren köade
      // upp markeras — en tom kö efter en Redis-krasch bevisar ingenting.
      //
      // 2026-10-28 (andra rundan) — det globala villkoret "failed === 0" togs
      // BORT. Det gjorde att ledger nästan aldrig nådde 'persisted': ett enda
      // misslyckat försök (som retry räddade) höll hela dräneringen från att
      // flippa en enda rad — och då importerades samma källa varje natt, med
      // samma ~5 000 jobb i kön. Beviset är per källa (markPersisted täcker
      // bySource), inte globalt.
      if (outcome.ledgerEligible) {
        const marked = markLedgerPersisted(persistedByFile);
        if (marked > 0) console.log(`[drain] ledger: ${marked} källor markerade som persisterade`);
      }
      // Ordningen är load-bearing: worker.close() väntar på ALLA in-flight jobb
      // (BullMQ WhenCurrentJobsFinished). Sockets får INTE stängas före det —
      // då dör ett jobb mitt i sin efterpersisteringsköning med
      // "Connection is closed." och ett redan persisterat event markeras failed.
      //
      // 2026-10-28 — close() får INTE kasta. Om det gör det skickar racet
      // felet vidare, IIFE:n avslutas med ett ohanterat fel, och Node dör
      // med exit 1 i stället för exitkoden vi räknat fram (t.ex. 75).
      // closeRedis() skulle aldrig köras → Redis-socktarna lämnade öppna.
      try {
        await Promise.race([
          worker.close(),
          new Promise<void>((resolve) => setTimeout(resolve, WORKER_CLOSE_TIMEOUT_MS)),
        ]);
      } catch (err) {
        console.error(
          `[drain] worker.close() misslyckades: ${err instanceof Error ? err.message : String(err)} — ` +
            'går vidare med avslutandet',
        );
      }
      try {
        await closeRedis();
      } catch (err) {
        console.error(
          `[drain] kunde inte stänga Redis-socktarna: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // 2026-10-28 — ÄRLIG EXITKOD. Tidigare avslutade dräneringen ALLTID med
      // 0, även när jobb förlorades. Kedjan klassar steget efter exitkoden,
      // så en förlust var osynlig.
      if (outcome.exitCode !== 0) {
        console.error(`[drain] ${outcome.reason} — exit=${outcome.exitCode}`);
      }
      // 2026-10-28 — flusha UTAN innan vi avslutar. Utan detta kan
      // process.exit() kasta avslutsraden i skrivbufferten — och just den
      // raden är kedjans bevis på vad dräneringen gjorde. Se flushStdout().
      await flushStdout();
      process.exit(outcome.exitCode);
    })();
    return stopPromise;
  };

  process.on('SIGTERM', () => { void stop('SIGTERM', false); });
  process.on('SIGINT', () => { void stop('SIGINT', false); });

  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const d = await depthWithTimeout();
    // 2026-10-28 — 'delayed' räknas som "kvar". Ett fördröjt jobb har inte
    // körts, och källan ska inte markeras som persisterad för dess skull.
    if (d.waiting === 0 && d.active === 0 && d.delayed === 0) return void (await stop('kö tom', true));
  }
  await stop(`maxMs=${maxMs} uppnått`, false);
}

// ESM-säker main-check: require.main saknas i ESM-scope. Utan detta skulle
// varje import av modulen starta en riktig dränering av produktionskön.
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch(async (err) => {
    // 2026-10-28 — ärlig exitkod. Ett transportfel (Redis nåddes inte) ger
    // 69 (EX_UNAVAILABLE), inte 1 — kedjan ska veta att världen var trasig.
    const errorClass = classifyError(err);
    console.error(`[drain] fel (klass=${errorClass}):`, err instanceof Error ? err.message : err);
    // Samma flush som i stop(): felmeddelandet får inte försvinna i
    // skrivbufferten precis när processen avslutar.
    await flushStdout();
    process.exit(exitCodeFor(errorClass));
  });
}
