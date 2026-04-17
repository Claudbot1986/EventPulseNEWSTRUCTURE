/**
 * Test single source against Universal Scout Engine
 * Usage: npx tsx test-one.ts <sourceId> <url>
 */

import { runUniversalScout } from './index.js';

async function main() {
  const sourceId = process.argv[2] || 'test-source';
  const url = process.argv[3] || 'https://helsingborgarena.se/';
  
  console.log(`\n=== Universal Scout Test ===`);
  console.log(`Source: ${sourceId}`);
  console.log(`URL: ${url}\n`);
  
  const result = await runUniversalScout(sourceId, url);
  
  console.log(`\n--- RESULT ---`);
  console.log(`Events found: ${result.eventsFound}`);
  console.log(`Winner method: ${result.winnerMethod}`);
  console.log(`Winner URL: ${result.winnerUrl}`);
  console.log(`Did converge: ${result.didConverge}`);
  console.log(`Duration: ${result.totalDurationMs}ms`);
  console.log(`  Scout: ${result.scoutDurationMs}ms`);
  console.log(`  Ranker: ${result.rankerDurationMs}ms`);
  console.log(`  Extractor: ${result.extractorDurationMs}ms`);
  
  if (result.failReason) {
    console.log(`FAILED: ${result.failReason} (stage: ${result.failStage})`);
  }
  
  if (result.scout) {
    console.log(`\n--- SCOUT ---`);
    console.log(`Candidates found: ${result.scout.totalCandidatesFound}`);
    console.log(`Swedish pattern hits: ${result.scout.swedishPatternHits.join(', ') || 'none'}`);
    console.log(`Fetch errors: ${result.scout.fetchErrors.join(', ') || 'none'}`);
  }
  
  if (result.ranker) {
    console.log(`\n--- RANKER ---`);
    console.log(`Top 3 candidates:`);
    for (const c of result.ranker.topCandidates.slice(0, 3)) {
      console.log(`  ${c.rank}. ${c.href} (density=${c.densityScore.toFixed(0)}, dates=${c.metrics.isoDateCount + c.metrics.sweDateCount}, JSON-LD=${c.metrics.hasJsonLd}, AppReg=${c.metrics.hasAppRegistry})`);
    }
  }
  
  if (result.extractor) {
    console.log(`\n--- MULTI-EXTRACTOR ---`);
    console.log(`Attempts: ${result.extractor.totalAttempts}`);
    console.log(`Winner method: ${result.extractor.winnerMethod}`);
    for (const attempt of result.extractor.attempts) {
      console.log(`  ${attempt.candidate.href}: ${attempt.eventCount} events via [${attempt.result.methodsUsed.join(', ')}]`);
    }
  }
  
  console.log(`\n=== DONE ===\n`);
}

main().catch(console.error);
