/**
 * Source Registry — hanterar source truth, status och prioritets kö
 * 
 * Dis Trening:
 * - sources/ = source truth (en fil per källa)
 * - runtime/sources_status.jsonl = senaste körstatus per källa  
 * - runtime/sources_priority_queue.jsonl = prioriterad kö för scheduler
 * 
 * Usage:
 *   import { getAllSources, getSourceStatus, updateSourceStatus, addToPriorityQueue } from './tools/sourceRegistry';
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use process.cwd() for project-root-relative paths.
// This ensures sources/ and runtime/ are always resolved from NEWSTRUCTURE/ root,
// not from the importing module's location.
const PROJECT_ROOT = process.cwd();
const SOURCES_DIR = path.resolve(PROJECT_ROOT, 'sources');
const RUNTIME_DIR = path.resolve(PROJECT_ROOT, 'runtime');
const STATUS_FILE = path.resolve(RUNTIME_DIR, 'sources_status.jsonl');
const PRIORITY_FILE = path.resolve(RUNTIME_DIR, 'sources_priority_queue.jsonl');

// ─── Source Truth ─────────────────────────────────────────────────────────────

export interface SourceTruth {
  id: string;
  url: string;
  name: string;
  type: string;
  city?: string;
  discoveredAt: string;
  discoveredBy: 'manual' | 'discovery' | 'venue_graph' | '100testcandidates' | 'active' | 'source_import';
  preferredPath: 'jsonld' | 'html' | 'network' | 'render' | 'api' | 'unknown';
  // Spårbarhet för path-beslut
  preferredPathReason?: string;       // Varför detta path valdes
  systemVersionAtDecision?: string;  // Version av systemet när path beslutades
  // Verifiering och recheck
  verifiedAt?: string;                // Senaste verifieringstid
  needsRecheck?: boolean;             // Tvinga omvärdering nästa kör
  // Review flag from 00A import
  requiresManualReview?: boolean;     // Source flagged for manual review during ingestion
  reviewTags?: string[];              // Why flagged: manualreview, name_conflict, city_conflict, etc.
  // Backwards compatibility
  lastSystemVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceStatus {
  sourceId: string;
  status: 'never_run' | 'success' | 'partial' | 'fail' | 'error' |
    'pending_render_gate' | 'pending_api_adapter' | 'pending_network_adapter' |
    'triage_required' | 'routing_review_required' | 'needs_recheck';
  ingestionStage: 'pending' | 'A' | 'B' | 'C' | 'D' | 'completed' | 'failed';
  lastRun: string | null;
  lastSuccess: string | null;
  consecutiveFailures: number;
  lastEventsFound: number;
  lastError?: string;
  lastPathUsed?: 'jsonld' | 'html' | 'network' | 'render';
  lastSystemVersion?: string;  // Vilken systemversion som kördes

  // ── Routingminne ─────────────────────────────────────────────────────────
  lastRoutingReason?: string;    // Varför detta path valdes (senaste körning)
  lastRoutingSource?: 'preferredPath' | 'runtime_status' | 'triage' | 'unknown';
  pendingNextTool?: 'D-renderGate' | 'api_adapter' | 'network_inspection' |
                  'html_extraction_review' | 'preferredPath_recheck' | 'c1_gate';
  triageAttempts?: number;       // Antal triage-försök för unknown sources
  routingReviewReason?: string;  // Varför routing review behövs

  // ── C1 Triage Resultat ────────────────────────────────────────────────────
  /** Resultat från C1-preHtmlGate screening */
  triageResult?: TriageResult;
  /** Path som C1 rekommenderar baserat på screening */
  triageRecommendedPath?: 'html' | 'render' | 'network' | 'manual_review';
  /** Varför C1 gav detta resultat */
  triageReason?: string;

  // ── Triage-historik (runtime-only, skrivs aldrig till sources/) ───────────
  /** Alla triage-försök i kronologisk ordning */
  triageHistory?: TriageAttempt[];
  /** Konfidens för nuvarande preferredPath (0.0-1.0), runtime-only */
  preferredPathConfidence?: number;

  attempts: number;
}

/**
 * Möjliga utfall från C1-preHtmlGate triage
 */
export type TriageResult =
  | 'html_candidate'      // Sida ser ut som HTML-event källa, kan extraheras
  | 'render_candidate'    // Sida är sannolikt JS-renderad, behöver D-renderGate
  | 'manual_review'       // Kan inte avgöra automatiskt, behöver mänsklig granskning
  | 'still_unknown';     // Inte tillräckligt med data för att avgöra

/**
 * Ett enskilt triage-försök (runtime-only, sparas aldrig i sources/)
 */
export interface TriageAttempt {
  timestamp: string;
  outcome: TriageResult;
  recommendedPath: 'html' | 'render' | 'network' | 'manual_review';
  eventsFound?: number;       // Faktiska events från extraction (om körning skedde)
  extractionSuccess?: boolean;
  triageReason: string;
}

export interface PriorityEntry {
  sourceId: string;
  priority: number;
  reason: string;
  addedAt: string;
  runsSinceAdd: number;
}

/**
 * Hämta alla sources från sources/
 * Stöder två format:
 *   1. Multi-line JSON (pretty-printed) — en komplett JSON-object per fil
 *   2. JSONL — en JSON-object per rad
 */
export function getAllSources(): SourceTruth[] {
  if (!existsSync(SOURCES_DIR)) return [];

  const files = readdirSync(SOURCES_DIR).filter(f => f.endsWith('.jsonl'));
  const sources: SourceTruth[] = [];

  for (const file of files) {
    const content = readFileSync(path.join(SOURCES_DIR, file), 'utf8').trim();

    // Först: försök parsa hela filen som en JSON-object (multi-line format)
    try {
      const parsed = JSON.parse(content) as SourceTruth;
      if (parsed && parsed.id) {
        sources.push(parsed);
        continue;
      }
    } catch {}

    // Andra: försök parsa varje rad som separat JSON (JSONL-format)
    const lines = content.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SourceTruth;
        if (parsed && parsed.id) {
          sources.push(parsed);
        }
      } catch {
        // Rad kunde inte parsas, ignorera
      }
    }
  }

  return sources;
}

/**
 * Hämta en specifik source
 */
export function getSource(id: string): SourceTruth | null {
  const filePath = path.join(SOURCES_DIR, `${id}.jsonl`);
  if (!existsSync(filePath)) return null;
  
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;
  
  try {
    return JSON.parse(lines[0]) as SourceTruth;
  } catch {
    return null;
  }
}

// ─── Triage Learning (runtime-only) ──────────────────────────────────────────

/**
 * Konservativ preferredPath-konfidenslogik.
 *
 * V1 regler:
 * - html_candidate + events > 0: +0.3
 * - html_candidate + events = 0: +0.0 (ingen förändring)
 * - render_candidate: +0.2
 * - still_unknown/manual_review: -0.1
 * - Max 1.0, min 0.0 (rundas till 1 decimal)
 *
 * Promotion candidate kräver:
 * - confidence >= 0.7 OCH
 * - minst 2 html_candidate ELLER 1 med 5+ events
 * - max 20 triage-försök i historiken
 */
export function recordTriageAttempt(
  sourceId: string,
  attempt: TriageAttempt
): { newConfidence: number; candidateForPromotion: boolean; promotionSuggestion?: string } {
  const statuses = readStatusFile();
  const status = statuses.get(sourceId);

  if (!status) {
    throw new Error(`Source ${sourceId} not found in status file`);
  }

  // Initiera historik om saknas
  if (!status.triageHistory) {
    status.triageHistory = [];
  }

  // Lägg till försöket
  status.triageHistory.push(attempt);

  // Begränsa historik till 20 senaste försöken
  if (status.triageHistory.length > 20) {
    status.triageHistory = status.triageHistory.slice(-20);
  }

  // Beräkna ny konfidens (runda till 1 decimal)
  const currentConfidence = status.preferredPathConfidence ?? 0.0;
  let delta = 0;

  if (attempt.outcome === 'html_candidate' && (attempt.eventsFound ?? 0) > 0) {
    delta = 0.3;
  } else if (attempt.outcome === 'html_candidate' && (attempt.eventsFound ?? 0) === 0) {
    delta = 0.0;
  } else if (attempt.outcome === 'render_candidate') {
    delta = 0.2;
  } else if (attempt.outcome === 'still_unknown' || attempt.outcome === 'manual_review') {
    delta = -0.1;
  }

  // Avrunda till 1 decimal för att undvika floating point-problem
  const newConfidence = Math.round(Math.max(0.0, Math.min(1.0, currentConfidence + delta)) * 10) / 10;
  status.preferredPathConfidence = newConfidence;

  // Konservativ promotion-logik V1
  let candidateForPromotion = false;
  let promotionSuggestion: string | undefined;

  if (newConfidence >= 0.7) {
    const htmlCandidateCount = status.triageHistory.filter(
      a => a.outcome === 'html_candidate'
    ).length;
    const totalEventsFromHtml = status.triageHistory
      .filter(a => a.outcome === 'html_candidate')
      .reduce((sum, a) => sum + (a.eventsFound ?? 0), 0);
    const totalAttempts = status.triageHistory.length;

    if (htmlCandidateCount >= 2 || (htmlCandidateCount === 1 && totalEventsFromHtml >= 5)) {
      // Kontrollera att vi inte kört för många försök utan att promo
      if (totalAttempts <= 10) {
        candidateForPromotion = true;
        promotionSuggestion = `confidence=${newConfidence.toFixed(1)}, html_candidates=${htmlCandidateCount}, total_events=${totalEventsFromHtml}, attempts=${totalAttempts}`;
      } else {
        promotionSuggestion = `confidence=${newConfidence.toFixed(1)} men för många försök (${totalAttempts}), kräv manuell granskning`;
      }
    }
  }

  // Spara till statusfil
  writeStatusFile(statuses);

  return { newConfidence, candidateForPromotion, promotionSuggestion };
}

// ─── Status hantering ─────────────────────────────────────────────────────────

/**
 * Derive ingestionStage from legacy status field.
 * Used for migrating old status entries that predate the ingestionStage field.
 */
function deriveIngestionStage(status: SourceStatus): SourceStatus['ingestionStage'] {
  if (status.status === 'success' && status.lastEventsFound > 0) return 'completed';
  if (status.status === 'fail') return 'failed';
  if (status.status === 'pending_render_gate') return 'D';
  if (status.status === 'pending_api_adapter') return 'A';
  if (status.status === 'pending_network_adapter') return 'B';
  if (status.status === 'triage_required' || status.status === 'routing_review_required') return 'C';
  if (status.status === 'never_run') return 'pending';
  // partial, error, needs_recheck — default to pending
  return 'pending';
}

function readStatusFile(): Map<string, SourceStatus> {
  const map = new Map<string, SourceStatus>();
  if (!existsSync(STATUS_FILE)) return map;

  const content = readFileSync(STATUS_FILE, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const status = JSON.parse(line) as SourceStatus;
      // Migrate old entries that don't have ingestionStage set
      if (!status.ingestionStage) {
        status.ingestionStage = deriveIngestionStage(status);
      }
      map.set(status.sourceId, status);
    } catch {}
  }

  return map;
}

function writeStatusFile(statuses: Map<string, SourceStatus>): void {
  const lines = Array.from(statuses.values()).map(s => JSON.stringify(s));
  writeFileSync(STATUS_FILE, lines.join('\n') + '\n', 'utf8');
}

/**
 * Hämta status för en specifik source
 */
export function getSourceStatus(sourceId: string): SourceStatus {
  const statuses = readStatusFile();
  const status = statuses.get(sourceId);
  if (!status) {
    return {
      sourceId,
      status: 'never_run',
      ingestionStage: 'pending',
      lastRun: null,
      lastSuccess: null,
      consecutiveFailures: 0,
      lastEventsFound: 0,
      attempts: 0,
    };
  }
  // Ensure ingestionStage is always set
  if (!status.ingestionStage) {
    status.ingestionStage = deriveIngestionStage(status);
  }
  return status;
}

/**
 * Hämta alla statuser
 */
export function getAllStatuses(): SourceStatus[] {
  return Array.from(readStatusFile().values());
}

/**
 * Uppdatera status för en source efter körning
 *
 * Routingminne skrivs alltid tillbaka för spårbarhet.
 */
export function updateSourceStatus(
  sourceId: string,
  result: {
    success: boolean;
    eventsFound: number;
    pathUsed?: 'jsonld' | 'html' | 'network' | 'render';
    ingestionStage?: 'pending' | 'A' | 'B' | 'C' | 'D' | 'completed' | 'failed';
    error?: string;
    // Routingminne
    lastRoutingReason?: string;
    lastRoutingSource?: 'preferredPath' | 'runtime_status' | 'triage' | 'unknown';
    pendingNextTool?: 'D-renderGate' | 'api_adapter' | 'network_inspection' |
                    'html_extraction_review' | 'preferredPath_recheck' | 'c1_gate';
    triageAttempts?: number;
    routingReviewReason?: string;
    // C1 Triage Resultat
    triageResult?: TriageResult;
    triageRecommendedPath?: 'html' | 'render' | 'network' | 'manual_review';
    triageReason?: string;
  }
): void {
  const statuses = readStatusFile();
  const current = statuses.get(sourceId) || {
    sourceId,
    status: 'never_run' as const,
    ingestionStage: 'pending' as const,
    lastRun: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    lastEventsFound: 0,
    attempts: 0,
  };

  const now = new Date().toISOString();

  current.lastRun = now;
  current.attempts++;

  // ── Skriv alltid routingminne ────────────────────────────────────────────
  if (result.lastRoutingReason) {
    current.lastRoutingReason = result.lastRoutingReason;
  }
  if (result.lastRoutingSource) {
    current.lastRoutingSource = result.lastRoutingSource;
  }
  if (result.pendingNextTool) {
    current.pendingNextTool = result.pendingNextTool;
  }
  if (result.triageAttempts !== undefined) {
    current.triageAttempts = result.triageAttempts;
  }
  if (result.routingReviewReason) {
    current.routingReviewReason = result.routingReviewReason;
  }

  // ── C1 Triage Resultat ───────────────────────────────────────────────────
  if (result.triageResult) {
    current.triageResult = result.triageResult;
  }
  if (result.triageRecommendedPath) {
    current.triageRecommendedPath = result.triageRecommendedPath;
  }
  if (result.triageReason) {
    current.triageReason = result.triageReason;
  }

  // ── Bestäm ny status ──────────────────────────────────────────────────────
  if (result.success && result.eventsFound > 0) {
    current.status = 'success';
    current.lastSuccess = now;
    current.consecutiveFailures = 0;
    current.lastEventsFound = result.eventsFound;
    current.lastError = undefined;
    current.pendingNextTool = undefined; // Klar, inget nästa verktyg
    current.routingReviewReason = undefined; // Ingen review längre
    current.ingestionStage = 'completed';

  } else if (!result.success && result.error?.includes('pending_render_gate')) {
    current.status = 'pending_render_gate';
    current.consecutiveFailures++;
    current.lastError = result.error;
    current.ingestionStage = 'D';

  } else if (!result.success && result.error?.includes('pending_api_adapter')) {
    current.status = 'pending_api_adapter';
    current.consecutiveFailures++;
    current.lastError = result.error;
    current.ingestionStage = 'A';

  } else if (!result.success && result.error?.includes('pending_network_adapter')) {
    current.status = 'pending_network_adapter';
    current.consecutiveFailures++;
    current.lastError = result.error;
    current.ingestionStage = 'B';

  } else if (!result.success && result.error?.includes('triage_required')) {
    current.status = 'triage_required';
    current.consecutiveFailures++;
    current.lastError = result.error;
    current.ingestionStage = 'C';

  } else if (!result.success && result.error?.includes('routing_review_required')) {
    current.status = 'routing_review_required';
    current.lastError = result.error;
    current.ingestionStage = 'C';

  } else if (!result.success && result.error?.includes('needs_recheck')) {
    current.status = 'needs_recheck';
    current.lastError = result.error;
    current.ingestionStage = result.ingestionStage ?? 'pending';

  } else if (!result.success) {
    current.status = result.eventsFound > 0 ? 'partial' : 'fail';
    current.consecutiveFailures++;
    current.lastError = result.error;
    current.ingestionStage = result.eventsFound > 0 ? 'completed' : 'failed';
  }

  current.lastPathUsed = result.pathUsed;
  statuses.set(sourceId, current);
  writeStatusFile(statuses);
}

/**
 * Säkerställ att en source har en status-entry i sources_status.jsonl.
 * Om source redan har en status, gör inget.
 * Används när nya sources importeras via 00A så att de hamnar i pending-kön.
 */
export function ensureSourceStatus(sourceId: string): void {
  const statuses = readStatusFile();
  let isNew = false;

  if (!statuses.has(sourceId)) {
    const newStatus: SourceStatus = {
      sourceId,
      status: 'never_run',
      ingestionStage: 'pending',
      lastRun: null,
      lastSuccess: null,
      consecutiveFailures: 0,
      lastEventsFound: 0,
      attempts: 0,
    };
    statuses.set(sourceId, newStatus);
    writeStatusFile(statuses);
    isNew = true;
  }

  // Also ensure source is in priority queue
  const queue = readPriorityFile();
  const alreadyInQueue = queue.some(e => e.sourceId === sourceId);
  if (!alreadyInQueue) {
    addToPriorityQueue(sourceId, 2, 'never_run'); // priority 2 = never_run
  }
}

// ─── Priority Queue ───────────────────────────────────────────────────────────

function readPriorityFile(): PriorityEntry[] {
  if (!existsSync(PRIORITY_FILE)) return [];
  
  const content = readFileSync(PRIORITY_FILE, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  
  return lines.map(line => {
    try {
      return JSON.parse(line) as PriorityEntry;
    } catch {
      return null;
    }
  }).filter((e): e is PriorityEntry => e !== null);
}

function writePriorityFile(entries: PriorityEntry[]): void {
  const lines = entries.map(e => JSON.stringify(e));
  writeFileSync(PRIORITY_FILE, lines.join('\n') + '\n', 'utf8');
}

/**
 * Lägg till source i prioritets-kön
 */
export function addToPriorityQueue(sourceId: string, priority: number, reason: string): void {
  const queue = readPriorityFile();
  
  // Ta bort eventuell befintlig entry för denna source
  const filtered = queue.filter(e => e.sourceId !== sourceId);
  
  filtered.push({
    sourceId,
    priority,
    reason,
    addedAt: new Date().toISOString(),
    runsSinceAdd: 0,
  });
  
  // Sortera efter priority (lägst först)
  filtered.sort((a, b) => a.priority - b.priority);
  
  writePriorityFile(filtered);
}

/**
 * Hämta nästa source från prioritets-kön
 */
export function getNextInQueue(): PriorityEntry | null {
  const queue = readPriorityFile();
  return queue[0] || null;
}

/**
 * Ta bort en source från prioritets-kön
 */
export function removeFromQueue(sourceId: string): void {
  const queue = readPriorityFile();
  const filtered = queue.filter(e => e.sourceId !== sourceId);
  writePriorityFile(filtered);
}

/**
 * Fyller prioritetskön baserat på statusar (för nyinitiering)
 */
export function rebuildPriorityQueue(): void {
  const sources = getAllSources();
  const statuses = readStatusFile();
  const queue: PriorityEntry[] = [];
  
  for (const source of sources) {
    let status = statuses.get(source.id);
    if (!status) {
      // Ny source (t.ex. importerad via 00A) — skapa status-entry så den hamnar i kön
      status = {
        sourceId: source.id,
        status: 'never_run' as const,
        ingestionStage: 'pending' as const,
        lastRun: null,
        lastSuccess: null,
        consecutiveFailures: 0,
        lastEventsFound: 0,
        attempts: 0,
      };
      statuses.set(source.id, status);
    }
    
    let priority: number;
    let reason: string;

    // needsRecheck from source truth has highest priority
    if (source.needsRecheck) {
      priority = 1;
      reason = 'needs_recheck';
    } else if (status.status === 'never_run') {
      priority = 2;
      reason = 'never_run';
    } else if (status.status === 'pending_render_gate') {
      priority = 3;
      reason = 'pending_render_gate';
    } else if (status.status === 'triage_required') {
      priority = 3;
      reason = 'triage_required';
    } else if (status.status === 'routing_review_required') {
      priority = 3;
      reason = 'routing_review_required';
    } else if (status.status === 'pending_api_adapter' || status.status === 'pending_network_adapter') {
      priority = 4;
      reason = 'adapter_not_implemented';
    } else if (status.status === 'fail' && status.consecutiveFailures < 3) {
      priority = 4;
      reason = 'consecutive_failures';
    } else if (status.lastRun && Date.now() - new Date(status.lastRun).getTime() > 7 * 24 * 60 * 60 * 1000) {
      priority = 5;
      reason = 'revalidation_due';
    } else if (status.lastRun && Date.now() - new Date(status.lastRun).getTime() > 30 * 24 * 60 * 60 * 1000) {
      priority = 6;
      reason = 'stale_data';
    } else {
      continue; // Inte intressant just nu
    }
    
    queue.push({
      sourceId: source.id,
      priority,
      reason,
      addedAt: new Date().toISOString(),
      runsSinceAdd: 0,
    });
  }

  // Persist any new status entries created for 00A-imported sources
  writeStatusFile(statuses);

  // Sortera efter priority
  queue.sort((a, b) => a.priority - b.priority);
  writePriorityFile(queue);
  
  console.log(`[sourceRegistry] Rebuilt priority queue with ${queue.length} entries`);
}
