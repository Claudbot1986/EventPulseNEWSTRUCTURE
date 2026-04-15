/**
 * 123-Improvement-Gate — Komplett gate med 3-iteration support
 * 
 * The gate that guards the improvement pipeline.
 * Each source can have up to 3 improvement iterations.
 * Decisions are logged to memory-bank for training.
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum ImprovementDecision {
  SELECTED = 'selected',
  BLOCKED = 'blocked',
  REJECTED = 'rejected',
  KEEP = 'keep',
  ROLLBACK = 'rollback',
  REFINE = 'refine'           // New: go to next iteration
}

export enum BlockerType {
  SOURCE_EXHAUSTION = 'source_exhaustion',
  ATTRIBUTION_LOSS = 'attribution_loss',
  REGRESSION_RISK = 'regression_risk',
  SCOPE_MISMATCH = 'scope_mismatch'
}

export interface ImprovementCandidate {
  improvementId: string;
  sourceId: string;
  improvementType: string;       // IMP-C0, IMP-C1, IMP-C2, IMP-C3, IMP-SELECTOR, etc.
  description: string;
  targetFailureCategory: string;
  suggestedSelector?: string;
  suggestedPattern?: string;
  suggestedRule?: string;
  expectedImpact: 'high' | 'medium' | 'low';
  confidence: number;             // 0-1
  crossSiteVerified: boolean;     // Has this been verified across 2-3+ sites?
  generationRound: number;       // Which round generated this
}

export interface GateDecision {
  decisionId: string;
  timestamp: string;
  improvementId: string;
  sourceId: string;
  decision: ImprovementDecision;
  
  // Reasoning
  reasoningChain: string[];
  evidenceUsed: string[];
  alternativesConsidered: string[];
  
  // Blockers
  blockersActive: BlockerType[];
  blockerDetails: string[];
  
  // Context
  iterationNumber: number;        // 1, 2, or 3
  maxIterations: number;          // 3
  isFinalIteration: boolean;
  
  // Confidence
  confidenceLevel: number;        // 0-1
  
  // Prediction
  predictedOutcome: string;
  
  // Post-decision
  actualOutcome?: string;
  outcomeConfirmed: boolean;
}

export interface ImprovementAttempt {
  improvementId: string;
  sourceId: string;
  iteration: number;              // 1, 2, or 3
  
  // Pre-state
  preC3Events: number;
  preGroundTruthEvents: number;
  preGap: number;
  
  // Applied change
  changeDescription: string;
  changeType: string;
  
  // Post-state
  postC3Events: number;
  postGroundTruthEvents: number;
  postGap: number;
  
  // Verdict
  deltaEvents: number;
  gapClosed: number;
  verdict: 'verified' | 'failed' | 'partial' | 'blocked';
  
  // Attribution
  attributionConfidence: number;
  otherFactorsRuledOut: string[];
}

export interface ImprovementMemory {
  improvementId: string;
  sourceId: string;
  status: 'proposed' | 'selected' | 'testing' | 'verified' | 'rejected' | 
          'partial' | 'active' | 'deprecated' | 'exhausted';
  
  // Iterations
  iterations: Array<{
    iterationNumber: number;
    decision: ImprovementDecision;
    verificationResult?: 'passed' | 'failed' | 'partial';
    regressionResult?: 'passed' | 'failed' | 'partial';
    appliedRefinement?: string;
    timestamp: string;
  }>;
  
  // Final outcome
  finalDecision?: ImprovementDecision;
  finalTimestamp?: string;
  
  // Blockers (if any)
  activeBlockers: BlockerType[];
  blockerHistory: Array<{
    blocker: BlockerType;
    timestamp: string;
    resolved: boolean;
    resolution?: string;
  }>;
  
  // Evidence
  groundTruthEvidence: {
    preGap: number;
    postGap: number;
    gapClosedPercent: number;
  };
  
  // Attribution
  attributionConfidence: number;
  factorsRuledOut: string[];
}

// ---------------------------------------------------------------------------
// Gate Implementation
// ---------------------------------------------------------------------------

export class ImprovementGate {
  private memoryPath: string;
  private decisionsPath: string;
  private improvements: Map<string, ImprovementMemory> = new Map();
  
  constructor(basePath: string = './testResults/memory-bank') {
    this.memoryPath = join(basePath, 'improvement-memory.jsonl');
    this.decisionsPath = join(basePath, 'decisions');
    
    this.loadExistingMemory();
  }
  
  /**
   * Load existing memory
   */
  private loadExistingMemory(): void {
    if (!existsSync(this.memoryPath)) return;
    
    const lines = readFileSync(this.memoryPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const mem = JSON.parse(line) as ImprovementMemory;
        this.improvements.set(mem.improvementId, mem);
      } catch {
        // Skip malformed lines
      }
    }
  }
  
  /**
   * Check if a source already has an active improvement
   */
  hasActiveImprovement(sourceId: string): boolean {
    for (const [, mem] of this.improvements) {
      if (mem.sourceId === sourceId && 
          (mem.status === 'selected' || mem.status === 'testing' || mem.status === 'proposed')) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Get current iteration number for a source's improvement
   */
  getIterationNumber(sourceId: string): number {
    for (const [, mem] of this.improvements) {
      if (mem.sourceId === sourceId) {
        return mem.iterations.length;
      }
    }
    return 0;
  }
  
  /**
   * Check if source has exhausted all iterations
   */
  isExhausted(sourceId: string): boolean {
    for (const [, mem] of this.improvements) {
      if (mem.sourceId === sourceId && mem.status === 'exhausted') {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Make gate decision for an improvement candidate
   */
  decide(
    candidate: ImprovementCandidate,
    iterationNumber: number = 1
  ): GateDecision {
    const decisionId = `gate-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    // Rule 1: Check iteration limit
    if (iterationNumber > 3) {
      return this.makeDecision({
        decisionId,
        improvementId: candidate.improvementId,
        sourceId: candidate.sourceId,
        decision: ImprovementDecision.REJECTED,
        reasoningChain: ['Max 3 iterations reached'],
        evidenceUsed: ['iteration_number > 3'],
        alternativesConsidered: [],
        blockersActive: [BlockerType.SOURCE_EXHAUSTION],
        blockerDetails: ['Source has exhausted all 3 improvement iterations'],
        iterationNumber,
        maxIterations: 3,
        isFinalIteration: true,
        confidenceLevel: 0.95,
        predictedOutcome: 'exhausted'
      }, candidate);
    }
    
    // Rule 2: Check if source already has active improvement
    if (this.hasActiveImprovement(candidate.sourceId)) {
      return this.makeDecision({
        decisionId,
        improvementId: candidate.improvementId,
        sourceId: candidate.sourceId,
        decision: ImprovementDecision.BLOCKED,
        reasoningChain: ['Source already has active improvement'],
        evidenceUsed: ['existing_active_improvement'],
        alternativesConsidered: [],
        blockersActive: [BlockerType.ATTRIBUTION_LOSS],
        blockerDetails: ['Cannot test multiple improvements simultaneously'],
        iterationNumber,
        maxIterations: 3,
        isFinalIteration: false,
        confidenceLevel: 0.9,
        predictedOutcome: 'blocked'
      }, candidate);
    }
    
    // Rule 3: Check for scope mismatch (site-specific)
    if (!candidate.crossSiteVerified) {
      return this.makeDecision({
        decisionId,
        improvementId: candidate.improvementId,
        sourceId: candidate.sourceId,
        decision: ImprovementDecision.REJECTED,
        reasoningChain: [
          'Improvement is site-specific, not generalizable',
          'Cross-site verification required before implementation',
          'Only one domain observed for this pattern'
        ],
        evidenceUsed: ['crossSiteVerified = false'],
        alternativesConsidered: ['Find 2-3 more domains to verify pattern'],
        blockersActive: [BlockerType.SCOPE_MISMATCH],
        blockerDetails: ['Pattern only confirmed on 1 domain'],
        iterationNumber,
        maxIterations: 3,
        isFinalIteration: iterationNumber === 3,
        confidenceLevel: 0.85,
        predictedOutcome: 'rejected'
      }, candidate);
    }
    
    // Rule 4: Check confidence threshold
    if (candidate.confidence < 0.6) {
      return this.makeDecision({
        decisionId,
        improvementId: candidate.improvementId,
        sourceId: candidate.sourceId,
        decision: ImprovementDecision.REJECTED,
        reasoningChain: [
          `Confidence ${candidate.confidence} below threshold 0.6`,
          'Improvement not reliable enough for testing'
        ],
        evidenceUsed: [`confidence = ${candidate.confidence}`],
        alternativesConsidered: ['Find higher confidence candidate'],
        blockersActive: [],
        blockerDetails: [],
        iterationNumber,
        maxIterations: 3,
        isFinalIteration: iterationNumber === 3,
        confidenceLevel: candidate.confidence,
        predictedOutcome: 'rejected'
      }, candidate);
    }
    
    // Rule 5: Check expected impact
    if (candidate.expectedImpact === 'low') {
      return this.makeDecision({
        decisionId,
        improvementId: candidate.improvementId,
        sourceId: candidate.sourceId,
        decision: ImprovementDecision.REJECTED,
        reasoningChain: [
          `Expected impact is ${candidate.expectedImpact}`,
          'Not worth the testing cost'
        ],
        evidenceUsed: [`expectedImpact = ${candidate.expectedImpact}`],
        alternativesConsidered: ['Find higher impact candidate'],
        blockersActive: [],
        blockerDetails: [],
        iterationNumber,
        maxIterations: 3,
        isFinalIteration: iterationNumber === 3,
        confidenceLevel: candidate.confidence,
        predictedOutcome: 'rejected'
      }, candidate);
    }
    
    // Default: SELECT
    return this.makeDecision({
      decisionId,
      improvementId: candidate.improvementId,
      sourceId: candidate.sourceId,
      decision: ImprovementDecision.SELECTED,
      reasoningChain: [
        'Candidate passed all gate rules',
        `Confidence ${candidate.confidence} above threshold`,
        `Expected impact ${candidate.expectedImpact}`,
        'Cross-site verified',
        'No blockers active'
      ],
      evidenceUsed: [
        `confidence = ${candidate.confidence}`,
        `expectedImpact = ${candidate.expectedImpact}`,
        `crossSiteVerified = ${candidate.crossSiteVerified}`
      ],
      alternativesConsidered: [],
      blockersActive: [],
      blockerDetails: [],
      iterationNumber,
      maxIterations: 3,
      isFinalIteration: false,
      confidenceLevel: candidate.confidence,
      predictedOutcome: 'testing'
    }, candidate);
  }
  
  /**
   * Evaluate verification + regression results and make keep/refine/rollback decision
   */
  evaluateResults(
    improvementId: string,
    verificationResult: 'passed' | 'failed' | 'partial',
    regressionResult: 'passed' | 'failed' | 'partial',
    gapClosed: number,
    deltaEvents: number
  ): GateDecision {
    const decisionId = `gate-result-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    
    const mem = this.improvements.get(improvementId);
    const sourceId = mem?.sourceId || 'unknown';
    const iteration = mem?.iterations.length || 1;
    
    // KEEP: verification passed and regression passed
    if (verificationResult === 'passed' && regressionResult === 'passed') {
      return this.makeDecision({
        decisionId,
        improvementId,
        sourceId,
        decision: ImprovementDecision.KEEP,
        reasoningChain: [
          'Verification batch passed',
          'Regression batch passed',
          `Gap closed: ${gapClosed}%`,
          `Delta events: ${deltaEvents}`
        ],
        evidenceUsed: [
          `verificationResult = ${verificationResult}`,
          `regressionResult = ${regressionResult}`,
          `gapClosed = ${gapClosed}`
        ],
        alternativesConsidered: [],
        blockersActive: [],
        blockerDetails: [],
        iterationNumber: iteration,
        maxIterations: 3,
        isFinalIteration: false,
        confidenceLevel: 0.9,
        predictedOutcome: 'active'
      }, undefined);
    }
    
    // REFINE: partial success or needs iteration
    if (verificationResult === 'partial' || (verificationResult === 'passed' && regressionResult === 'partial')) {
      if (iteration < 3) {
        return this.makeDecision({
          decisionId,
          improvementId,
          sourceId,
          decision: ImprovementDecision.REFINE,
          reasoningChain: [
            `Verification: ${verificationResult}`,
            `Regression: ${regressionResult}`,
            'Partial success - refining for next iteration',
            `Gap closed so far: ${gapClosed}%`
          ],
          evidenceUsed: [
            `verificationResult = ${verificationResult}`,
            `regressionResult = ${regressionResult}`
          ],
          alternativesConsidered: ['Rollback and try different approach'],
          blockersActive: [],
          blockerDetails: [],
          iterationNumber: iteration,
          maxIterations: 3,
          isFinalIteration: false,
          confidenceLevel: 0.7,
          predictedOutcome: 'refine-and-retry'
        }, undefined);
      } else {
        // Final iteration, partial is not enough
        return this.makeDecision({
          decisionId,
          improvementId,
          sourceId,
          decision: ImprovementDecision.ROLLBACK,
          reasoningChain: [
            'Final iteration (3)',
            `Partial results but not enough for keep`,
            `Verification: ${verificationResult}`,
            `Regression: ${regressionResult}`
          ],
          evidenceUsed: [],
          alternativesConsidered: [],
          blockersActive: [],
          blockerDetails: [],
          iterationNumber: iteration,
          maxIterations: 3,
          isFinalIteration: true,
          confidenceLevel: 0.8,
          predictedOutcome: 'rejected'
        }, undefined);
      }
    }
    
    // ROLLBACK: failed verification or regression
    if (verificationResult === 'failed') {
      return this.makeDecision({
        decisionId,
        improvementId,
        sourceId,
        decision: ImprovementDecision.ROLLBACK,
        reasoningChain: [
          'Verification batch failed',
          'Improvement does not work on this failure category'
        ],
        evidenceUsed: [`verificationResult = failed`],
        alternativesConsidered: ['Try different improvement type'],
        blockersActive: [BlockerType.ATTRIBUTION_LOSS],
        blockerDetails: ['Verification failed - cannot attribute to improvement'],
        iterationNumber: iteration,
        maxIterations: 3,
        isFinalIteration: true,
        confidenceLevel: 0.95,
        predictedOutcome: 'rejected'
      }, undefined);
    }
    
    if (regressionResult === 'failed') {
      return this.makeDecision({
        decisionId,
        improvementId,
        sourceId,
        decision: ImprovementDecision.ROLLBACK,
        reasoningChain: [
          'Regression batch failed',
          'Improvement works on training set but not on new sources',
          'Not generalizable'
        ],
        evidenceUsed: [`regressionResult = failed`],
        alternativesConsidered: ['Try with different scope'],
        blockersActive: [BlockerType.SCOPE_MISMATCH],
        blockerDetails: ['Not generalizable to new sources'],
        iterationNumber: iteration,
        maxIterations: 3,
        isFinalIteration: true,
        confidenceLevel: 0.95,
        predictedOutcome: 'rejected'
      }, undefined);
    }
    
    // Fallback
    return this.makeDecision({
      decisionId,
      improvementId,
      sourceId,
      decision: ImprovementDecision.ROLLBACK,
      reasoningChain: ['Unexpected result combination'],
      evidenceUsed: [],
      alternativesConsidered: [],
      blockersActive: [],
      blockerDetails: [],
      iterationNumber: iteration,
      maxIterations: 3,
      isFinalIteration: true,
      confidenceLevel: 0.5,
      predictedOutcome: 'unknown'
    }, undefined);
  }
  
  /**
   * Update memory with new decision
   */
  private makeDecision(
    decision: GateDecision,
    candidate?: ImprovementCandidate
  ): GateDecision {
    // Log to decisions file
    appendFileSync(this.memoryPath, JSON.stringify(decision) + '\n');
    
    // Update or create improvement memory
    let mem = this.improvements.get(decision.improvementId);
    
    if (!mem && candidate) {
      mem = {
        improvementId: candidate.improvementId,
        sourceId: candidate.sourceId,
        status: 'proposed',
        iterations: [],
        activeBlockers: decision.blockersActive,
        blockerHistory: decision.blockersActive.map(b => ({
          blocker: b,
          timestamp: decision.timestamp,
          resolved: false
        })),
        groundTruthEvidence: {
          preGap: 0,
          postGap: 0,
          gapClosedPercent: 0
        },
        attributionConfidence: decision.confidenceLevel,
        factorsRuledOut: decision.reasoningChain
      };
    }
    
    if (mem) {
      // Add iteration record
      mem.iterations.push({
        iterationNumber: decision.iterationNumber,
        decision: decision.decision,
        timestamp: decision.timestamp
      });
      
      // Update status based on decision
      switch (decision.decision) {
        case ImprovementDecision.SELECTED:
          mem.status = 'selected';
          break;
        case ImprovementDecision.BLOCKED:
          mem.status = 'blocked';
          break;
        case ImprovementDecision.REJECTED:
          mem.status = 'rejected';
          break;
        case ImprovementDecision.KEEP:
          mem.status = 'active';
          mem.finalDecision = ImprovementDecision.KEEP;
          mem.finalTimestamp = decision.timestamp;
          break;
        case ImprovementDecision.ROLLBACK:
          mem.finalDecision = ImprovementDecision.ROLLBACK;
          mem.finalTimestamp = decision.timestamp;
          break;
        case ImprovementDecision.REFINE:
          mem.status = 'testing';
          break;
      }
      
      this.improvements.set(decision.improvementId, mem);
    }
    
    // Write to decision-specific file
    const decisionFile = join(this.decisionsPath, `${decision.decisionId}.jsonl`);
    appendFileSync(decisionFile, JSON.stringify(decision) + '\n');
    
    return decision;
  }
  
  /**
   * Log improvement attempt results
   */
  logAttempt(attempt: ImprovementAttempt): void {
    // Update improvement memory with results
    const mem = this.improvements.get(attempt.improvementId);
    if (mem) {
      mem.groundTruthEvidence = {
        preGap: attempt.preGap,
        postGap: attempt.postGap,
        gapClosedPercent: attempt.preGap > 0 ? ((attempt.preGap - attempt.postGap) / attempt.preGap) * 100 : 0
      };
      
      if (attempt.verdict === 'verified') {
        // Mark current iteration as having verification
        const currentIter = mem.iterations[mem.iterations.length - 1];
        if (currentIter) {
          currentIter.verificationResult = 'passed';
        }
      }
      
      this.improvements.set(attempt.improvementId, mem);
    }
    
    // Write to attempts file
    const attemptsPath = './testResults/improvement-candidates/attempts.jsonl';
    appendFileSync(attemptsPath, JSON.stringify(attempt) + '\n');
  }
  
  /**
   * Get status of all improvements
   */
  getStatus(): {
    active: number;
    proposed: number;
    testing: number;
    active_count: number;
    exhausted: number;
    rejected: number;
  } {
    let active = 0, proposed = 0, testing = 0, active_count = 0, exhausted = 0, rejected = 0;
    
    for (const [, mem] of this.improvements) {
      switch (mem.status) {
        case 'proposed': proposed++; break;
        case 'selected': active++; break;
        case 'testing': testing++; break;
        case 'active': active_count++; break;
        case 'exhausted': exhausted++; break;
        case 'rejected': rejected++; break;
      }
    }
    
    return { active, proposed, testing, active_count, exhausted, rejected };
  }
  
  /**
   * Check if we should recommend implementation
   */
  shouldRecommendImplementation(): boolean {
    let keeps = 0, total = 0;
    
    for (const [, mem] of this.improvements) {
      if (mem.finalDecision === ImprovementDecision.KEEP) {
        keeps++;
      }
      if (mem.finalDecision) {
        total++;
      }
    }
    
    // Recommend if 2+ keeps with high attribution confidence
    return keeps >= 2 && keeps / total > 0.6;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createImprovementGate(): ImprovementGate {
  return new ImprovementGate();
}