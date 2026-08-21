/**
 * refill-preui-queue.ts — T0040
 *
 * Reconstitutes runtime/preUI-queue.jsonl from the postA-queue and
 * postB-queue (sources that completed A/B extraction and have events
 * ready for the UI import stage).
 *
 * The preUI-queue is normally maintained by runA.ts / runB.ts as a
 * side-effect of successful extractions. When the queue is lost (e.g.
 * after a reset, a manual edit, or a script bug) but the postA/postB
 * records still exist, this script rebuilds preUI-queue from the
 * upstream evidence so the next runA-extract can verify the full
 * D-AI-fallback end-to-end path.
 *
 * Idempotent: skips sourceIds already present in preUI-queue.
 *
 * Usage:
 *   npx tsx 02-Ingestion/tools/refill-preui-queue.ts
 *   npx tsx 02-Ingestion/tools/refill-preui-queue.ts --dry
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const RUNTIME_DIR = '/Volumes/2TB filer/NEWSTRUCTURE-COPY/runtime';
const PREUI_Q  = path.join(RUNTIME_DIR, 'preUI-queue.jsonl');
const POSTA_Q  = path.join(RUNTIME_DIR, 'postA-queue.jsonl');
const POSTB_Q  = path.join(RUNTIME_DIR, 'postB-queue.jsonl');
const EXTRACTED_DIR = '/Volumes/2TB filer/NEWSTRUCTURE-COPY/03-Queue/03-extractedevents';

interface QueueEntry {
  sourceId: string;
  queueName?: string;
  queuedAt?: string;
  priority?: number;
  attempt?: number;
  queueReason?: string;
  workerNotes?: string;
  eventsFound?: number;
}

function readJsonl<T>(p: string): T[] {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T);
}

function countEventsIn(sourceId: string): number {
  const f = path.join(EXTRACTED_DIR, `${sourceId}.jsonl`);
  if (!existsSync(f)) return 0;
  const lines = readFileSync(f, 'utf8').split('\n').filter(l => l.trim());
  return lines.length;
}

function main() {
  const dry = process.argv.includes('--dry');
  const postA = readJsonl<QueueEntry>(POSTA_Q);
  const postB = readJsonl<QueueEntry>(POSTB_Q);
  const existing = readJsonl<QueueEntry>(PREUI_Q);
  const existingIds = new Set(existing.map(e => e.sourceId));

  const seen = new Set<string>();
  const combined: QueueEntry[] = [];
  for (const e of [...postA, ...postB]) {
    if (!e.sourceId || seen.has(e.sourceId)) continue;
    seen.add(e.sourceId);
    combined.push(e);
  }

  console.log(`[refill] postA-queue: ${postA.length} entries`);
  console.log(`[refill] postB-queue: ${postB.length} entries`);
  console.log(`[refill] preUI existing: ${existing.length} entries`);
  console.log(`[refill] unique ready sources: ${combined.length}`);
  console.log();

  let added = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  const newEntries: QueueEntry[] = [];
  for (const e of combined) {
    if (existingIds.has(e.sourceId)) {
      skipped++;
      console.log(`  skip ${e.sourceId} (already in preUI)`);
      continue;
    }
    const eventCount = countEventsIn(e.sourceId);
    if (eventCount === 0) {
      skipped++;
      console.log(`  skip ${e.sourceId} (0 events in extractedevents/)`);
      continue;
    }
    const isA = postA.some(p => p.sourceId === e.sourceId);
    newEntries.push({
      sourceId: e.sourceId,
      queueName: 'preUI',
      queuedAt: e.queuedAt ?? now,
      priority: e.priority ?? 1,
      attempt: 1,
      queueReason: `T0040 refill from ${isA ? 'postA' : 'postB'}`,
      workerNotes: `${isA ? 'A' : 'B'}: ${eventCount} events`,
      eventsFound: eventCount,
    });
    added++;
    console.log(`  +   ${e.sourceId} (${eventCount} events, from ${isA ? 'postA' : 'postB'})`);
  }

  console.log();
  if (dry) {
    console.log(`[refill] DRY -- would add ${added}, skip ${skipped}`);
    return;
  }

  if (added === 0) {
    console.log(`[refill] nothing to add -- preUI-queue unchanged`);
    return;
  }

  const out = [...existing, ...newEntries].map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(PREUI_Q, out, 'utf8');
  console.log(`[refill] wrote ${added} new entries to preUI-queue.jsonl`);
  console.log(`[refill] total preUI-queue: ${existing.length + added} entries`);
}

main();
