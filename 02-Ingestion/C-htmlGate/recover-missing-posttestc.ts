/**
 * recover-missing-posttestc.ts
 * 
 * Recovery script: Sources that exited the C-pool (allExitedIds) but were never
 * written to any postTestC-*.jsonl file get written to postTestC-manual-review.
 * 
 * This fixes the "139 sources missing from postTestC" bug where:
 * - Sources exit pool (added to allExitedIds in pool-state.json)
 * - But routeResult() never appends them to postTestC files
 * - They get stuck in limbo
 * 
 * Run: npx tsx 02-Ingestion/C-htmlGate/recover-missing-posttestc.ts
 */

import { readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(__dirname, '../../runtime');
const REPORTS_DIR = join(__dirname, '../reports');
const QUEUES = {
  MANUAL_REVIEW: join(RUNTIME_DIR, 'postTestC-manual-review.jsonl'),
};

// Collect all sources already in any postTestC file
function getPostTestCSources(): Set<string> {
  const sources = new Set<string>();
  const files = readdirSync(RUNTIME_DIR).filter(f => f.startsWith('postTestC') && f.endsWith('.jsonl'));
  for (const file of files) {
    const content = readFileSync(join(RUNTIME_DIR, file), 'utf8');
    for (const line of content.split('\n').filter(l => l.trim())) {
      try {
        const entry = JSON.parse(line);
        sources.add(entry.sourceId);
      } catch {}
    }
  }
  return sources;
}

// Get all unique sources that have ever exited any batch pool
function getAllExitedSources(): Map<string, { batchId: string; roundsParticipated: number }> {
  const sources = new Map<string, { batchId: string; roundsParticipated: number }>();
  const batchDirs = readdirSync(REPORTS_DIR).filter(d => d.startsWith('batch-'));
  
  for (const batchDir of batchDirs) {
    const stateFile = join(REPORTS_DIR, batchDir, 'pool-state.json');
    if (!existsSync(stateFile)) continue;
    
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      const exitedIds: string[] = state.allExitedIds || [];
      
      // Try to get rounds from exited entries
      const exitedEntries: { sourceId: string; roundsParticipated: number }[] = state.exited || [];
      const roundsMap = new Map<string, number>();
      for (const ex of exitedEntries) {
        if (ex.source?.sourceId) {
          roundsMap.set(ex.source.sourceId, ex.source.roundsParticipated || 0);
        }
      }
      
      for (const sourceId of exitedIds) {
        if (!sources.has(sourceId)) {
          sources.set(sourceId, {
            batchId: batchDir,
            roundsParticipated: roundsMap.get(sourceId) || 3,
          });
        }
      }
    } catch (e) {
      console.warn(`  Warning: Could not read ${stateFile}: ${e}`);
    }
  }
  return sources;
}

function main() {
  console.log('=== Recovery: Missing postTestC entries ===\n');
  
  const inPostTestC = getPostTestCSources();
  console.log(`Sources already in postTestC files: ${inPostTestC.size}`);
  
  const allExited = getAllExitedSources();
  console.log(`Total unique sources that exited pools: ${allExited.size}`);
  
  // Find missing
  const missing: { sourceId: string; batchId: string; rounds: number }[] = [];
  for (const [sourceId, info] of allExited.entries()) {
    if (!inPostTestC.has(sourceId)) {
      missing.push({ sourceId, batchId: info.batchId, rounds: info.roundsParticipated });
    }
  }
  
  console.log(`\nSources EXITED pool but NOT in postTestC: ${missing.length}`);
  
  if (missing.length === 0) {
    console.log('Nothing to recover. Exiting.');
    return;
  }
  
  // Show first 10
  console.log('\nFirst 10 missing:');
  for (const m of missing.slice(0, 10)) {
    console.log(`  ${m.sourceId} (from ${m.batchId}, rounds: ${m.rounds})`);
  }
  
  // Write to postTestC-manual-review
  console.log(`\nWriting ${missing.length} entries to postTestC-manual-review...`);
  let written = 0;
  for (const m of missing) {
    const entry = {
      sourceId: m.sourceId,
      queueName: 'postTestC-manual-review',
      queuedAt: new Date().toISOString(),
      priority: 1,
      attempt: 1,
      queueReason: `[RECOVERY] Exited pool (${m.batchId}) but never written to postTestC — recovered ${new Date().toISOString()}`,
      workerNotes: `RECOVERY: Found in allExitedIds of ${m.batchId} but missing from all postTestC queues`,
      winningStage: 'C4-AI' as const,
      outcomeType: 'fail' as const,
      routeSuggestion: 'manual-review',
      roundNumber: m.rounds,
      roundsParticipated: m.rounds,
    };
    appendFileSync(QUEUES.MANUAL_REVIEW, JSON.stringify(entry) + '\n');
    written++;
  }
  
  console.log(`\n=== Recovery complete ===`);
  console.log(`Written ${written} entries to ${QUEUES.MANUAL_REVIEW}`);
  console.log(`postTestC-manual-review now has $(wc -l < ${QUEUES.MANUAL_REVIEW}) entries`);
}

main();
