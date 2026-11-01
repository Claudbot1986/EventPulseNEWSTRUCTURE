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
  /**
   * Kandidatens egen metadata (jsonb i `source_candidates`).
   *
   * Före 2026-10-23 tappades denna vid promote — source-filen fick bara
   * sourceCandidateId/originPath. Med metadata i hand kan kandidaten bära med
   * sig konfiguration som källan behöver (t.ex. adapter-inställningar).
   */
  metadata?: Record<string, unknown>;
}

export interface SourceCandidateTestQueueItem {
  id: string;
  sourceCandidateId: string;
  candidateUrl: string;
  candidateName?: string | null;
  /** Staden kandidaten hittades i. NULL = okänd scope. */
  city?: string | null;
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
  /**
   * 2026-11-01 — radernas rubriker från smoke-körningen. Utan dem kan
   * beslutet inte skilja ett evenemang från en artikel: "det persisterats
   * events" är sant för en blogg också. Se `eventLikeness.ts`.
   */
  eventTitles?: string[];
  /**
   * 2026-11-01 — sidornas EGNA deklarationer för raderna (JSON-LD-typ,
   * og:type, beskrivning). Detta är den pålitliga signalen: mätning visar att
   * titelmönstren bara fångar 4 av 8 artikelrubriker i kollaborationse, men
   * att sidans `Article`/`NewsArticle`-deklaration fångar dem alla.
   */
  eventPageSignals?: SourceCandidatePageSignal[];
}

/** 2026-11-01 — vad en radens sida själv säger om sitt innehåll. */
export interface SourceCandidatePageSignal {
  title?: string;
  jsonLdTypes?: string[];
  ogType?: string | null;
  description?: string | null;
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
  /**
   * 2026-11-01 — radernas rubriker. Utan dem kan beslutet inte skilja ett
   * evenemang från en artikel (se `eventLikeness.ts`).
   */
  eventTitles?: string[];
  /**
   * 2026-11-01 — sidornas egna deklarationer. Starkare signal än titeln.
   */
  eventPageSignals?: SourceCandidatePageSignal[];
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
  /**
   * 2026-10-31 — MATA KÖN. Utan detta steg claimar P3D 0 rader varje natt:
   * P3A skriver nya kandidater till `source_candidates`, men ingen kod
   * anropar `enqueue_source_candidate_tests()`, så `source_candidate_test_queue`
   * fylls aldrig på. Mätt 2026-10-31: 116 Stockholm-kandidater väntade i
   * `source_candidates`, 0 i kön, 0 testade.
   *
   * Funktionerna finns redan i live-DB (migration 20261021-0003):
   *   - `enqueue_source_candidate_tests(phase)` — kopplar pending-kandidater
   *     till testkön (idempotent via ON CONFLICT DO NOTHING, och den kopierar
   *     kandidatens `city`, vilket claim-filtret kräver).
   *   - `sync_source_candidate_queue_city()` — fyller city/priority på rader
   *     som redan ligger i kön (äldre rader har city=NULL och är då
   *     oclaimbara).
   *
   * @param phase fasen att köa till (t.ex. 'smoke')
   * @returns antal rader som lades i kön
   */
  enqueuePendingCandidates(phase: SourceCandidateTestPhase): Promise<number>;
  /** Synka city/priority från kandidattabellen till kön. */
  syncQueueCity(): Promise<number>;
  claimCandidates(limit: number, phase?: SourceCandidateTestPhase): Promise<SourceCandidateTestQueueItem[]>;
  /**
   * Läs kandidaternas metadata ur `source_candidates`.
   *
   * Kön (`source_candidate_test_queue`) har ingen metadata-kolumn, så den
   * måste hämtas från kandidattabellen. Utan detta tappas t.ex.
   * adapter-inställningar när kandidaten promotas till en source.
   */
  getCandidateMetadata(sourceCandidateIds: string[]): Promise<Record<string, Record<string, unknown>>>;
  insertRun(run: SourceCandidateTestRun): Promise<string>;
  insertDecision(decision: SourceCandidateDecision): Promise<void>;
  updateCandidateStatus(sourceCandidateId: string, status: SourceCandidateTestStatus, error?: string): Promise<void>;
}
