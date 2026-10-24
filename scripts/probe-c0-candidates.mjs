#!/usr/bin/env node
/**
 * probe-c0-candidates.mjs — kör den RIKTIGA C0-funktionen mot valda
 * källor och skriver ut vad den hittade.
 *
 * Bakgrund (2026-10-24). 65 spårade källor svarar men ger 0 events. För att
 * orsaksutreda dem behöver vi veta vad C0 faktiskt ser: hittade den
 * kandidater, föll den tillbaka till domänroten, och blev det en vinjare?
 *
 * Skriptet är en MÄTNING — det skriver ingenting i runtime eller databas.
 * Det kör samma `discoverEventCandidates` som C-gaten kör.
 *
 * Användning:
 *   npx tsx scripts/probe-c0-candidates.mjs <sourceId> [<sourceId> ...]
 *
 * Kräver tsx: C0-modulen importerar extensionless TS-moduler.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceFile } from './lib/readSourceFile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (ids.length === 0) {
  console.error('usage: npx tsx scripts/probe-c0-candidates.mjs <sourceId> [...]');
  process.exit(1);
}

function readSource(sourceId) {
  const file = path.join(ROOT, 'sources', `${sourceId}.jsonl`);
  if (!existsSync(file)) return null;
  return readSourceFile(file);
}

const { discoverEventCandidates } = await import(
  path.join(ROOT, '02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.ts')
);

for (const id of ids) {
  const isUrl = /^https?:\/\//i.test(id);
  const source = isUrl ? { url: id } : readSource(id);
  if (!source || !source.url) {
    console.log(`${id}: KÄLLAN SAKNAS eller saknar URL`);
    continue;
  }
  const t0 = Date.now();
  try {
    const r = await discoverEventCandidates(source.url, undefined, isUrl ? undefined : id);
    const winner = r.winner ? r.winner.url : '—';
    console.log(
      `${id}: kandidater=${r.candidatesFound} vinjare=${winner} ` +
      `rotFallback=${r.rootFallbackUrl ?? 'nej'} reason=${r.winnerReason ?? '—'} ` +
      `(${Date.now() - t0} ms)`,
    );
    const cands = r.candidates ?? [];
    for (const c of cands.slice(0, 3)) {
      console.log(`    kandidat: ${c.url ?? JSON.stringify(c).slice(0, 120)}`);
    }
  } catch (err) {
    console.log(`${id}: FEL ${err instanceof Error ? err.message : String(err)}`);
  }
}
