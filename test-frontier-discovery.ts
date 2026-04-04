/**
 * Test: HTML Frontier Discovery
 * 
 * Verifies that the discovery module finds internal event pages
 * before the C1/C2 scoring gates run.
 */

import { discoverEventCandidates } from './02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery';

async function testDiscovery(url: string, expectedSubpage?: string) {
  console.log(`\n═══ TESTING: ${url} ═══`);
  
  try {
    const result = await discoverEventCandidates(url);
    
    console.log(`\n--- Discovery Results ---`);
    console.log(`Total internal links: ${result.totalInternalLinks}`);
    console.log(`Candidates found: ${result.candidatesFound}`);
    console.log(`Root rejected: ${result.rootRejected ? 'YES' : 'NO'}`);
    
    if (result.rootRejectionReason) {
      console.log(`Root rejection: ${result.rootRejectionReason}`);
    }
    
    console.log(`\n--- Links by region ---`);
    for (const [region, count] of Object.entries(result.debug.allLinksByRegion)) {
      console.log(`  ${region}: ${count}`);
    }
    
    console.log(`\n--- Top 5 scoring links ---`);
    for (const link of result.debug.topScoringLinks) {
      console.log(`  ${link.href} (score=${link.score}, concepts=${link.concepts.join(',')})`);
    }
    
    console.log(`\n--- Top candidates by event density ---`);
    for (let i = 0; i < Math.min(5, result.topCandidates.length); i++) {
      const c = result.topCandidates[i];
      console.log(`  ${i+1}. ${c.url}`);
      console.log(`     density=${c.eventDensityScore} reason=${c.rankingReason}`);
    }
    
    if (result.winner) {
      console.log(`\n--- WINNER ---`);
      console.log(`  URL: ${result.winner.url}`);
      console.log(`  Source: ${result.winner.sourceRegion}`);
      console.log(`  Event density: ${result.winner.eventDensityScore}`);
      console.log(`  Reason: ${result.winnerReason}`);
    }
    
    if (expectedSubpage) {
      const found = result.topCandidates.some(c => c.url.includes(expectedSubpage));
      console.log(`\n--- VERIFICATION ---`);
      console.log(`Expected subpage "${expectedSubpage}" found: ${found ? 'YES ✓' : 'NO ✗'}`);
    }
    
    return result;
  } catch (error) {
    console.error(`ERROR: ${error}`);
    return null;
  }
}

async function main() {
  console.log('═══ HTML FRONTIER DISCOVERY TEST ═══');
  
  // Test 1: gso.se - should find /program/konserter
  await testDiscovery('https://www.gso.se', '/program/konserter');
  
  // Test 2: folkoperan.se - should find /pa-scen/ or similar
  await testDiscovery('https://www.folkoperan.se', '/pa-scen');
  
  // Test 3: aviciiarena.se - should find Musik/Show or Sport
  await testDiscovery('https://www.aviciiarena.se', '/musik');
  
  console.log('\n═══ TEST COMPLETE ═══');
}

main().catch(console.error);
