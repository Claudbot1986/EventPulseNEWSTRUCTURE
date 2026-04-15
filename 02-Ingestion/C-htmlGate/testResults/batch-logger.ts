/**
 * Batch Logger — Skriver kompletta batch-rapporter för training memory
 * 
 * Schema设计 för djupinlärning:
 * - Alla features är numeriska där möjligt
 * - Alla labels är explicita
 * - Full traceability från input till output
 * - Ground truth interleafed med predictions för gap-analysis
 */

import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchFeatureVector {
  // Metadata
  batchId: string;
  roundNumber: number;
  timestamp: string;
  
  // Source composition
  totalSources: number;
  sourcesByCategory: Record<string, number>;
  
  // Pipeline performance
  c1RunDuration: number;        // ms
  c2RunDuration: number;        // ms
  c3RunDuration: number;        // ms
  c4RunDuration: number;        // ms
  totalPipelineDuration: number; // ms
  
  // Outcome distribution
  successCount: number;
  failureCount: number;
  routingCount: number;         // A/B/D routes
  manualReviewCount: number;
  
  // Gap analysis (C3 vs C4-AI ground truth)
  groundTruthEventsTotal: number;
  c3ExtractedEventsTotal: number;
  gapEventsTotal: number;
  gapSourcesCount: number;       // How many sources had gaps
  gapRatio: number;             // gapEventsTotal / groundTruthEventsTotal
  
  // Improvement candidates generated
  improvementCandidatesCount: number;
  improvementCandidatesByType: Record<string, number>;
  
  // Verification results (from this batch)
  verificationPassedCount: number;
  verificationFailedCount: number;
  verificationPartialCount: number;
  
  // Regression results (from this batch)
  regressionPassedCount: number;
  regressionFailedCount: number;
  
  // Feature: failure category distribution
  discoveryFailureRate: number;     // 0-1
  screeningFailureRate: number;      // 0-1
  extractionFailureRate: number;     // 0-1
  groundTruthGapRate: number;        // 0-1
  networkFailureRate: number;        // 0-1
  
  // Feature: pool dynamics
  poolRefillCount: number;
  poolExhaustionRate: number;       // sources exhausted / total
  avgRoundsPerSource: number;
  sourcesMaxedRounds: number;         // hit 3 rounds
  
  // Feature: improvement gate decisions
  gateSelectedCount: number;
  gateBlockedCount: number;
  gateRejectedCount: number;
  activeBlockers: string[];
  
  // Feature: temporal patterns
  hourOfDay: number;
  dayOfWeek: number;
  isWeekend: boolean;
}

export interface BatchImprovementAttempt {
  improvementId: string;
  sourceId: string;
  improvementType: string;         // IMP-C0, IMP-C1, IMP-C2, IMP-C3, IMP-SELECTOR, etc.
  description: string;
  targetFailureCategory: string;
  
  // Pre-change baseline
  baselineC3Score: number;
  baselineEvents: number;
  baselineGroundTruthEvents: number;
  
  // Post-change result
  afterC3Score: number;
  afterEvents: number;
  afterGroundTruthEvents: number;
  
  // Verdict
  verdict: 'verified' | 'failed' | 'partial' | 'blocked';
  deltaEvents: number;             // afterEvents - baselineEvents
  deltaGroundTruth: number;        // afterGroundTruthEvents - baselineGroundTruthEvents
  gapClosed: number;              // baselineGap - afterGap (positive = improvement)
  confidence: number;              // 0-1
  
  // Attribution
  attributionConfidence: number;   // How certain we are this improvement caused the change
  otherFactorsRuledOut: string[];
  
  // Round info
  roundNumber: number;
  attemptNumber: number;          // 1, 2, or 3 within the batch
}

export interface BatchDecisionLog {
  decisionId: string;
  timestamp: string;
  batchId: string;
  roundNumber: number;
  
  // Decision type
  decisionType: 'gate_select' | 'gate_block' | 'gate_reject' | 'verification_pass' | 'verification_fail' | 
               'regression_pass' | 'regression_fail' | 'improvement_keep' | 'improvement_rollback' |
               'source_route' | 'pool_refill' | 'stop_reason';
  
  // What was decided
  target: string;                  // improvementId, sourceId, or poolId
  decision: string;                // selected, blocked, rejected, keep, rollback, etc.
  
  // Reasoning
  reasoningChain: string[];       // Ordered list of reasoning steps
  evidenceUsed: string[];          // What data was used to make decision
  
  // Blocker info (if applicable)
  blockersActive: string[];
  
  // Outcome prediction
  predictedOutcome: string;
  confidenceLevel: number;        // 0-1
  
  // Actual outcome (filled later)
  actualOutcome?: string;
  outcomeConfirmed: boolean;
}

export interface BatchReport {
  batchId: string;
  sessionId: string;
  timestamp: string;
  roundNumber: number;
  
  // Summary statistics
  features: BatchFeatureVector;
  
  // Per-source results
  sourceResults: SourceResultSummary[];
  
  // Improvement attempts this batch
  improvementAttempts: BatchImprovementAttempt[];
  
  // Decision log
  decisions: BatchDecisionLog[];
  
  // Gap analysis per source
  gapAnalysis: GapAnalysisEntry[];
  
  // Pool state at end of batch
  poolState: PoolStateSummary;
  
  // Recommendations for next batch
  recommendations: string[];
  
  // Metadata for training
  trainingMetadata: {
    isTrainingBatch: boolean;
    groundTruthAvailable: boolean;
    labelsGenerated: boolean;
    exportable: boolean;
  };
}

export interface SourceResultSummary {
  sourceId: string;
  url: string;
  category: string;
  
  // Pipeline results
  c1Outcome: string;
  c2Score: number;
  c2Verdict: string;
  c3Events: number;
  c4GroundTruthEvents: number;
  
  // Gap
  hasGap: boolean;
  gapSize: number;
  gapClosedByImprovement: boolean;
  
  // Exit
  exitReason: string;
  exitQueue: string;
  roundsParticipated: number;
}

export interface GapAnalysisEntry {
  sourceId: string;
  url: string;
  
  // What C4-AI found
  groundTruthEvents: number;
  groundTruthEventList: GroundTruthEvent[];
  
  // What C3 extracted
  c3Events: number;
  c3EventList: C3Event[];
  
  // Gap analysis
  gapSize: number;
  gapReasons: string[];           // Why did C3 fail to find these events?
  
  // Root cause classification
  rootCauseCategory: string;      // selector_miss, date_format_miss, path_miss, etc.
  rootCauseConfidence: number;
  
  // Improvement that attempted to fix
  improvementId?: string;
  improvementType?: string;
  gapClosedAfterImprovement?: number;
  
  // Feature flags for training
  hasTimeTag: boolean;
  hasDatePattern: boolean;
  hasEventLinks: boolean;
  hasRepeatingBlocks: boolean;
  isSwedishSite: boolean;
  hasJsonLd: boolean;
  jsonLdHasEvents: boolean;
  requiresJsRender: boolean;
  hasSubpageCandidates: boolean;
}

export interface GroundTruthEvent {
  title: string;
  date: string;
  time?: string;
  venue?: string;
  url?: string;
  ticketUrl?: string;
  selectors: string[];           // Which DOM selectors contain this event
  confidence: number;             // 0-1
  reasoning: string;
}

export interface C3Event {
  title: string;
  date?: string;
  time?: string;
  venue?: string;
  url?: string;
  matchedSelector?: string;
  matchedPattern?: string;
}

export interface PoolStateSummary {
  activeSources: string[];
  sourcesExhausted: number;
  sourcesSuccess: number;
  sourcesRouted: number;
  sourcesManualReview: number;
  avgRoundsParticipated: number;
  stopReason: string;
  nextAction: string;
}

// ---------------------------------------------------------------------------
// Batch Logger
// ---------------------------------------------------------------------------

export class BatchLogger {
  private batchDir: string;
  private batchId: string;
  private roundNumber: number;
  
  constructor(batchId: string, roundNumber: number, baseDir: string = './testResults/batches') {
    this.batchId = batchId;
    this.roundNumber = roundNumber;
    this.batchDir = join(baseDir, batchId);
    mkdirSync(this.batchDir, { recursive: true });
  }
  
  /**
   * Initialize a new batch report
   */
  initBatch(features: BatchFeatureVector): void {
    const report: BatchReport = {
      batchId: this.batchId,
      sessionId: this.generateSessionId(),
      timestamp: new Date().toISOString(),
      roundNumber: this.roundNumber,
      features,
      sourceResults: [],
      improvementAttempts: [],
      decisions: [],
      gapAnalysis: [],
      poolState: {
        activeSources: [],
        sourcesExhausted: 0,
        sourcesSuccess: 0,
        sourcesRouted: 0,
        sourcesManualReview: 0,
        avgRoundsParticipated: 0,
        stopReason: '',
        nextAction: ''
      },
      recommendations: [],
      trainingMetadata: {
        isTrainingBatch: true,
        groundTruthAvailable: true,
        labelsGenerated: true,
        exportable: true
      }
    };
    
    this.writeJson('batch-report.json', report);
    
    // Write feature vector for ML training
    this.writeJson('feature-vector.json', features);
    
    // Write binary-compatible training record
    this.writeTrainingRecord(features);
  }
  
  /**
   * Log a source result
   */
  logSourceResult(result: SourceResultSummary): void {
    this.appendToFile('source-results.jsonl', JSON.stringify(result) + '\n');
  }
  
  /**
   * Log an improvement attempt
   */
  logImprovementAttempt(attempt: BatchImprovementAttempt): void {
    this.appendToFile('improvement-attempts.jsonl', JSON.stringify(attempt) + '\n');
    
    // Also write to improvement-candidates/
    const impDir = join('./testResults/improvement-candidates', attempt.improvementId);
    mkdirSync(impDir, { recursive: true });
    this.writeJson(join(impDir, `round-${this.roundNumber}-attempt-${attempt.attemptNumber}.json`), attempt);
  }
  
  /**
   * Log a decision
   */
  logDecision(decision: BatchDecisionLog): void {
    this.appendToFile('decisions.jsonl', JSON.stringify(decision) + '\n');
    
    // Append to memory-bank/decisions/
    const decisionFile = join('./testResults/memory-bank/decisions', `${decision.decisionId}.jsonl`);
    appendFileSync(decisionFile, JSON.stringify(decision) + '\n');
  }
  
  /**
   * Log a gap analysis entry
   */
  logGapAnalysis(entry: GapAnalysisEntry): void {
    this.appendToFile('gap-analysis.jsonl', JSON.stringify(entry) + '\n');
    
    // Write to ground-truth/ for training
    const gtDir = join('./testResults/ground-truth', entry.sourceId);
    mkdirSync(gtDir, { recursive: true });
    this.writeJson(join(gtDir, `gap-analysis-round-${this.roundNumber}.json`), entry);
  }
  
  /**
   * Finalize batch report with all data
   */
  finalizeBatch(poolState: PoolStateSummary, recommendations: string[]): void {
    const report = this.readJson('batch-report.json') as BatchReport;
    
    report.poolState = poolState;
    report.recommendations = recommendations;
    
    this.writeJson('batch-report.json', report);
    
    // Generate training export
    this.generateTrainingExport(report);
    
    // Update memory-bank index
    this.updateMemoryBankIndex(report);
    
    console.log(`[BatchLogger] Batch ${this.batchId} finalized. Training export ready.`);
  }
  
  /**
   * Write a JSON file in the batch directory
   */
  private writeJson(filename: string, data: any): void {
    const path = join(this.batchDir, filename);
    writeFileSync(path, JSON.stringify(data, null, 2));
  }
  
  /**
   * Append to a JSONL file
   */
  private appendToFile(filename: string, line: string): void {
    const path = join(this.batchDir, filename);
    appendFileSync(path, line);
  }
  
  /**
   * Read a JSON file
   */
  private readJson(filename: string): any {
    const path = join(this.batchDir, filename);
    const { readFileSync } = require('fs');
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  
  /**
   * Generate a session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Write training record in format ready for ML
   */
  private writeTrainingRecord(features: BatchFeatureVector): void {
    // Flat numeric array for ML training (no strings, all vectors)
    const trainingRecord = {
      recordId: `${this.batchId}-r${this.roundNumber}`,
      batchId: this.batchId,
      roundNumber: this.roundNumber,
      timestamp: features.timestamp,
      
      // Numeric features only (for ML)
      numericFeatures: {
        totalSources: features.totalSources,
        successRate: features.successCount / features.totalSources,
        failureRate: features.failureCount / features.totalSources,
        routingRate: features.routingCount / features.totalSources,
        manualReviewRate: features.manualReviewCount / features.totalSources,
        
        c1Duration: features.c1RunDuration,
        c2Duration: features.c2RunDuration,
        c3Duration: features.c3RunDuration,
        c4Duration: features.c4RunDuration,
        totalDuration: features.totalPipelineDuration,
        
        groundTruthEventsTotal: features.groundTruthEventsTotal,
        c3ExtractedEventsTotal: features.c3ExtractedEventsTotal,
        gapEventsTotal: features.gapEventsTotal,
        gapSourcesCount: features.gapSourcesCount,
        gapRatio: features.gapRatio,
        
        improvementCandidatesCount: features.improvementCandidatesCount,
        verificationPassedRate: features.verificationPassedCount / Math.max(1, features.improvementCandidatesCount),
        regressionPassedRate: features.regressionPassedCount / Math.max(1, features.verificationPassedCount),
        
        discoveryFailureRate: features.discoveryFailureRate,
        screeningFailureRate: features.screeningFailureRate,
        extractionFailureRate: features.extractionFailureRate,
        groundTruthGapRate: features.groundTruthGapRate,
        networkFailureRate: features.networkFailureRate,
        
        poolRefillCount: features.poolRefillCount,
        poolExhaustionRate: features.poolExhaustionRate,
        avgRoundsPerSource: features.avgRoundsPerSource,
        sourcesMaxedRounds: features.sourcesMaxedRounds,
        
        gateSelectedRate: features.gateSelectedCount / Math.max(1, features.improvementCandidatesCount),
        gateBlockedRate: features.gateBlockedCount / Math.max(1, features.improvementCandidatesCount),
        gateRejectedRate: features.gateRejectedCount / Math.max(1, features.improvementCandidatesCount),
        
        hourOfDay: features.hourOfDay,
        dayOfWeek: features.dayOfWeek,
        isWeekend: features.isWeekend ? 1 : 0
      },
      
      // Categorical features as one-hot for ML
      categoricalFeatures: {
        failureMode: Object.keys(features.sourcesByCategory),
        improvementTypes: Object.keys(features.improvementCandidatesByType)
      },
      
      // Labels
      labels: {
        overallSuccess: features.successCount > features.failureCount ? 1 : 0,
        gapResolutionQuality: features.gapRatio < 0.3 ? 1 : (features.gapRatio < 0.6 ? 0.5 : 0),
        improvementQuality: features.verificationPassedCount > features.verificationFailedCount ? 1 : 0
      }
    };
    
    this.writeJson('training-record.json', trainingRecord);
    appendFileSync('./testResults/training-exports/training-records.jsonl', JSON.stringify(trainingRecord) + '\n');
  }
  
  /**
   * Generate comprehensive training export
   */
  private generateTrainingExport(report: BatchReport): void {
    // Export format: one record per source per round
    const exportRecords: any[] = [];
    
    for (const src of report.sourceResults) {
      const gapEntry = report.gapAnalysis.find(g => g.sourceId === src.sourceId);
      
      exportRecords.push({
        recordId: `${report.batchId}-${src.sourceId}-r${report.roundNumber}`,
        batchId: report.batchId,
        roundNumber: report.roundNumber,
        timestamp: report.timestamp,
        
        // Source features
        sourceId: src.sourceId,
        url: src.url,
        category: src.category,
        
        // Pipeline features
        c1Outcome: src.c1Outcome,
        c2Score: src.c2Score,
        c2Verdict: src.c2Verdict,
        c3Events: src.c3Events,
        c4GroundTruthEvents: src.c4GroundTruthEvents,
        
        // Gap features
        hasGap: src.hasGap,
        gapSize: src.gapSize,
        
        // Gap root cause (if available)
        gapRootCause: gapEntry?.rootCauseCategory || 'unknown',
        gapRootCauseConfidence: gapEntry?.rootCauseConfidence || 0,
        
        // Improvement features (if applicable)
        improvementId: gapEntry?.improvementId || null,
        improvementType: gapEntry?.improvementType || null,
        gapClosedAfterImprovement: gapEntry?.gapClosedAfterImprovement || 0,
        
        // Outcome
        exitReason: src.exitReason,
        exitQueue: src.exitQueue,
        roundsParticipated: src.roundsParticipated,
        
        // Training labels
        labels: {
          needsImprovement: src.hasGap ? 1 : 0,
          improvementSuccessful: gapEntry?.gapClosedAfterImprovement ? (gapEntry.gapClosedAfterImprovement > 0 ? 1 : 0) : 0,
          manualReviewNeeded: src.exitQueue === 'manual-review' ? 1 : 0,
          sourceExhausted: src.roundsParticipated >= 3 ? 1 : 0
        }
      });
    }
    
    this.writeJson('training-export.json', exportRecords);
    
    // Append to global training export
    for (const rec of exportRecords) {
      appendFileSync('./testResults/training-exports/source-records.jsonl', JSON.stringify(rec) + '\n');
    }
  }
  
  /**
   * Update the memory-bank index with this batch
   */
  private updateMemoryBankIndex(report: BatchReport): void {
    const indexPath = './testResults/memory-bank/batch-index.jsonl';
    
    const indexEntry = {
      batchId: report.batchId,
      sessionId: report.sessionId,
      timestamp: report.timestamp,
      roundNumber: report.roundNumber,
      totalSources: report.features.totalSources,
      successCount: report.features.successCount,
      failureCount: report.features.failureCount,
      gapRatio: report.features.gapRatio,
      improvementCandidatesCount: report.features.improvementCandidatesCount,
      verificationPassedCount: report.features.verificationPassedCount,
      regressionPassedCount: report.features.regressionPassedCount,
      path: this.batchDir
    };
    
    appendFileSync(indexPath, JSON.stringify(indexEntry) + '\n');
    
    // Update feature statistics
    this.updateFeatureStatistics(report.features);
  }
  
  /**
   * Update running feature statistics for analysis
   */
  private updateFeatureStatistics(features: BatchFeatureVector): void {
    const statsPath = './testResults/memory-bank/feature-statistics.json';
    
    let stats: any = {};
    try {
      const { readFileSync } = require('fs');
      stats = JSON.parse(readFileSync(statsPath, 'utf8'));
    } catch {
      stats = { batches: 0, aggregates: {} };
    }
    
    stats.batches++;
    
    // Running aggregates
    const fields = ['gapRatio', 'extractionFailureRate', 'discoveryFailureRate', 
                    'networkFailureRate', 'poolExhaustionRate'];
    
    for (const field of fields) {
      if (!stats.aggregates[field]) {
        stats.aggregates[field] = { sum: 0, count: 0, mean: 0, min: Infinity, max: -Infinity };
      }
      const val = (features as any)[field];
      stats.aggregates[field].sum += val;
      stats.aggregates[field].count++;
      stats.aggregates[field].mean = stats.aggregates[field].sum / stats.aggregates[field].count;
      stats.aggregates[field].min = Math.min(stats.aggregates[field].min, val);
      stats.aggregates[field].max = Math.max(stats.aggregates[field].max, val);
    }
    
    this.writeJson('feature-statistics.json', stats);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBatchLogger(batchId: string, roundNumber: number): BatchLogger {
  return new BatchLogger(batchId, roundNumber);
}