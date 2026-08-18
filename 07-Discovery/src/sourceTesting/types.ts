export type SourceCandidateTestPhase = 'sanity' | 'breadth' | 'smoke';
export type SourceCandidateTestStatus = 'pending' | 'processing' | 'passed' | 'failed' | 'manual_review';
export type SourceCandidateDecisionType = 'promote' | 'reject' | 'manual_review';
export type SourceCandidateWinningPath = 'jsonld' | 'network' | 'html' | 'render' | 'manual_review' | 'none';

export interface SourceCandidateEvidenceRef {
  evidenceType: 'event_source' | 'graph' | 'manual_review' | 'tool_report';
  evidenceId: string;
  source?: string | null;
  url?: string | null;
}

export interface SourceCandidate {
  id: string;
  candidateUrl: string;
  sourceName?: string | null;
  city?: string | null;
  priorityScore: number;
  confidenceScore: number;
  originPath: string[];
  evidenceRefs: SourceCandidateEvidenceRef[];
}

export interface SourceCandidateTestQueueItem {
  id: string;
  sourceCandidateId: string;
  candidateUrl: string;
  candidateName?: string | null;
  originPath: string[];
  phase: SourceCandidateTestPhase;
  status: SourceCandidateTestStatus;
  priorityScore: number;
  attemptCount: number;
  lastError?: string | null;
}

export interface ToolStageSummary {
  status: 'success' | 'no_events' | 'failed' | 'not_run' | 'manual_review';
  eventsFound: number;
  errors?: string[];
  outputPath?: string | null;
}

export interface SourceCandidateToolEvidence {
  commandsRun: string[][];
  toolSummaries: {
    A?: ToolStageSummary;
    B?: ToolStageSummary;
    C?: ToolStageSummary;
    D?: ToolStageSummary;
  };
  eventsFoundTotal: number;
  eventsAfterNormalization: number;
  eventsPersisted: number;
  winningPath: SourceCandidateWinningPath;
  errors: string[];
  reportPath?: string | null;
  reportComplete: boolean;
  riskFlags: string[];
}

export interface SourceCandidateTestRun extends SourceCandidateToolEvidence {
  sourceCandidateId: string;
  phase: SourceCandidateTestPhase;
  sandboxSourceId: string;
}

export interface SourceCandidateDecision {
  sourceCandidateId: string;
  decision: SourceCandidateDecisionType;
  reason: string;
  confidenceScore: number;
  evidenceRunId?: string | null;
  promotedSourceId?: string | null;
}

export interface SourceCandidateDecisionInput {
  candidate: SourceCandidate;
  phase: SourceCandidateTestPhase;
  eventsFoundTotal: number;
  eventsAfterNormalization: number;
  eventsPersisted: number;
  winningPath: SourceCandidateWinningPath;
  errors: string[];
  riskFlags: string[];
  reportComplete: boolean;
  duplicateCanonicalSource: boolean;
}

export interface SandboxSource {
  sourceId: string;
  sourcePath: string;
}

export interface PromotionInput {
  preferredPath: SourceCandidateWinningPath;
  preferredPathReason: string;
  testRunId: string;
  evidenceSummary: string;
}

export interface SourceCandidateToolRunnerInput {
  candidate: SourceCandidate;
  phase: SourceCandidateTestPhase;
  projectRoot: string;
  sandboxRoot: string;
  sandboxSourceId: string;
}

export interface SourceCandidateToolRunner {
  run(input: SourceCandidateToolRunnerInput): Promise<SourceCandidateToolEvidence>;
}

export interface SourceCandidateTestRepository {
  claimCandidates(limit: number, phase?: SourceCandidateTestPhase): Promise<SourceCandidateTestQueueItem[]>;
  insertRun(run: SourceCandidateTestRun): Promise<string>;
  insertDecision(decision: SourceCandidateDecision): Promise<void>;
  updateCandidateStatus(sourceCandidateId: string, status: SourceCandidateTestStatus, error?: string): Promise<void>;
}
