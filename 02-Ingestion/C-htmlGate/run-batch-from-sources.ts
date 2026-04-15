/**
 * run-batch-from-sources — Wrapper that calls runDynamicPoolBatch with explicit sources
 * 
 * Usage: npx tsx run-batch-from-sources.ts --sources "a,b,c" --batch-id 25
 */

import { runDynamicPoolBatch } from './run-dynamic-pool.js';

const args = process.argv.slice(2);
const sourcesArg = args.find(a => a.startsWith('--sources='))?.split('=')[1];
const batchIdArg = args.find(a => a.startsWith('--batch-id='))?.split('=')[1];

if (!sourcesArg) {
  console.error('Usage: npx tsx run-batch-from-sources.ts --sources="a,b,c" --batch-id=25');
  process.exit(1);
}

const sources = sourcesArg.split(',').map(s => s.trim()).filter(Boolean);
const batchId = batchIdArg ? parseInt(batchIdArg, 10) : 25;

console.log(`Starting batch ${batchId} with ${sources.length} sources: ${sources.join(', ')}`);

runDynamicPoolBatch({
  batchNum: batchId,
  batchType: 'normal',
}).then(result => {
  console.log(`\nBatch ${batchId} completed!`);
  console.log(`Rounds: ${result.poolRoundNumber}`);
  console.log(`Exited: ${result.totalExited}`);
  console.log(`Active: ${result.totalActive}`);
  console.log(`Stop reason: ${result.stopReason}`);
  console.log(`Queue distribution:`, result.queueDistribution);
}).catch(err => {
  console.error('Batch failed:', err);
  process.exit(1);
});
