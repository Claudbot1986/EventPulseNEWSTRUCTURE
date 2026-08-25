export type VenueGraphMode = 'dry-run' | 'apply';

export type VenueGraphNodeType = 'venue' | 'event' | 'source' | 'promoter' | 'attraction';

export type VenueGraphEdgeType =
  | 'event_hosted_at_venue'
  | 'event_from_source'
  | 'event_promoted_by'
  | 'event_features_attraction'
  | 'source_mentions_venue';

export type VenueCandidateStatus = 'candidate' | 'verified' | 'rejected' | 'manual_review';

export type ExpansionTaskType =
  | 'verify_venue'
  | 'find_source_for_venue'
  | 'test_source_candidate'
  | 'manual_review';

export interface StoredVenue {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface StoredEvent {
  id: string;
  title?: string | null;
  source: string;
  source_id?: string | null;
  venue_id?: string | null;
  venue_name?: string | null;
  raw_data?: unknown;
}

export interface VenueGraphNode {
  nodeType: VenueGraphNodeType;
  canonicalKey: string;
  displayName: string;
  city?: string | null;
  sourceTable?: string | null;
  sourceId?: string | null;
  confidenceScore: number;
  status: 'observed' | 'candidate' | 'verified' | 'rejected' | 'manual_review';
  metadata?: Record<string, unknown>;
}

export interface VenueGraphEdge {
  edgeType: VenueGraphEdgeType;
  canonicalKey: string;
  fromKey: string;
  toKey: string;
  evidenceType: 'event' | 'raw_payload' | 'graph';
  evidenceId: string;
  confidenceScore: number;
  metadata?: Record<string, unknown>;
}

export interface VenueGraphObservation {
  observationType: string;
  displayName: string;
  canonicalKey: string;
  evidenceType: 'event' | 'raw_payload' | 'graph';
  evidenceId: string;
  source?: string | null;
  status: 'observed' | 'rejected';
  rejectionReason?: string;
  metadata?: Record<string, unknown>;
}

export interface VenueCandidate {
  canonicalKey: string;
  displayName: string;
  city?: string | null;
  status: VenueCandidateStatus;
  originEventId: string;
  originPath: string[];
  confidenceScore: number;
  priorityScore: number;
  riskFlags: string[];
  explanation: string;
}

export interface VenueGraphRunSummary {
  mode: VenueGraphMode;
  targetCity: string;
  inputEvents: number;
  inputVenues: number;
  nodes: number;
  edges: number;
  observations: number;
  venueCandidates: number;
  rejectedObservations: number;
  verificationStatus: 'dry_run_only' | 'local_verified';
}

export interface VenueGraphBuildResult {
  summary: VenueGraphRunSummary;
  nodes: VenueGraphNode[];
  edges: VenueGraphEdge[];
  observations: VenueGraphObservation[];
  candidates: VenueCandidate[];
  rejectedObservations: VenueGraphObservation[];
}

export interface VenueCandidateScoreInput {
  displayName: string;
  city?: string | null;
  observationCount: number;
  eventFrequency: number;
  relationStrength: number;
  hasAddress: boolean;
  hasCoordinates: boolean;
  sourceReliability: number;
  historicalSuccess: number;
}

export interface VenueCandidateScore {
  confidence_score: number;
  priority_score: number;
  quality_score: number;
  risk_flags: string[];
  explanation: string;
  signals: {
    stockholmRelevance: number;
    venueQuality: number;
    relationStrength: number;
    eventFrequency: number;
    sourceReliability: number;
    historicalSuccess: number;
  };
}

export interface ExpansionTask {
  id: string;
  taskType: ExpansionTaskType;
  candidateId: string | null;
  candidateCanonicalKey?: string | null;
  candidateName: string;
  priorityScore: number;
  attemptCount: number;
}

export interface ExpansionEvidence {
  evidenceType: 'event_source' | 'graph_edge' | 'manual_review';
  evidenceId: string;
  source?: string | null;
  url?: string | null;
}

export interface ExpansionResult {
  taskId: string;
  measured: boolean;
  resultSummary: string;
  newNodesCount: number;
  newEdgesCount: number;
  newVenueCandidatesCount: number;
  newSourceCandidatesCount: number;
  evidenceRefs: ExpansionEvidence[];
}

export interface VenueGraphRepository {
  listVenues(): Promise<StoredVenue[]>;
  listEvents(limit?: number): Promise<StoredEvent[]>;
  upsertNodes(nodes: VenueGraphNode[]): Promise<void>;
  upsertEdges(edges: VenueGraphEdge[]): Promise<void>;
  insertObservations(observations: VenueGraphObservation[]): Promise<void>;
  upsertVenueCandidates(candidates: VenueCandidate[]): Promise<void>;
  enqueueExpansionTasks(candidates: VenueCandidate[]): Promise<void>;
  insertRun(summary: VenueGraphRunSummary): Promise<void>;
  fetchPendingExpansionTasks(limit: number): Promise<ExpansionTask[]>;
  markExpansionTaskProcessing(taskId: string): Promise<void>;
  completeExpansionTask(taskId: string, result: ExpansionResult): Promise<void>;
  failExpansionTask(taskId: string, error: string): Promise<void>;
  findExpansionEvidence(task: ExpansionTask): Promise<ExpansionEvidence[]>;
}
