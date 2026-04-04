/**
 * Pending Render Queue — tillfällig väntelista för D-renderGate-kandidater
 * 
 * När C1 eller C3 identifierar att en källa behöver JavaScript-rendering,
 * skrivs den hit istället för att fortsätta genom vanliga C-steg.
 * 
 * När D-renderGate implementeras, läser den från denna fil.
 * 
 * Usage:
 *   import { addPendingRender, getPendingRenders, type PendingRenderCandidate } from './tools/pendingRenderQueue';
 *   await addPendingRender({ url, sourceName, reason: 'C1: likelyJsRendered', signal: 'js_rendered_c1', confidence: 0.9 });
 */

import path from 'path';
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PendingRenderCandidate {
  url: string;
  sourceName: string;
  status: 'pending_render_gate';
  reason: string;
  signal: 'js_rendered_c1' | 'js_rendered_c3' | 'routing_decision' | 'path_not_implemented' | 'c1_triage';
  confidence: number;
  detectedAt: string;
  htmlBytes?: number;
  attemptedPaths: string[];
}

const QUEUE_FILE = path.resolve(__dirname, '../../runtime/pending_render_queue.jsonl');

/**
 * Lägg till en kandidat i väntelistan
 */
export function addPendingRender(candidate: Omit<PendingRenderCandidate, 'status' | 'detectedAt'>): void {
  const entry: PendingRenderCandidate = {
    ...candidate,
    status: 'pending_render_gate',
    detectedAt: new Date().toISOString(),
  };

  const line = JSON.stringify(entry) + '\n';
  appendFileSync(QUEUE_FILE, line, 'utf8');
}

/**
 * Hämta alla kandidater i väntelistan
 */
export function getPendingRenders(): PendingRenderCandidate[] {
  if (!existsSync(QUEUE_FILE)) return [];

  const content = readFileSync(QUEUE_FILE, 'utf8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as PendingRenderCandidate);
}

/**
 * Ta bort en kandidat från listan (efter att D-renderGate behandlat den)
 */
export function removePendingRender(url: string): void {
  const candidates = getPendingRenders();
  const filtered = candidates.filter(c => c.url !== url);
  
  // Skriv tillbaka utan den url
  const { writeFileSync } = require('fs');
  writeFileSync(QUEUE_FILE, filtered.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');
}

export { QUEUE_FILE };
