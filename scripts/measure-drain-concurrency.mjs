#!/usr/bin/env node
/**
 * measure-drain-concurrency.mjs — mäter hur snabpt BullMQ-kön dräneras vid
 * olika worker-concurrency.
 *
 * Varför (2026-10-24). `03-Queue/queue.ts` hårdkodade concurrency till 5.
 * Mätning: 45,4 jobb/min. Nattens import köar ~5 300 jobb, men cron-stegets
 * budget är 90 minuter — 45,4 × 90 ≈ 4 086 jobb. Kön växer alltså varje
 * natt, och de extragerade eventsen syntes i databasen först flera nätter
 * senare. Varje jobb väntar på två LLM-anrop (editorial-pipelinens
 * faktualitets- och oberoendekontroll), så jobbtiden domineras av
 * modelllatens, inte av CPU. Fler workers = mer parallell modelltrafik.
 *
 * Vad verktyget gör:
 *   1. Kör drainen med concurrency A under en tidsperiod, räknar
 *      "[worker] Job completed"-rader → jobb/min.
 *   2. Kör samma sak med concurrency B.
 *   3. Jämför.
 *
 * Ingen syntetisk data: varje "Job completed" är en riktig normalisering
 * som persisterat ett event i Supabase.
 *
 * Användning:
 *   node scripts/measure-drain-concurrency.mjs --low 5 --high 10 --seconds 120
 *   node scripts/measure-drain-concurrency.mjs --low 5 --high 10 --seconds 120 --apply
 *     (--apply: exit 1 om den högre concurrencyn INTE är snabbare)
 *   node scripts/measure-drain-concurrency.mjs --low 5 --high 10 --seconds 120 --seed
 *     (--seed: kör importToEventPulse först, så det finns något att mäta på)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DRAIN = path.join(ROOT, '03-Queue', 'drainQueue.ts');

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
};
const low = parseInt(argOf('--low', '5'), 10);
const high = parseInt(argOf('--high', '10'), 10);
const seconds = parseInt(argOf('--seconds', '120'), 10);
const apply = argv.includes('--apply');
const seed = argv.includes('--seed');

/**
 * Lägg riktiga jobb i kön så att det finns något att mäta på.
 *
 * Kör den VANLIGA importvägen (importToEventPulse) — inte en syntetisk
 * queue. Importen är idempotent: den släpper terminala jobb och lägger
 * in dem igen med samma jobId, och normalizern deduplar på
 * (source, titel, start_time). Inga dubbletter i databasen.
 *
 * Utan detta är mätningen meningslös när kön är tom — då blir båda
 * mätvärdena 0 jobb/min, vilket är korrekt men värdelöst.
 */
function seedQueue() {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', '03-Queue/importToEventPulse.ts'], {
      cwd: ROOT,
      env: { ...process.env },
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { out += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`importToEventPulse avslutade med exit=${code}. Sista utdata:\n${out.slice(-1500)}`));
        return;
      }
      const m = out.match(/(\d+)\s+events till bullmq/i);
      resolve({ exitCode: code, enqueued: m ? parseInt(m[1], 10) : null, tail: out.slice(-400) });
    });
  });
}

/**
 * Kör drainen med given concurrency och räkna färdiga jobb.
 * Returnerar {completed, failed, ratePerMin}.
 */
async function measure(concurrency) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['tsx', '03-Queue/drainQueue.ts', '--concurrency', String(concurrency), '--max-ms', String(seconds * 1000)],
      { cwd: ROOT, env: { ...process.env } },
    );

    let completed = 0;
    let failed = 0;
    let stdoutTail = '';

    const onData = (chunk) => {
      const text = chunk.toString();
      stdoutTail = (stdoutTail + text).slice(-4000);
      for (const line of text.split('\n')) {
        if (/\[worker\] Job completed/.test(line)) completed += 1;
        else if (/\[drain\] job failed/.test(line)) failed += 1;
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && completed === 0 && failed === 0) {
        reject(new Error(`drain avslutade med exit=${code}. Sista utdata:\n${stdoutTail}`));
        return;
      }
      // En mätning utan färdiga jobb är ogiltig — inte "låg hastighet".
      // Utan denna vakt skulle en tomkö ge 0 jobb/min för BÅDA värdena, och
      // jämförelsen "högre är snabbare" skulle aldrig fylla sitt syfte.
      if (completed === 0 && failed === 0) {
        reject(new Error(
          `concurrency=${concurrency}: inga jobb slutfördes under ${seconds} s — ` +
          `mätningen är ogiltig (kön var troligen tom). ` +
          `Kör med --seed för att lägga in riktiga jobb först. ` +
          `Sista utdata:\n${stdoutTail}`,
        ));
        return;
      }
      resolve({
        concurrency,
        completed,
        failed,
        ratePerMin: +((completed / seconds) * 60).toFixed(2),
        exitCode: code,
      });
    });
  });
}

const result = { low, high, seconds, measuredAt: new Date().toISOString() };

try {
  if (seed) {
    console.error('[measure] seeder kön via importToEventPulse (riktiga events)...');
    result.seed = await seedQueue();
    console.error(`[measure] seed: ${result.seed.enqueued ?? '?'} events till bullmq`);
  }
  console.error(`[measure] concurrency=${low} i ${seconds}s ...`);
  result.lowResult = await measure(low);
  console.error(`[measure] concurrency=${high} i ${seconds}s ...`);
  result.highResult = await measure(high);
} catch (err) {
  console.error(`[measure] FAIL: ${err.message}`);
  process.exit(1);
}

const speedup = result.lowResult.ratePerMin > 0
  ? +(result.highResult.ratePerMin / result.lowResult.ratePerMin).toFixed(2)
  : null;
result.speedup = speedup;
result.jobsPerBudgetLow = Math.round(result.lowResult.ratePerMin * 90);
result.jobsPerBudgetHigh = Math.round(result.highResult.ratePerMin * 90);
result.errorRateLow = result.lowResult.completed + result.lowResult.failed > 0
  ? +(result.lowResult.failed / (result.lowResult.completed + result.lowResult.failed)).toFixed(3)
  : null;
result.errorRateHigh = result.highResult.completed + result.highResult.failed > 0
  ? +(result.highResult.failed / (result.highResult.completed + result.highResult.failed)).toFixed(3)
  : null;

console.log(JSON.stringify(result, null, 2));

if (apply) {
  const faster = result.highResult.ratePerMin > result.lowResult.ratePerMin;
  if (!faster) {
    console.error(
      `[measure] FAIL concurrency=${high} (${result.highResult.ratePerMin} jobb/min) är inte ` +
      `snabbare än concurrency=${low} (${result.lowResult.ratePerMin} jobb/min)`,
    );
    process.exit(1);
  }
  console.error(
    `[measure] PASS concurrency=${high} ger ${result.highResult.ratePerMin} jobb/min ` +
    `(${result.jobsPerBudgetHigh} jobb på 90 min) mot ${result.lowResult.ratePerMin} ` +
    `(${result.jobsPerBudgetLow} jobb på 90 min)`,
  );
}
