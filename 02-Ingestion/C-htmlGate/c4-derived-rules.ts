/**
 * C4 — Derived Rules Layer
 *
 * Persistent derived rules extracted from C4-AI analysis rounds.
 * Acts as a learned-memory layer between C4-AI and future pool rounds.
 *
 * Rule format:
 *   - sourceId:      which source the rule applies to
 *   - failCategory:  why it fails (FailCategory enum)
 *   - suggestedPaths:  path suggestions for NEEDS_SUBPAGE_DISCOVERY
 *   - suggestedQueue:  next queue routing
 *   - confidence:     derived confidence 0–1
 *   - createdAt:      ISO timestamp
 *
 * File layout: reports/batch-{N}/c4-derived-rules.jsonl
 * One JSON object per line.
 */

import { FailCategory } from './C4-ai-analysis';
import { writeFileSync, appendFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const REPORTS_DIR = join(__dirname, 'reports');
const IMPROVEMENTS_BANK_PATH = join(REPORTS_DIR, 'improvements-bank.jsonl');

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

export interface C4DerivedRule {
  sourceId: string;
  failCategory: FailCategory;
  suggestedPaths: string[];   // e.g. ["/events", "/program", "/kalender"]
  suggestedRules: string[];   // generic AI rules (not site-specific)
  suggestedQueue: 'UI' | 'A' | 'B' | 'D' | 'manual-review' | 'retry-pool';
  confidence: number;          // 0–1
  createdAt: string;           // ISO
  roundNumber?: number;        // which C4 round derived this rule
  batchId?: string;
  // NEW (2026-04-14): C4's candidate rule for C0-C3 improvement
  candidateRuleForC0C3?: {
    pathPattern: string;       // e.g. "/events|/kalender|/program"
    appliesTo: string;        // e.g. "Swedish municipal sites"
    confidence: number;         // 0–1
    sourceExamples: string[];  // source IDs that share this pattern
  };
}

/** Key = sourceId+FailCategory, value = rule */
export type DerivedRulesStore = Map<string, C4DerivedRule>;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function rulesFilePath(batchNum: number): string {
  return join(REPORTS_DIR, `batch-${batchNum}`, 'c4-derived-rules.jsonl');
}

function ensureDir(batchNum: number): void {
  mkdirSync(join(REPORTS_DIR, `batch-${batchNum}`), { recursive: true });
}

// ---------------------------------------------------------------------------
// Save: append a single rule to the current batch file
// ---------------------------------------------------------------------------

export function saveDerivedRule(rule: C4DerivedRule, batchNum: number): void {
  ensureDir(batchNum);
  const path = rulesFilePath(batchNum);

  // Deduplicate: skip if sourceId+failCategory already exists in this batch file
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) {
      const lines = existing.split('\n');
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as C4DerivedRule;
          if (parsed.sourceId === rule.sourceId && parsed.failCategory === rule.failCategory) {
            // Higher or equal confidence already saved — skip
            if (parsed.confidence >= rule.confidence) {
              console.log(`[C4-DerivedRules] Skipped duplicate (lower/equal confidence) for ${rule.sourceId} → ${rule.failCategory}`);
              return;
            }
            // Lower confidence — overwrite by removing old line and appending new
            console.log(`[C4-DerivedRules] Upgrading rule for ${rule.sourceId} → ${rule.failCategory} (conf ${parsed.confidence} → ${rule.confidence})`);
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  } catch {
    // file doesn't exist yet — proceed to write
  }

  const line = JSON.stringify(rule);
  appendFileSync(path, line + '\n');
  if (rule.suggestedRules.length > 0) {
    console.log(`[C4-DerivedRules] SAVED (+suggestedRules) for ${rule.sourceId} → ${rule.failCategory} (conf=${rule.confidence})`);
    console.log(`[C4-DerivedRules]   suggestedRules: [${rule.suggestedRules.join(', ')}]`);
  } else {
    console.log(`[C4-DerivedRules] Saved rule for ${rule.sourceId} → ${rule.failCategory} (conf=${rule.confidence})`);
  }
}

// ---------------------------------------------------------------------------
// Load: read all rules from a specific batch file
// ---------------------------------------------------------------------------

export function loadDerivedRulesFromBatch(batchNum: number): C4DerivedRule[] {
  const path = rulesFilePath(batchNum);
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').map(line => JSON.parse(line) as C4DerivedRule);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Load: aggregate rules from ALL batches up to and including a batch number
// ---------------------------------------------------------------------------

export function loadAllDerivedRules(upToBatch: number): DerivedRulesStore {
  const store: DerivedRulesStore = new Map();

  for (let b = 1; b <= upToBatch; b++) {
    const rules = loadDerivedRulesFromBatch(b);
    for (const rule of rules) {
      const key = `${rule.sourceId}__${rule.failCategory}`;
      // Keep highest-confidence rule per source+category
      const existing = store.get(key);
      if (!existing || rule.confidence > existing.confidence) {
        store.set(key, rule);
      }
    }
  }

  return store;
}

// ---------------------------------------------------------------------------
// Query: get rules for a specific source
// ---------------------------------------------------------------------------

export function getRulesForSource(
  store: DerivedRulesStore,
  sourceId: string
): C4DerivedRule[] {
  const result: C4DerivedRule[] = [];
  for (const rule of store.values()) {
    if (rule.sourceId === sourceId) result.push(rule);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Query: get highest-confidence rule for source+category combo
// ---------------------------------------------------------------------------

export function getRuleForSourceCategory(
  store: DerivedRulesStore,
  sourceId: string,
  failCategory: FailCategory
): C4DerivedRule | null {
  const key = `${sourceId}__${failCategory}`;
  return store.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Generic fallback paths for NEEDS_SUBPAGE_DISCOVERY (from improvements-bank)
// Extracted from c4-derived-rules.jsonl entries that share common paths
// Used as fallback when no source-specific rule exists
// ---------------------------------------------------------------------------

const GENERIC_SUBPAGE_PATHS = ['/events', '/program', '/kalender', '/schema'];

const IGNORE_PATTERNS = [
  'nyheter', 'press', 'kontakt', 'om-oss', 'om-os', 'login', 'logga-in',
  'policy', 'privacy', 'cookies', 'gdpr', 'social', 'facebook', 'instagram',
  'twitter', 'linkedin', 'youtube', 'spotify', 'soundcloud', 'arkiv',
];

/**
 * Extracts specific paths from AI-generated suggestedRules.
 * Parses rules like "test /biljetter directly" or "try /fotboll/matcher as subpage"
 * to extract the actual URL paths.
 *
 * Falls back to GENERIC_SUBPAGE_PATHS only if no specific paths can be extracted.
 */
function extractSpecificPathsFromRules(suggestedRules: string[], failCategory: FailCategory): string[] {
  if (failCategory !== FailCategory.NEEDS_SUBPAGE_DISCOVERY) {
    return [];
  }

  const extractedPaths: string[] = [];
  const pathPattern = /\b(\/[a-z0-9\-\_/]+)\b/gi;

  for (const rule of suggestedRules) {
    // Look for path-like patterns in the rule string
    const matches = rule.match(pathPattern);
    if (matches) {
      for (const path of matches) {
        const normalized = path.toLowerCase();
        // Filter out generic ignore patterns and too-short paths
        if (normalized.length > 2 && !IGNORE_PATTERNS.some(p => normalized.includes(p))) {
          // Deduplicate
          if (!extractedPaths.includes(normalized)) {
            extractedPaths.push(normalized);
          }
        }
      }
    }
  }

  // If we found specific paths, return them (deduped, max 6)
  if (extractedPaths.length > 0) {
    console.log(`[C4-DerivedRules] Extracted ${extractedPaths.length} specific paths from suggestedRules: [${extractedPaths.join(', ')}]`);
    return extractedPaths.slice(0, 6);
  }

  // Fallback to generic only if nothing specific was found
  console.log(`[C4-DerivedRules] No specific paths from suggestedRules — using generic fallback`);
  return GENERIC_SUBPAGE_PATHS;
}

// ---------------------------------------------------------------------------
// Public fallback: generic Swedish paths for NEEDS_SUBPAGE_DISCOVERY
// Used by C1-preHtmlGate as fallback when no source-specific rule exists
// ---------------------------------------------------------------------------

export function getGenericSubpagePaths(failCategory: FailCategory): string[] {
  if (failCategory === FailCategory.NEEDS_SUBPAGE_DISCOVERY) {
    return GENERIC_SUBPAGE_PATHS;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Convert C4AnalysisResult → C4DerivedRule
// ---------------------------------------------------------------------------

import type { C4AnalysisResult } from './C4-ai-analysis';

export function deriveRuleFromAnalysis(
  result: C4AnalysisResult,
  roundNumber: number,
  batchId: string
): C4DerivedRule {
  // Use structured discoveredPaths from AI — not extracted from free-text suggestedRules
  // discoveredPaths contains exact paths discovered from C0 links on THIS source
  let specificPaths: string[] = [];

  if (result.discoveredPaths && result.discoveredPaths.length > 0) {
    // Sort by confidence descending, take top 6
    const sorted = [...result.discoveredPaths].sort((a, b) => b.confidence - a.confidence);
    specificPaths = sorted.slice(0, 6).map(dp => dp.path);
    console.log(`[C4-DerivedRules] Using ${specificPaths.length} structured discoveredPaths for ${result.sourceId}: [${specificPaths.join(', ')}]`);
  }

  // Fallback: only if discoveredPaths is empty, try extracting from suggestedRules (less reliable)
  if (specificPaths.length === 0 && result.suggestedRules.length > 0) {
    const extracted = extractSpecificPathsFromRules(result.suggestedRules, result.failCategory);
    if (extracted.length > 0) {
      specificPaths = extracted;
      console.log(`[C4-DerivedRules] discoveredPaths empty — fell back to extracted from suggestedRules: [${specificPaths.join(', ')}]`);
    }
  }

  // NEW (2026-04-14): Include candidateRuleForC0C3 if present
  // This is how C4's human-like discovery gets connected to actual C0/C1/C2/C3 changes
  const candidateRuleForC0C3 = result.candidateRuleForC0C3
    ? {
        pathPattern: result.candidateRuleForC0C3.pathPattern,
        appliesTo: result.candidateRuleForC0C3.appliesTo,
        confidence: result.candidateRuleForC0C3.confidence,
        sourceExamples: [result.sourceId],
      }
    : undefined;

  return {
    sourceId: result.sourceId,
    failCategory: result.failCategory,
    suggestedPaths: specificPaths,
    suggestedRules: result.suggestedRules,
    suggestedQueue: result.nextQueue,
    confidence: result.failCategoryConfidence,
    createdAt: new Date().toISOString(),
    roundNumber,
    batchId,
    candidateRuleForC0C3,
  };
}

// ---------------------------------------------------------------------------
// Persist all rules from a C4 round in one call
// ---------------------------------------------------------------------------

export function saveRoundDerivedRules(
  results: C4AnalysisResult[],
  roundNumber: number,
  batchId: string,
  batchNum: number
): C4DerivedRule[] {
  const rules = results.map(r => deriveRuleFromAnalysis(r, roundNumber, batchId));
  for (const rule of rules) {
    saveDerivedRule(rule, batchNum);
    console.log(`[Learning-Loop-SAVE] batch-${batchNum} round-${roundNumber}: SAVED derived rule → ${rule.sourceId} (${rule.failCategory}, conf=${rule.confidence}, paths=[${rule.suggestedPaths.join(',')}])`);
  }
  console.log(`[Learning-Loop] Saved ${rules.length} rules from round ${roundNumber}, batch ${batchId}`);
  return rules;
}

// ---------------------------------------------------------------------------
// Improvement Bank — drives which improvements are active in the code
// ---------------------------------------------------------------------------

export interface Improvement {
  stableId: string;
  name: string;
  description: string;
  problemType: string;
  affectedPatterns: string[];
  supportedByBatches: string[];
  generalizable: boolean;
  siteSpecificRisk: string;
  status: 'candidate' | 'proposed' | 'tested' | 'validated' | 'partial' | 'rejected' | 'deprecated';
  createdAt: string;
  notes: string;
  evidenceType: string;
  lastValidatedAt: string | null;
  /** Whether this improvement is currently active in the code */
  enabled: boolean;
}

export type ImprovementBank = Map<string, Improvement>;

let _cachedBank: ImprovementBank | null = null;

/**
 * Load the improvements bank from improvements-bank.jsonl.
 * Results are cached — call invalidateImprovementBankCache() to force reload.
 */
export function loadImprovementsBank(): ImprovementBank {
  if (_cachedBank) return _cachedBank;

  const bank: ImprovementBank = new Map();
  try {
    const raw = readFileSync(IMPROVEMENTS_BANK_PATH, 'utf8').trim();
    if (raw) {
      const lines = raw.split('\n');
      for (const line of lines) {
        try {
          const imp = JSON.parse(line) as Improvement;
          bank.set(imp.stableId, imp);
        } catch {
          // skip malformed lines
        }
      }
    }
    console.log(`[ImprovementBank] Loaded ${bank.size} improvements`);
    _cachedBank = bank;
  } catch (err) {
    console.warn(`[ImprovementBank] Failed to load: ${(err as Error).message}`);
  }

  return bank;
}

/**
 * Check if a specific improvement is currently enabled.
 * Uses cached bank — reload by calling invalidateImprovementBankCache().
 */
export function isImprovementEnabled(stableId: string): boolean {
  const bank = loadImprovementsBank();
  const imp = bank.get(stableId);
  return imp?.enabled ?? false;
}

/**
 * Invalidate the cached improvement bank. Call this after writing to
 * improvements-bank.jsonl to ensure the next call reloads from disk.
 */
export function invalidateImprovementBankCache(): void {
  _cachedBank = null;
}

// ---------------------------------------------------------------------------
// NEW (2026-04-14): Propose candidateRuleForC0C3 as improvements
// This is the bridge from C4's human-like discovery to actual C0/C1/C2/C3 changes
// ---------------------------------------------------------------------------

let _improvementIdCounter = 0;
function getNextImprovementId(): string {
  _improvementIdCounter++;
  return `C4-IMP-${Date.now()}-${_improvementIdCounter}`;
}

/**
 * Scan c4-derived-rules.jsonl for entries with candidateRuleForC0C3
 * that are NOT already in improvements-bank, and propose them as candidates.
 *
 * This is how C4's human-like discovery gets connected to the 123-loop:
 *   candidateRuleForC0C3 → improvements-bank → 123-improvement-gate → verified → C0/C1/C2/C3 change
 */
export function proposeCandidateRulesAsImprovements(
  batchNum: number,
  minConfidence: number = 0.70
): { proposed: number; skipped: number; errors: string[] } {
  const results = { proposed: 0, skipped: 0, errors: [] as string[] };

  // Load existing improvements bank to check for duplicates
  const bank = loadImprovementsBank();
  const existingPatterns = new Set(
    Array.from(bank.values())
      .filter(i => i.evidenceType === 'C4-candidateRuleForC0C3')
      .map(i => i.name)
  );

  // Load rules from this batch
  const rules = loadDerivedRulesFromBatch(batchNum);

  for (const rule of rules) {
    if (!rule.candidateRuleForC0C3) continue;
    if (rule.confidence < minConfidence) {
      results.skipped++;
      continue;
    }

    const cr = rule.candidateRuleForC0C3;
    const impName = `C4:${rule.sourceId}:${cr.pathPattern}`;

    // Skip if already in improvements bank
    if (existingPatterns.has(impName)) {
      results.skipped++;
      continue;
    }

    try {
      const improvement: Improvement = {
        stableId: getNextImprovementId(),
        name: impName,
        description: `C4 human-like discovery: path pattern "${cr.pathPattern}" applies to: ${cr.appliesTo}. Source: ${rule.sourceId}`,
        problemType: rule.failCategory === 'ENTRY_PAGE_NO_EVENTS' ? 'discovery_failure' : 'extraction_failure',
        affectedPatterns: [cr.pathPattern],
        supportedByBatches: [`batch-${batchNum}`],
        generalizable: true,
        siteSpecificRisk: cr.appliesTo.includes('Swedish') ? 'low' : 'medium',
        status: 'candidate',
        createdAt: new Date().toISOString(),
        notes: `Generated from C4 candidateRuleForC0C3. discoveryAttempted=true, humanLikeDiscoveryReasoning available in c4-ai-analysis-round-X.md`,
        evidenceType: 'C4-candidateRuleForC0C3',
        lastValidatedAt: null,
        enabled: false,
      };

      appendFileSync(IMPROVEMENTS_BANK_PATH, JSON.stringify(improvement) + '\n');
      results.proposed++;
      console.log(`[C4-ImprovementProposal] Proposed: ${impName} (confidence=${rule.confidence})`);
    } catch (err) {
      results.errors.push(`Failed to save improvement for ${rule.sourceId}: ${(err as Error).message}`);
    }
  }

  if (results.proposed > 0) {
    invalidateImprovementBankCache();
    console.log(`[C4-ImprovementProposal] Proposed ${results.proposed} improvements from batch-${batchNum}`);
  }

  return results;
}
