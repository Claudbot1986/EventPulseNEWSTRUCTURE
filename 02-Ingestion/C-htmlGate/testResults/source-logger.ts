/**
 * Source Logger — Per-source komplett loggning för training
 * 
 * Every source gets a complete record from entry to exit.
 * This enables:
 * - Per-source ML training
 * - Cross-source pattern analysis
 * - Root cause classification
 * - Improvement attribution
 */

import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceFeatureVector {
  // Identity
  sourceId: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  
  // Timestamps
  firstSeen: string;
  lastUpdated: string;
  roundsParticipated: number;
  
  // C1 Discovery features
  c1LinksFound: number;
  c1CandidatesFound: number;
  c1WinnerUrl: string | null;
  c1RootFallback: boolean;
  c1NavLinks: number;
  c1SubmenuLinks: number;
  c1ContentLinks: number;
  c1FooterLinks: number;
  
  // C2 Screening features
  c2Score: number;
  c2Verdict: 'promising' | 'unclear' | 'low-value';
  c2TimeTagCount: number;
  c2DatePatternCount: number;
  c2EventTitleCount: number;
  c2VenueMarkerCount: number;
  c2PriceMarkerCount: number;
  c2HasRepeatingBlocks: boolean;
  c2HasTicketCTA: boolean;
  c2HasJsonLd: boolean;
  c2JsonLdHasEvents: boolean;
  
  // C3 Extraction features
  c3SelectorUsed: string | null;
  c3EventsExtracted: number;
  c3ExtractionDuration: number;
  c3HadGroundTruthComparison: boolean;
  
  // C4-AI features
  c4GroundTruthEvents: number;
  c4GroundTruthConfidence: number;
  c4GapSize: number;
  c4GapReasons: string[];
  c4RootCauseCategory: string;
  c4RootCauseConfidence: number;
  
  // Improvement features
  improvementApplied: string | null;
  improvementType: string | null;
  improvementAttemptNumber: number;
  improvementDeltaEvents: number;
  improvementGapClosed: number;
  
  // Outcome
  exitReason: string;
  exitQueue: string;
  exitTimestamp: string;
  
  // Feature flags for ML
  isSwedishSite: boolean;
  requiresJsRender: boolean;
  hasSubpageCandidates: boolean;
  hadNetworkError: boolean;
  networkErrorType: string | null;
  
  // Training labels
  label: {
    needsImprovement: number;
    improvementSuccessful: number;
    manualReviewNeeded: number;
    sourceExhausted: number;
    routingRecommended: number;
    routingTarget: string | null;
  };
}

export interface SourceEventRecord {
  sourceId: string;
  eventId: string;
  roundNumber: number;
  
  // Event data
  title: string;
  date: string;
  time?: string;
  venue?: string;
  url?: string;
  ticketUrl?: string;
  
  // Provenance
  extractionMethod: 'c3-rule-based' | 'c4-ai-ground-truth' | 'improvement';
  matchedSelector?: string;
  matchedPattern?: string;
  confidence: number;
  
  // Context
  wasPartOfGap: boolean;
  gapClosedByImprovement: boolean;
}

export interface SourceDecisionTrail {
  sourceId: string;
  batchId: string;
  roundNumber: number;
  
  decisions: Array<{
    decisionId: string;
    timestamp: string;
    decisionType: string;
    decision: string;
    reasoningChain: string[];
    evidenceUsed: string[];
    alternativesConsidered: string[];
    chosenOverAlternatives: string[];
  }>;
  
  improvements: Array<{
    improvementId: string;
    attemptNumber: number;
    improvementType: string;
    description: string;
    preState: { events: number; gap: number };
    postState: { events: number; gap: number };
    delta: { events: number; gap: number };
    verified: boolean;
    verifiedBy: 'verification-batch' | 'regression-batch' | 'production';
  }>;
}

export interface SourceTrainingRecord {
  recordId: string;
  sourceId: string;
  batchId: string;
  roundNumber: number;
  timestamp: string;
  
  // All numeric features
  features: {
    // Discovery
    linksFound: number;
    candidatesFound: number;
    rootFallback: number;
    navLinkRatio: number;
    
    // Screening
    c2Score: number;
    timeTagDensity: number;
    datePatternDensity: number;
    eventTitleDensity: number;
    repeatingBlocksPresent: number;
    ticketCTAPresent: number;
    jsonLdPresent: number;
    jsonLdHasEvents: number;
    
    // Extraction
    c3Duration: number;
    hadGroundTruth: number;
    
    // Gap
    groundTruthEvents: number;
    gapSize: number;
    gapRatio: number;
    rootCauseConfidence: number;
    
    // Improvement
    improvementAttempted: number;
    improvementDelta: number;
    improvementGapClosed: number;
    
    // Context
    roundsParticipated: number;
    isSwedish: number;
    requiresRender: number;
    hasSubpages: number;
    hadNetworkError: number;
  };
  
  // Labels
  labels: {
    needsImprovement: number;
    improvementSuccess: number;
    manualReview: number;
    exhausted: number;
    routed: number;
    routingTarget: string;
  };
}

// ---------------------------------------------------------------------------
// Source Logger
// ---------------------------------------------------------------------------

export class SourceLogger {
  private sourceDir: string;
  private sourceId: string;
  
  constructor(sourceId: string) {
    this.sourceId = sourceId;
    this.sourceDir = join('./testResults/sources', sourceId);
    mkdirSync(this.sourceDir, { recursive: true });
  }
  
  /**
   * Initialize source record
   */
  initSource(metadata: { url: string; canonicalUrl: string; domain: string }): void {
    const record: SourceFeatureVector = {
      sourceId: this.sourceId,
      url: metadata.url,
      canonicalUrl: metadata.canonicalUrl,
      domain: metadata.domain,
      firstSeen: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      roundsParticipated: 0,
      
      // C1
      c1LinksFound: 0,
      c1CandidatesFound: 0,
      c1WinnerUrl: null,
      c1RootFallback: false,
      c1NavLinks: 0,
      c1SubmenuLinks: 0,
      c1ContentLinks: 0,
      c1FooterLinks: 0,
      
      // C2
      c2Score: 0,
      c2Verdict: 'unclear',
      c2TimeTagCount: 0,
      c2DatePatternCount: 0,
      c2EventTitleCount: 0,
      c2VenueMarkerCount: 0,
      c2PriceMarkerCount: 0,
      c2HasRepeatingBlocks: false,
      c2HasTicketCTA: false,
      c2HasJsonLd: false,
      c2JsonLdHasEvents: false,
      
      // C3
      c3SelectorUsed: null,
      c3EventsExtracted: 0,
      c3ExtractionDuration: 0,
      c3HadGroundTruthComparison: false,
      
      // C4
      c4GroundTruthEvents: 0,
      c4GroundTruthConfidence: 0,
      c4GapSize: 0,
      c4GapReasons: [],
      c4RootCauseCategory: 'unknown',
      c4RootCauseConfidence: 0,
      
      // Improvement
      improvementApplied: null,
      improvementType: null,
      improvementAttemptNumber: 0,
      improvementDeltaEvents: 0,
      improvementGapClosed: 0,
      
      // Outcome
      exitReason: '',
      exitQueue: '',
      exitTimestamp: '',
      
      // Feature flags
      isSwedishSite: metadata.domain.includes('.se'),
      requiresJsRender: false,
      hasSubpageCandidates: false,
      hadNetworkError: false,
      networkErrorType: null,
      
      label: {
        needsImprovement: 0,
        improvementSuccessful: 0,
        manualReviewNeeded: 0,
        sourceExhausted: 0,
        routingRecommended: 0,
        routingTarget: null
      }
    };
    
    this.writeJson('source-record.json', record);
  }
  
  /**
   * Log C1 discovery results
   */
  logC1(c1Data: {
    linksFound: number;
    candidatesFound: number;
    winnerUrl: string | null;
    rootFallback: boolean;
    navLinks: number;
    submenuLinks: number;
    contentLinks: number;
    footerLinks: number;
  }): void {
    const record = this.readRecord();
    
    record.c1LinksFound = c1Data.linksFound;
    record.c1CandidatesFound = c1Data.candidatesFound;
    record.c1WinnerUrl = c1Data.winnerUrl;
    record.c1RootFallback = c1Data.rootFallback;
    record.c1NavLinks = c1Data.navLinks;
    record.c1SubmenuLinks = c1Data.submenuLinks;
    record.c1ContentLinks = c1Data.contentLinks;
    record.c1FooterLinks = c1Data.footerLinks;
    
    this.writeRecord(record);
    this.appendToTrail('c1-discovery', c1Data);
  }
  
  /**
   * Log C2 screening results
   */
  logC2(c2Data: {
    score: number;
    verdict: 'promising' | 'unclear' | 'low-value';
    timeTagCount: number;
    datePatternCount: number;
    eventTitleCount: number;
    venueMarkerCount: number;
    priceMarkerCount: number;
    hasRepeatingBlocks: boolean;
    hasTicketCTA: boolean;
    hasJsonLd: boolean;
    jsonLdHasEvents: boolean;
  }): void {
    const record = this.readRecord();
    
    record.c2Score = c2Data.score;
    record.c2Verdict = c2Data.verdict;
    record.c2TimeTagCount = c2Data.timeTagCount;
    record.c2DatePatternCount = c2Data.datePatternCount;
    record.c2EventTitleCount = c2Data.eventTitleCount;
    record.c2VenueMarkerCount = c2Data.venueMarkerCount;
    record.c2PriceMarkerCount = c2Data.priceMarkerCount;
    record.c2HasRepeatingBlocks = c2Data.hasRepeatingBlocks;
    record.c2HasTicketCTA = c2Data.hasTicketCTA;
    record.c2HasJsonLd = c2Data.hasJsonLd;
    record.c2JsonLdHasEvents = c2Data.jsonLdHasEvents;
    
    this.writeRecord(record);
    this.appendToTrail('c2-screening', c2Data);
  }
  
  /**
   * Log C3 extraction results
   */
  logC3(c3Data: {
    selectorUsed: string | null;
    eventsExtracted: number;
    extractionDuration: number;
  }): void {
    const record = this.readRecord();
    
    record.c3SelectorUsed = c3Data.selectorUsed;
    record.c3EventsExtracted = c3Data.eventsExtracted;
    record.c3ExtractionDuration = c3Data.extractionDuration;
    record.c3HadGroundTruthComparison = record.c4GroundTruthEvents > 0;
    
    this.writeRecord(record);
    this.appendToTrail('c3-extraction', c3Data);
  }
  
  /**
   * Log C4-AI ground truth comparison
   */
  logC4GroundTruth(gtData: {
    groundTruthEvents: number;
    groundTruthConfidence: number;
    gapSize: number;
    gapReasons: string[];
    rootCauseCategory: string;
    rootCauseConfidence: number;
    events: Array<{
      title: string;
      date: string;
      time?: string;
      venue?: string;
      url?: string;
      selectors: string[];
      confidence: number;
      reasoning: string;
    }>;
  }): void {
    const record = this.readRecord();
    
    record.c4GroundTruthEvents = gtData.groundTruthEvents;
    record.c4GroundTruthConfidence = gtData.groundTruthConfidence;
    record.c4GapSize = gtData.gapSize;
    record.c4GapReasons = gtData.gapReasons;
    record.c4RootCauseCategory = gtData.rootCauseCategory;
    record.c4RootCauseConfidence = gtData.rootCauseConfidence;
    
    // Log events to event log
    for (const event of gtData.events) {
      this.logEvent({
        eventId: `${this.sourceId}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        title: event.title,
        date: event.date,
        time: event.time,
        venue: event.venue,
        url: event.url,
        selectors: event.selectors,
        confidence: event.confidence,
        reasoning: event.reasoning
      });
    }
    
    this.writeRecord(record);
    this.appendToTrail('c4-ground-truth', gtData);
  }
  
  /**
   * Log an improvement attempt
   */
  logImprovementAttempt(impData: {
    improvementId: string;
    improvementType: string;
    attemptNumber: number;
    preState: { events: number; gap: number };
    postState: { events: number; gap: number };
  }): void {
    const record = this.readRecord();
    
    record.improvementApplied = impData.improvementId;
    record.improvementType = impData.improvementType;
    record.improvementAttemptNumber = impData.attemptNumber;
    record.improvementDeltaEvents = impData.postState.events - impData.preState.events;
    record.improvementGapClosed = impData.preState.gap - impData.postState.gap;
    
    this.writeRecord(record);
    this.appendToTrail('improvement', impData);
  }
  
  /**
   * Log a decision about this source
   */
  logDecision(decision: {
    decisionId: string;
    decisionType: string;
    decision: string;
    reasoningChain: string[];
    evidenceUsed: string[];
    alternativesConsidered: string[];
    chosenOverAlternatives: string[];
  }): void {
    this.appendToTrail('decision', decision);
  }
  
  /**
   * Finalize source record with exit info
   */
  finalizeSource(exitData: {
    exitReason: string;
    exitQueue: string;
  }): void {
    const record = this.readRecord();
    
    record.lastUpdated = new Date().toISOString();
    record.exitReason = exitData.exitReason;
    record.exitQueue = exitData.exitQueue;
    record.exitTimestamp = new Date().toISOString();
    
    // Set training labels
    record.label.needsImprovement = record.c4GapSize > 0 ? 1 : 0;
    record.label.improvementSuccessful = record.improvementGapClosed > 0 ? 1 : 0;
    record.label.manualReviewNeeded = exitData.exitQueue === 'manual-review' ? 1 : 0;
    record.label.sourceExhausted = record.roundsParticipated >= 3 ? 1 : 0;
    
    this.writeRecord(record);
    this.generateTrainingRecord();
    
    // Write to global source index
    const indexEntry = {
      sourceId: this.sourceId,
      batchId: 'global',
      exitReason: exitData.exitReason,
      exitQueue: exitData.exitQueue,
      roundsParticipated: record.roundsParticipated,
      c2Score: record.c2Score,
      c4GapSize: record.c4GapSize,
      timestamp: record.exitTimestamp
    };
    appendFileSync('./testResults/memory-bank/source-index.jsonl', JSON.stringify(indexEntry) + '\n');
  }
  
  /**
   * Log an individual event (ground truth or C3 extracted)
   */
  logEvent(eventData: {
    eventId: string;
    title: string;
    date: string;
    time?: string;
    venue?: string;
    url?: string;
    selectors: string[];
    confidence: number;
    reasoning: string;
  }): void {
    const eventRecord: SourceEventRecord = {
      sourceId: this.sourceId,
      eventId: eventData.eventId,
      roundNumber: 0, // Will be set by caller
      title: eventData.title,
      date: eventData.date,
      time: eventData.time,
      venue: eventData.venue,
      url: eventData.url,
      extractionMethod: 'c4-ai-ground-truth',
      matchedSelector: eventData.selectors[0] || undefined,
      confidence: eventData.confidence,
      wasPartOfGap: false,
      gapClosedByImprovement: false
    };
    
    appendFileSync(join(this.sourceDir, 'events.jsonl'), JSON.stringify(eventRecord) + '\n');
    appendFileSync('./testResults/ground-truth/events.jsonl', JSON.stringify(eventRecord) + '\n');
  }
  
  /**
   * Increment rounds participated
   */
  incrementRound(): void {
    const record = this.readRecord();
    record.roundsParticipated++;
    record.lastUpdated = new Date().toISOString();
    this.writeRecord(record);
  }
  
  /**
   * Generate ML-ready training record for this source
   */
  private generateTrainingRecord(): void {
    const record = this.readRecord();
    
    const trainingRec: SourceTrainingRecord = {
      recordId: `src-${this.sourceId}-${Date.now()}`,
      sourceId: this.sourceId,
      batchId: 'global',
      roundNumber: record.roundsParticipated,
      timestamp: record.exitTimestamp,
      
      features: {
        linksFound: record.c1LinksFound,
        candidatesFound: record.c1CandidatesFound,
        rootFallback: record.c1RootFallback ? 1 : 0,
        navLinkRatio: record.c1LinksFound > 0 ? record.c1NavLinks / record.c1LinksFound : 0,
        
        c2Score: record.c2Score,
        timeTagDensity: record.c2TimeTagCount / Math.max(1, record.c1LinksFound),
        datePatternDensity: record.c2DatePatternCount / Math.max(1, record.c1LinksFound),
        eventTitleDensity: record.c2EventTitleCount / Math.max(1, record.c1LinksFound),
        repeatingBlocksPresent: record.c2HasRepeatingBlocks ? 1 : 0,
        ticketCTAPresent: record.c2HasTicketCTA ? 1 : 0,
        jsonLdPresent: record.c2HasJsonLd ? 1 : 0,
        jsonLdHasEvents: record.c2JsonLdHasEvents ? 1 : 0,
        
        c3Duration: record.c3ExtractionDuration,
        hadGroundTruth: record.c3HadGroundTruthComparison ? 1 : 0,
        
        groundTruthEvents: record.c4GroundTruthEvents,
        gapSize: record.c4GapSize,
        gapRatio: record.c4GroundTruthEvents > 0 ? record.c4GapSize / record.c4GroundTruthEvents : 0,
        rootCauseConfidence: record.c4RootCauseConfidence,
        
        improvementAttempted: record.improvementApplied ? 1 : 0,
        improvementDelta: record.improvementDeltaEvents,
        improvementGapClosed: record.improvementGapClosed,
        
        roundsParticipated: record.roundsParticipated,
        isSwedish: record.isSwedishSite ? 1 : 0,
        requiresRender: record.requiresJsRender ? 1 : 0,
        hasSubpages: record.hasSubpageCandidates ? 1 : 0,
        hadNetworkError: record.hadNetworkError ? 1 : 0
      },
      
      labels: {
        needsImprovement: record.label.needsImprovement,
        improvementSuccess: record.label.improvementSuccessful,
        manualReview: record.label.manualReviewNeeded,
        exhausted: record.label.sourceExhausted,
        routed: record.label.routingRecommended,
        routingTarget: record.label.routingTarget || 'none'
      }
    };
    
    this.writeJson('training-record.json', trainingRec);
    appendFileSync('./testResults/training-exports/source-records.jsonl', JSON.stringify(trainingRec) + '\n');
  }
  
  /**
   * Append to decision trail
   */
  private appendToTrail(type: string, data: any): void {
    const trailFile = join(this.sourceDir, 'decision-trail.jsonl');
    appendFileSync(trailFile, JSON.stringify({ type, timestamp: new Date().toISOString(), data }) + '\n');
  }
  
  /**
   * Write source record
   */
  private writeRecord(record: SourceFeatureVector): void {
    this.writeJson('source-record.json', record);
  }
  
  /**
   * Read source record
   */
  private readRecord(): SourceFeatureVector {
    return this.readJson('source-record.json') as SourceFeatureVector;
  }
  
  /**
   * Write JSON
   */
  private writeJson(filename: string, data: any): void {
    const path = join(this.sourceDir, filename);
    writeFileSync(path, JSON.stringify(data, null, 2));
  }
  
  /**
   * Read JSON
   */
  private readJson(filename: string): any {
    const path = join(this.sourceDir, filename);
    const { readFileSync } = require('fs');
    return JSON.parse(readFileSync(path, 'utf8'));
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSourceLogger(sourceId: string): SourceLogger {
  return new SourceLogger(sourceId);
}