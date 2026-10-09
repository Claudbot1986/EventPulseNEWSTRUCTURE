/**
 * run-all.ts — Nattlig D-render-pilot för 5 source-specifika Stockholm-
 * källor. Serial loop (INTE parallell) för att undvika ScrapingBee
 * rate-limit och hålla credit-budget förutsägbar.
 *
 * 2026-10-09 — Val C fas A: auto-nattlig D-render-pilot.
 *
 * Triggs via scripts/cron/runD-render-pilot.sh som körs inom post-
 * ingest-kedjan kl 04:00.
 *
 * Användning (manuell): tsx runtime/d-render-pilot/run-all.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runPilotSource, type PilotResult } from '../runD-pilot';
import { RENDER_PILOT_SOURCES } from '../sourceAllowlist';

// Serial ordning — viktigt: 3arena/jarfalla-rätt-URL:er gäller EFTER
// Fas B. Ordningen är stable hash av sourceId (deterministiskt).
const PILOT_ORDER: readonly string[] = [...RENDER_PILOT_SOURCES].sort();

// Rate-limit-skydd: SB tillåter ~10 req/s; 2s paus = ~0.5 req/s = säker marginal.
const PAUSE_BETWEEN_SOURCES_MS = 2000;

const LOG_PATH = path.join(process.cwd(), 'runtime/d-render-pilot/log.jsonl');

function logLine(result: PilotResult): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    sourceId: result.sourceId,
    url: result.url,
    behavior: result.behavior,
    exitReason: result.exitReason,
    renderSuccess: result.renderSuccess,
    renderError: result.renderError,
    htmlLength: result.htmlLength,
    creditsCharged: result.creditsCharged,
    usedStealthFallback: result.usedStealthFallback,
    durationMs: result.durationMs,
    adapterHits: result.adapterHits,
    eventsFound: result.events.length,
    universalEventsFound: result.universalEventsFound,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function runAllPilots(): Promise<{ totalEvents: number; totalCredits: number; successful: number; results: PilotResult[] }> {
  const startedAt = Date.now();
  console.log(`[d-render-pilot] Starting serial render of ${PILOT_ORDER.length} pilot sources`);

  const results: PilotResult[] = [];
  for (let i = 0; i < PILOT_ORDER.length; i++) {
    const sourceId = PILOT_ORDER[i];
    if (i > 0) {
      await sleep(PAUSE_BETWEEN_SOURCES_MS);
    }
    try {
      const result = await runPilotSource(sourceId, {});
      fs.appendFileSync(LOG_PATH, logLine(result) + '\n');
      results.push(result);
      console.log(
        `  [${i + 1}/${PILOT_ORDER.length}] ${sourceId.padEnd(12)} ` +
        `events=${String(result.events.length).padStart(3)} ` +
        `credits=${result.creditsCharged} ` +
        `exitReason=${result.exitReason} ` +
        `duration=${result.durationMs}ms`
      );
    } catch (err) {
      // Fånga felet så kedjan fortsätter. Logga separat.
      const errLine = {
        ts: new Date().toISOString(),
        sourceId,
        exitReason: 'thrown',
        error: err instanceof Error ? err.message : String(err),
      };
      fs.appendFileSync(LOG_PATH, JSON.stringify(errLine) + '\n');
      console.error(`  [${i + 1}/${PILOT_ORDER.length}] ${sourceId.padEnd(12)} THREW: ${errLine.error}`);
    }
  }

  // Summering + early-warning
  const totalEvents = results.reduce((s, r) => s + r.events.length, 0);
  const totalCredits = results.reduce((s, r) => s + r.creditsCharged, 0);
  const successful = results.filter(r => r.events.length > 0).length;
  const totalDurationMs = Date.now() - startedAt;

  console.log(`[d-render-pilot] Done in ${totalDurationMs}ms`);
  console.log(`  Total events: ${totalEvents} (from ${successful}/${results.length} sources)`);
  console.log(`  Total credits: ${totalCredits} (≈$${(totalCredits * 0.0005).toFixed(4)})`);

  if (successful < 2) {
    console.warn(`[d-render-pilot] ⚠️ EARLY WARNING: only ${successful}/${results.length} sources returned events`);
  }

  return { totalEvents, totalCredits, successful, results };
}

// Kör bara main() om filen anropas som entrypoint (inte vid import i test).
// `import.meta.url` jämförs med `process.argv[1]` för detektering.
const isMain = typeof process !== 'undefined'
  && process.argv[1]
  && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runAllPilots().catch(err => {
    console.error('[d-render-pilot] FATAL:', err);
    process.exit(1);
  });
}
