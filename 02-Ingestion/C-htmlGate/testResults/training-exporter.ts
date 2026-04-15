/**
 * Training Data Exporter — Exporterar ML-ready training data
 * 
 * Generates training datasets from the memory bank for model improvement.
 * Export formats:
 * - Per-source records (for source classification)
 * - Per-batch records (for pipeline optimization)
 * - Per-improvement records (for improvement attribution)
 * - Ground truth events (for extraction model training)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceTrainingData {
  recordId: string;
  sourceId: string;
  domain: string;
  timestamp: string;
  
  // Features (all numeric)
  features: {
    // Discovery features
    c1LinksFound: number;
    c1CandidatesFound: number;
    c1NavLinkRatio: number;
    c1SubmenuLinkRatio: number;
    c1RootFallbackRate: number;
    
    // Screening features
    c2Score: number;
    c2TimeTagDensity: number;
    c2DatePatternDensity: number;
    c2EventTitleDensity: number;
    c2RepeatingBlocks: number;
    c2TicketCTA: number;
    c2JsonLdPresent: number;
    c2JsonLdHasEvents: number;
    
    // Extraction features
    c3SelectorSpecificity: number;
    c3Duration: number;
    
    // Ground truth features
    c4GroundTruthEvents: number;
    c4GapSize: number;
    c4GapRatio: number;
    c4RootCauseConfidence: number;
    
    // Improvement features
    improvementAttempts: number;
    improvementGapClosed: number;
    
    // Context features
    isSwedish: number;
    requiresRender: number;
    hasSubpages: number;
    hadNetworkError: number;
    roundsParticipated: number;
  };
  
  // Labels
  labels: {
    needsImprovement: number;
    improvementSuccessful: number;
    manualReviewNeeded: number;
    sourceExhausted: number;
    routed: number;
    routingTarget: string;
  };
}

export interface BatchTrainingData {
  batchId: string;
  timestamp: string;
  roundNumber: number;
  
  features: {
    sourceCount: number;
    successRate: number;
    failureRate: number;
    routingRate: number;
    manualReviewRate: number;
    
    avgC2Score: number;
    avgGapRatio: number;
    
    c1Duration: number;
    c2Duration: number;
    c3Duration: number;
    c4Duration: number;
    totalDuration: number;
    
    improvementCandidatesGenerated: number;
    improvementAttemptsMade: number;
    improvementKeeps: number;
    improvementRollbacks: number;
    
    poolRefillCount: number;
    poolExhaustionRate: number;
    avgRoundsPerSource: number;
    
    discoveryFailureRate: number;
    screeningFailureRate: number;
    extractionFailureRate: number;
    groundTruthGapRate: number;
    networkFailureRate: number;
  };
  
  labels: {
    overallSuccess: number;
    gapResolutionQuality: number;
    improvementQuality: number;
  };
}

export interface ImprovementTrainingData {
  improvementId: string;
  improvementType: string;
  targetFailureCategory: string;
  
  features: {
    confidence: number;
    expectedImpact: number;
    crossSiteVerified: number;
    
    preGap: number;
    postGap: number;
    gapClosed: number;
    deltaEvents: number;
    
    iterationCount: number;
    finalDecision: number; // 0=rollback, 1=keep, 2=refine
  };
  
  labels: {
    success: number;
    generalizable: number;
  };
}

// ---------------------------------------------------------------------------
// Training Data Exporter
// ---------------------------------------------------------------------------

export class TrainingExporter {
  private basePath: string;
  private outputPath: string;
  
  constructor(basePath: string = './testResults') {
    this.basePath = basePath;
    this.outputPath = join(basePath, 'training-exports');
  }
  
  /**
   * Export all training data to comprehensive datasets
   */
  exportAll(): {
    sourceRecords: number;
    batchRecords: number;
    improvementRecords: number;
    groundTruthEvents: number;
  } {
    const sourceRecords = this.exportSourceRecords();
    const batchRecords = this.exportBatchRecords();
    const improvementRecords = this.exportImprovementRecords();
    const groundTruthEvents = this.exportGroundTruthEvents();
    
    // Generate aggregate dataset
    this.generateAggregateDataset();
    
    // Generate model-specific training sets
    this.generateModelTrainingSets();
    
    return {
      sourceRecords,
      batchRecords,
      improvementRecords,
      groundTruthEvents
    };
  }
  
  /**
   * Export per-source training records
   */
  private exportSourceRecords(): number {
    const sourceIndexPath = join(this.basePath, 'memory-bank', 'source-index.jsonl');
    
    if (!existsSync(sourceIndexPath)) return 0;
    
    const records: SourceTrainingData[] = [];
    const lines = readFileSync(sourceIndexPath, 'utf8').split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        // Load full source record if available
        const sourcePath = join(this.basePath, 'sources', entry.sourceId, 'source-record.json');
        let sourceData: any = {};
        
        if (existsSync(sourcePath)) {
          sourceData = JSON.parse(readFileSync(sourcePath, 'utf8'));
        }
        
        records.push({
          recordId: `src-${entry.sourceId}-${Date.now()}`,
          sourceId: entry.sourceId,
          domain: new URL(entry.url).hostname,
          timestamp: entry.timestamp,
          
          features: {
            c1LinksFound: sourceData.c1LinksFound || 0,
            c1CandidatesFound: sourceData.c1CandidatesFound || 0,
            c1NavLinkRatio: sourceData.c1LinksFound > 0 
              ? (sourceData.c1NavLinks || 0) / sourceData.c1LinksFound : 0,
            c1SubmenuLinkRatio: sourceData.c1LinksFound > 0 
              ? (sourceData.c1SubmenuLinks || 0) / sourceData.c1LinksFound : 0,
            c1RootFallbackRate: sourceData.c1RootFallback ? 1 : 0,
            
            c2Score: sourceData.c2Score || 0,
            c2TimeTagDensity: (sourceData.c2TimeTagCount || 0) / Math.max(1, sourceData.c1LinksFound || 1),
            c2DatePatternDensity: (sourceData.c2DatePatternCount || 0) / Math.max(1, sourceData.c1LinksFound || 1),
            c2EventTitleDensity: (sourceData.c2EventTitleCount || 0) / Math.max(1, sourceData.c1LinksFound || 1),
            c2RepeatingBlocks: sourceData.c2HasRepeatingBlocks ? 1 : 0,
            c2TicketCTA: sourceData.c2HasTicketCTA ? 1 : 0,
            c2JsonLdPresent: sourceData.c2HasJsonLd ? 1 : 0,
            c2JsonLdHasEvents: sourceData.c2JsonLdHasEvents ? 1 : 0,
            
            c3SelectorSpecificity: sourceData.c3SelectorUsed ? this.measureSelectorSpecificity(sourceData.c3SelectorUsed) : 0,
            c3Duration: sourceData.c3ExtractionDuration || 0,
            
            c4GroundTruthEvents: sourceData.c4GroundTruthEvents || 0,
            c4GapSize: sourceData.c4GapSize || 0,
            c4GapRatio: sourceData.c4GroundTruthEvents > 0 
              ? (sourceData.c4GapSize || 0) / sourceData.c4GroundTruthEvents : 0,
            c4RootCauseConfidence: sourceData.c4RootCauseConfidence || 0,
            
            improvementAttempts: sourceData.improvementAttemptNumber || 0,
            improvementGapClosed: sourceData.improvementGapClosed || 0,
            
            isSwedish: entry.url.includes('.se') ? 1 : 0,
            requiresRender: sourceData.requiresJsRender ? 1 : 0,
            hasSubpages: sourceData.hasSubpageCandidates ? 1 : 0,
            hadNetworkError: sourceData.hadNetworkError ? 1 : 0,
            roundsParticipated: sourceData.roundsParticipated || 0
          },
          
          labels: {
            needsImprovement: (sourceData.label?.needsImprovement) || 
              (sourceData.c4GapSize > 0 ? 1 : 0),
            improvementSuccessful: (sourceData.label?.improvementSuccessful) || 
              (sourceData.improvementGapClosed > 0 ? 1 : 0),
            manualReviewNeeded: (sourceData.label?.manualReviewNeeded) || 
              (entry.exitQueue === 'manual-review' ? 1 : 0),
            sourceExhausted: (sourceData.label?.sourceExhausted) || 
              ((sourceData.roundsParticipated || 0) >= 3 ? 1 : 0),
            routed: (sourceData.label?.routingRecommended) || 
              (['A', 'B', 'D'].includes(entry.exitQueue) ? 1 : 0),
            routingTarget: (sourceData.label?.routingTarget) || entry.exitQueue || 'none'
          }
        });
      } catch {
        // Skip malformed entries
      }
    }
    
    // Write to file
    const outputFile = join(this.outputPath, 'source-training-full.json');
    writeFileSync(outputFile, JSON.stringify(records, null, 2));
    
    // Also write JSONL for streaming
    const jsonlFile = join(this.outputPath, 'source-training-full.jsonl');
    const lines2 = records.map(r => JSON.stringify(r)).join('\n');
    writeFileSync(jsonlFile, lines2 + '\n');
    
    return records.length;
  }
  
  /**
   * Export per-batch training records
   */
  private exportBatchRecords(): number {
    const batchIndexPath = join(this.basePath, 'memory-bank', 'batch-index.jsonl');
    
    if (!existsSync(batchIndexPath)) return 0;
    
    const records: BatchTrainingData[] = [];
    const lines = readFileSync(batchIndexPath, 'utf8').split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        
        // Load full batch report
        const batchPath = join(this.basePath, 'batches', entry.batchId, 'batch-report.json');
        let batchData: any = {};
        
        if (existsSync(batchPath)) {
          batchData = JSON.parse(readFileSync(batchPath, 'utf8'));
        }
        
        const features = batchData.features || {};
        
        records.push({
          batchId: entry.batchId,
          timestamp: entry.timestamp,
          roundNumber: entry.roundNumber,
          
          features: {
            sourceCount: entry.totalSources || features.totalSources || 0,
            successRate: entry.successCount / Math.max(1, entry.totalSources),
            failureRate: entry.failureCount / Math.max(1, entry.totalSources),
            routingRate: (features.routingCount || 0) / Math.max(1, entry.totalSources),
            manualReviewRate: (features.manualReviewCount || 0) / Math.max(1, entry.totalSources),
            
            avgC2Score: features.avgC2Score || entry.avgC2Score || 0,
            avgGapRatio: entry.gapRatio || features.gapRatio || 0,
            
            c1Duration: features.c1RunDuration || 0,
            c2Duration: features.c2RunDuration || 0,
            c3Duration: features.c3RunDuration || 0,
            c4Duration: features.c4RunDuration || 0,
            totalDuration: features.totalPipelineDuration || 0,
            
            improvementCandidatesGenerated: entry.improvementCandidatesCount || features.improvementCandidatesCount || 0,
            improvementAttemptsMade: (features.verificationPassedCount || 0) + (features.verificationFailedCount || 0),
            improvementKeeps: features.verificationPassedCount || 0,
            improvementRollbacks: features.verificationFailedCount || 0,
            
            poolRefillCount: features.poolRefillCount || 0,
            poolExhaustionRate: features.poolExhaustionRate || 0,
            avgRoundsPerSource: features.avgRoundsPerSource || 0,
            
            discoveryFailureRate: features.discoveryFailureRate || 0,
            screeningFailureRate: features.screeningFailureRate || 0,
            extractionFailureRate: features.extractionFailureRate || 0,
            groundTruthGapRate: features.groundTruthGapRate || 0,
            networkFailureRate: features.networkFailureRate || 0
          },
          
          labels: {
            overallSuccess: entry.successCount > entry.failureCount ? 1 : 0,
            gapResolutionQuality: (entry.gapRatio || 0) < 0.3 ? 1 : ((entry.gapRatio || 0) < 0.6 ? 0.5 : 0),
            improvementQuality: (features.verificationPassedCount || 0) > (features.verificationFailedCount || 0) ? 1 : 0
          }
        });
      } catch {
        // Skip malformed entries
      }
    }
    
    const outputFile = join(this.outputPath, 'batch-training-full.json');
    writeFileSync(outputFile, JSON.stringify(records, null, 2));
    
    return records.length;
  }
  
  /**
   * Export per-improvement training records
   */
  private exportImprovementRecords(): number {
    const attemptsPath = join(this.basePath, 'improvement-candidates', 'attempts.jsonl');
    
    if (!existsSync(attemptsPath)) return 0;
    
    const records: ImprovementTrainingData[] = [];
    const lines = readFileSync(attemptsPath, 'utf8').split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const attempt = JSON.parse(line);
        
        records.push({
          improvementId: attempt.improvementId,
          improvementType: attempt.improvementType,
          targetFailureCategory: attempt.targetFailureCategory,
          
          features: {
            confidence: attempt.confidence || 0.5,
            expectedImpact: attempt.expectedImpact === 'high' ? 1 : (attempt.expectedImpact === 'medium' ? 0.5 : 0),
            crossSiteVerified: attempt.crossSiteVerified ? 1 : 0,
            
            preGap: attempt.baselineGroundTruthEvents - attempt.baselineEvents,
            postGap: attempt.afterGroundTruthEvents - attempt.afterEvents,
            gapClosed: attempt.gapClosed || 0,
            deltaEvents: attempt.deltaEvents || 0,
            
            iterationCount: attempt.attemptNumber,
            finalDecision: attempt.verdict === 'verified' ? 1 : (attempt.verdict === 'partial' ? 2 : 0)
          },
          
          labels: {
            success: attempt.verdict === 'verified' ? 1 : 0,
            generalizable: attempt.attributionConfidence > 0.7 ? 1 : 0
          }
        });
      } catch {
        // Skip malformed entries
      }
    }
    
    const outputFile = join(this.outputPath, 'improvement-training-full.json');
    writeFileSync(outputFile, JSON.stringify(records, null, 2));
    
    return records.length;
  }
  
  /**
   * Export ground truth events for extraction model training
   */
  private exportGroundTruthEvents(): number {
    const eventsPath = join(this.basePath, 'ground-truth', 'events.jsonl');
    
    if (!existsSync(eventsPath)) return 0;
    
    const lines = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
    const events = lines
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
    
    const outputFile = join(this.outputPath, 'ground-truth-events.json');
    writeFileSync(outputFile, JSON.stringify(events, null, 2));
    
    return events.length;
  }
  
  /**
   * Generate aggregate dataset combining all sources
   */
  private generateAggregateDataset(): void {
    const statsPath = join(this.basePath, 'memory-bank', 'feature-statistics.json');
    
    let stats = {};
    if (existsSync(statsPath)) {
      stats = JSON.parse(readFileSync(statsPath, 'utf8'));
    }
    
    // Count totals
    const sourceIndexPath = join(this.basePath, 'memory-bank', 'source-index.jsonl');
    const batchIndexPath = join(this.basePath, 'memory-bank', 'batch-index.jsonl');
    const attemptsPath = join(this.basePath, 'improvement-candidates', 'attempts.jsonl');
    const eventsPath = join(this.basePath, 'ground-truth', 'events.jsonl');
    
    const summary = {
      generatedAt: new Date().toISOString(),
      totalSources: existsSync(sourceIndexPath) 
        ? readFileSync(sourceIndexPath, 'utf8').split('\n').filter(Boolean).length : 0,
      totalBatches: existsSync(batchIndexPath) 
        ? readFileSync(batchIndexPath, 'utf8').split('\n').filter(Boolean).length : 0,
      totalImprovements: existsSync(attemptsPath) 
        ? readFileSync(attemptsPath, 'utf8').split('\n').filter(Boolean).length : 0,
      totalGroundTruthEvents: existsSync(eventsPath) 
        ? readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).length : 0,
      featureStatistics: stats,
      exportReady: true
    };
    
    const outputFile = join(this.outputPath, 'aggregate-summary.json');
    writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  }
  
  /**
   * Generate model-specific training sets
   */
  private generateModelTrainingSets(): void {
    // C1 Discovery Model Training Set
    this.generateC1TrainingSet();
    
    // C2 Screening Model Training Set
    this.generateC2TrainingSet();
    
    // C3 Extraction Model Training Set
    this.generateC3TrainingSet();
    
    // Improvement Attribution Model Training Set
    this.generateImprovementTrainingSet();
  }
  
  /**
   * Generate C1 discovery training set
   */
  private generateC1TrainingSet(): void {
    const sourceIndexPath = join(this.basePath, 'memory-bank', 'source-index.jsonl');
    if (!existsSync(sourceIndexPath)) return;
    
    const records = [];
    const lines = readFileSync(sourceIndexPath, 'utf8').split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const sourcePath = join(this.basePath, 'sources', entry.sourceId, 'source-record.json');
        
        if (!existsSync(sourcePath)) continue;
        
        const sourceData = JSON.parse(readFileSync(sourcePath, 'utf8'));
        
        records.push({
          sourceId: entry.sourceId,
          
          // Input features
          input: {
            domain: new URL(entry.url).hostname,
            c1LinksFound: sourceData.c1LinksFound || 0,
            c1NavLinks: sourceData.c1NavLinks || 0,
            c1SubmenuLinks: sourceData.c1SubmenuLinks || 0,
            c1ContentLinks: sourceData.c1ContentLinks || 0,
            c1FooterLinks: sourceData.c1FooterLinks || 0,
            c1CandidatesFound: sourceData.c1CandidatesFound || 0,
            c1RootFallback: sourceData.c1RootFallback ? 1 : 0
          },
          
          // Output labels
          output: {
            discoveryQuality: sourceData.c1CandidatesFound > 0 ? 1 : 0,
            needsRootFallback: sourceData.c1RootFallback ? 1 : 0,
            likelyHasSubpages: sourceData.hasSubpageCandidates ? 1 : 0
          }
        });
      } catch {
        // Skip
      }
    }
    
    const outputFile = join(this.outputPath, 'c1-discovery-training.json');
    writeFileSync(outputFile, JSON.stringify(records, null, 2));
  }
  
  /**
   * Generate C2 screening training set
   */
  private generateC2TrainingSet(): void {
    const sourceIndexPath = join(this.basePath, 'memory-bank', 'source-index.jsonl');
    if (!existsSync(sourceIndexPath)) return;
    
    const records = [];
    const lines = readFileSync(sourceIndexPath, 'utf8').split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const sourcePath = join(this.basePath, 'sources', entry.sourceId, 'source-record.json');
        
        if (!existsSync(sourcePath)) continue;
        
        const sourceData = JSON.parse(readFileSync(sourcePath, 'utf8'));
        
        records.push({
          sourceId: entry.sourceId,
          
          input: {
            c2Score: sourceData.c2Score || 0,
            c2TimeTagCount: sourceData.c2TimeTagCount || 0,
            c2DatePatternCount: sourceData.c2DatePatternCount || 0,
            c2EventTitleCount: sourceData.c2EventTitleCount || 0,
            c2VenueMarkerCount: sourceData.c2VenueMarkerCount || 0,
            c2PriceMarkerCount: sourceData.c2PriceMarkerCount || 0,
            c2HasRepeatingBlocks: sourceData.c2HasRepeatingBlocks ? 1 : 0,
            c2HasTicketCTA: sourceData.c2HasTicketCTA ? 1 : 0,
            c2HasJsonLd: sourceData.c2HasJsonLd ? 1 : 0,
            c2JsonLdHasEvents: sourceData.c2JsonLdHasEvents ? 1 : 0
          },
          
          output: {
            verdict: sourceData.c2Verdict === 'promising' ? 1 : (sourceData.c2Verdict === 'unclear' ? 0.5 : 0),
            likelyNeedsImprovement: (sourceData.c4GapSize || 0) > 0 ? 1 : 0,
            routingRecommendation: ['postTestC-A', 'postTestC-B', 'postTestC-D'].includes(entry.exitQueue) ? 1 : 0
          }
        });
      } catch {
        // Skip
      }
    }
    
    const outputFile = join(this.outputPath, 'c2-screening-training.json');
    writeFileSync(outputFile, JSON.stringify(records, null, 2));
  }
  
  /**
   * Generate C3 extraction training set
   */
  private generateC3TrainingSet(): void {
    const eventsPath = join(this.basePath, 'ground-truth', 'events.jsonl');
    if (!existsSync(eventsPath)) return;
    
    const records = [];
    const lines = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
    
    const sourceEvents = new Map<string, any[]>();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (!sourceEvents.has(event.sourceId)) {
          sourceEvents.set(event.sourceId, []);
        }
        sourceEvents.get(event.sourceId)!.push(event);
      } catch {
        // Skip
      }
    }
    
    for (const [sourceId, events] of sourceEvents) {
      for (const event of events) {
        records.push({
          sourceId,
          eventId: event.eventId,
          
          input: {
            selectors: event.selectors || [],
            hasTime: event.time ? 1 : 0,
            hasVenue: event.venue ? 1 : 0,
            confidence: event.confidence || 0.5
          },
          
          output: {
            extractionMethod: event.extractionMethod === 'c3-rule-based' ? 1 : 0,
            wasPartOfGap: event.wasPartOfGap ? 1 : 0,
            gapClosedByImprovement: event.gapClosedByImprovement ? 1 : 0
          }
        });
      }
    }
    
    const outputFile = join(this.outputPath, 'c3-extraction-training.json');
    writeFileSync(outputFile, JSON.stringify(records, null, 2));
  }
  
  /**
   * Generate improvement attribution training set
   */
  private generateImprovementTrainingSet(): void {
    const attemptsPath = join(this.basePath, 'improvement-candidates', 'attempts.jsonl');
    if (!existsSync(attemptsPath)) return;
    
    const records = [];
    const lines = readFileSync(attemptsPath, 'utf8').split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const attempt = JSON.parse(line);
        
        records.push({
          improvementId: attempt.improvementId,
          sourceId: attempt.sourceId,
          improvementType: attempt.improvementType,
          targetFailureCategory: attempt.targetFailureCategory,
          
          input: {
            baselineGap: attempt.baselineGroundTruthEvents - attempt.baselineEvents,
            afterGap: attempt.afterGroundTruthEvents - attempt.afterEvents,
            deltaEvents: attempt.deltaEvents,
            gapClosed: attempt.gapClosed || 0,
            confidence: attempt.confidence || 0.5,
            attributionConfidence: attempt.attributionConfidence || 0.5
          },
          
          output: {
            success: attempt.verdict === 'verified' ? 1 : 0,
            generalizable: attempt.attributionConfidence > 0.7 ? 1 : 0
          }
        });
      } catch {
        // Skip
      }
    }
    
    const outputFile = join(this.outputPath, 'improvement-attribution-training.json');
    writeFileSync(outputFile, JSON.stringify(records, null, 2));
  }
  
  /**
   * Measure CSS selector specificity (0-1)
   */
  private measureSelectorSpecificity(selector: string): number {
    // Higher specificity = more precise selector
    const specificityScore = selector.split(' ').length +
      selector.split('>').length +
      selector.split('.').length * 0.3 +
      selector.split('#').length * 0.5;
    
    return Math.min(specificityScore / 10, 1);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTrainingExporter(): TrainingExporter {
  return new TrainingExporter();
}