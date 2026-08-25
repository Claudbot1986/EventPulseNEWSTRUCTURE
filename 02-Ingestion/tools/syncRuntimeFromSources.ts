/**
 * Rensar runtime-status mot sources/, bygger om prioritetskön så varje källa ingår.
 * Anropas från queue-mem.py sync-prea (subprocess).
 */
import { pruneOrphanStatuses, rebuildPriorityQueue } from './sourceRegistry';

function main() {
  const removed = pruneOrphanStatuses();
  rebuildPriorityQueue();
  console.log(`[syncRuntimeFromSources] pruneOrphanStatuses removed=${removed}`);
}

main();
