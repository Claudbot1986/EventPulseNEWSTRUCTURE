import { describe, expect, it, vi } from 'vitest';
import { buildVenueGraph, buildVenueGraphDryRun } from './graphBuilder.js';
import { runExpansionTask } from './expansionRunner.js';
import { scoreVenueCandidate } from './scoring.js';
import { createSupabaseVenueGraphRepository } from './supabaseRepository.js';
import type {
  ExpansionTask,
  StoredEvent,
  StoredVenue,
  VenueGraphRepository,
} from './types.js';

function createRepository(overrides: Partial<VenueGraphRepository> = {}): VenueGraphRepository {
  const venues: StoredVenue[] = [
    {
      id: 'venue-1',
      name: 'Debaser',
      city: 'Stockholm',
      address: 'Medborgarplatsen 8',
      lat: 59.3125,
      lng: 18.0735,
    },
  ];

  const events: StoredEvent[] = [
    {
      id: 'event-1',
      title: 'Live concert',
      source: 'ticketmaster',
      source_id: 'tm-1',
      venue_id: 'venue-1',
      venue_name: 'Debaser',
      raw_data: {
        promoter: { name: 'Live Nation' },
        _embedded: { attractions: [{ name: 'Artist One' }] },
      },
    },
    {
      id: 'event-2',
      title: 'Weak placeholder venue',
      source: 'eventbrite',
      source_id: 'eb-1',
      venue_name: 'Stockholm, Sweden',
      raw_data: {},
    },
    {
      id: 'event-3',
      title: 'Unresolved but plausible venue',
      source: 'billetto',
      source_id: 'bi-1',
      venue_name: 'Fasching',
      raw_data: {},
    },
  ];

  return {
    listVenues: vi.fn(async () => venues),
    listEvents: vi.fn(async () => events),
    upsertNodes: vi.fn(async () => undefined),
    upsertEdges: vi.fn(async () => undefined),
    insertObservations: vi.fn(async () => undefined),
    upsertVenueCandidates: vi.fn(async () => undefined),
    enqueueExpansionTasks: vi.fn(async () => undefined),
    insertRun: vi.fn(async () => undefined),
    fetchPendingExpansionTasks: vi.fn(async () => []),
    markExpansionTaskProcessing: vi.fn(async () => undefined),
    completeExpansionTask: vi.fn(async () => undefined),
    failExpansionTask: vi.fn(async () => undefined),
    findExpansionEvidence: vi.fn(async () => []),
    ...overrides,
  };
}

describe('Venue Graph builder', () => {
  it('builds a deterministic dry-run graph from real stored events and venues without writes', async () => {
    const repository = createRepository();

    const first = await buildVenueGraphDryRun({ repository, targetCity: 'Stockholm' });
    const second = await buildVenueGraphDryRun({ repository, targetCity: 'Stockholm' });

    expect(first.summary).toMatchObject({
      mode: 'dry-run',
      targetCity: 'Stockholm',
      inputEvents: 3,
      inputVenues: 1,
      venueCandidates: 1,
      rejectedObservations: 1,
    });
    expect(first.nodes.map((node) => node.canonicalKey).sort()).toEqual(
      second.nodes.map((node) => node.canonicalKey).sort()
    );
    expect(first.edges.map((edge) => edge.canonicalKey).sort()).toEqual(
      second.edges.map((edge) => edge.canonicalKey).sort()
    );
    expect(first.edges).toContainEqual(
      expect.objectContaining({
        edgeType: 'event_hosted_at_venue',
        evidenceId: 'event-1',
      })
    );
    expect(first.edges).toContainEqual(
      expect.objectContaining({
        edgeType: 'event_promoted_by',
        evidenceId: 'event-1',
      })
    );
    expect(first.candidates).toContainEqual(
      expect.objectContaining({
        displayName: 'Fasching',
        status: 'candidate',
        originEventId: 'event-3',
      })
    );
    expect(first.rejectedObservations).toContainEqual(
      expect.objectContaining({
        displayName: 'Stockholm, Sweden',
        rejectionReason: 'placeholder_venue',
      })
    );
    expect(repository.upsertNodes).not.toHaveBeenCalled();
    expect(repository.insertRun).not.toHaveBeenCalled();
  });

  it('persists graph outputs only in apply mode', async () => {
    const repository = createRepository();

    await buildVenueGraph({ repository, targetCity: 'Stockholm', mode: 'apply' });

    expect(repository.upsertNodes).toHaveBeenCalledTimes(1);
    expect(repository.upsertEdges).toHaveBeenCalledTimes(1);
    expect(repository.insertObservations).toHaveBeenCalledTimes(1);
    expect(repository.upsertVenueCandidates).toHaveBeenCalledTimes(1);
    expect(repository.enqueueExpansionTasks).toHaveBeenCalledTimes(1);
    expect(repository.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'apply',
        verificationStatus: 'local_verified',
      })
    );
  });
});

describe('Venue Graph scoring', () => {
  it('returns explainable scores with risk flags for ambiguous venue candidates', () => {
    const score = scoreVenueCandidate({
      displayName: 'Stockholm Live AB',
      city: 'Stockholm',
      observationCount: 1,
      eventFrequency: 1,
      relationStrength: 1,
      hasAddress: false,
      hasCoordinates: false,
      sourceReliability: 40,
      historicalSuccess: 0,
    });

    expect(score.confidence_score).toBeLessThan(60);
    expect(score.priority_score).toBeLessThan(80);
    expect(score.risk_flags).toEqual(expect.arrayContaining(['promoter_like_name', 'weak_single_observation']));
    expect(score.explanation).toContain('promoter-like');
  });

  it('prioritizes strong Stockholm venue evidence without hiding the contributing signals', () => {
    const score = scoreVenueCandidate({
      displayName: 'Fasching',
      city: 'Stockholm',
      observationCount: 5,
      eventFrequency: 5,
      relationStrength: 4,
      hasAddress: true,
      hasCoordinates: true,
      sourceReliability: 80,
      historicalSuccess: 50,
    });

    expect(score.confidence_score).toBeGreaterThanOrEqual(80);
    expect(score.priority_score).toBeGreaterThanOrEqual(100);
    expect(score.signals.stockholmRelevance).toBeGreaterThan(0);
    expect(score.explanation).toContain('Stockholm');
  });
});

describe('Venue Graph expansion runner', () => {
  it('writes measured expansion results and never simulated summaries', async () => {
    const task: ExpansionTask = {
      id: 'task-1',
      taskType: 'find_source_for_venue',
      candidateId: 'candidate-1',
      candidateName: 'Fasching',
      priorityScore: 120,
      attemptCount: 0,
    };
    const repository = createRepository({
      findExpansionEvidence: vi.fn(async () => [
        {
          evidenceType: 'event_source' as const,
          evidenceId: 'event-3',
          source: 'billetto',
          url: 'https://example.test/fasching',
        },
      ]),
    });

    const result = await runExpansionTask({ repository, task });

    expect(result.measured).toBe(true);
    expect(result.newSourceCandidatesCount).toBe(0);
    expect(result.resultSummary.toLowerCase()).not.toContain('simulated');
    expect(repository.completeExpansionTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        measured: true,
        newSourceCandidatesCount: 0,
      })
    );
  });
});

describe('Supabase Venue Graph repository', () => {
  it('claims expansion tasks atomically via RPC when available', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          id: 'task-1',
          task_type: 'find_source_for_venue',
          candidate_id: 'candidate-1',
          candidate_canonical_key: 'venue-candidate:fasching',
          candidate_name: 'Fasching',
          priority_score: 80,
          attempt_count: 1,
        },
      ],
      error: null,
    }));
    const from = vi.fn();
    const repository = createSupabaseVenueGraphRepository({ from, rpc });

    const tasks = await repository.fetchPendingExpansionTasks(5);

    expect(rpc).toHaveBeenCalledWith('claim_venue_graph_expansion_tasks', { task_limit: 5 });
    expect(from).not.toHaveBeenCalled();
    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        taskType: 'find_source_for_venue',
        candidateCanonicalKey: 'venue-candidate:fasching',
        attemptCount: 1,
      }),
    ]);
  });

  it('upserts observations by deterministic observation_key', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    const repository = createSupabaseVenueGraphRepository({ from });

    await repository.insertObservations([
      {
        observationType: 'resolved_venue',
        displayName: 'Debaser',
        canonicalKey: 'venue:debaser',
        evidenceType: 'event',
        evidenceId: 'event-1',
        source: 'ticketmaster',
        status: 'observed',
      },
    ]);

    expect(from).toHaveBeenCalledWith('venue_graph_observations');
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          observation_key: 'resolved_venue|venue:debaser|event|event-1|ticketmaster|observed|',
        }),
      ],
      { onConflict: 'observation_key' }
    );
  });

  it('enqueues expansion tasks for upserted candidates', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const select = vi.fn(() => ({
      in: vi.fn(async () => ({
        data: [
          {
            id: 'candidate-1',
            canonical_key: 'venue-candidate:fasching',
            display_name: 'Fasching',
            priority_score: 80,
          },
        ],
        error: null,
      })),
    }));
    const from = vi.fn((table: string) => {
      if (table === 'venue_graph_expansion_queue') return { upsert };
      if (table === 'venue_candidates') return { select };
      throw new Error(`Unexpected table ${table}`);
    });
    const repository = createSupabaseVenueGraphRepository({ from });

    await repository.enqueueExpansionTasks([
      {
        canonicalKey: 'venue-candidate:fasching',
        displayName: 'Fasching',
        city: 'Stockholm',
        status: 'candidate',
        originEventId: 'event-1',
        originPath: ['event:event-1'],
        confidenceScore: 80,
        priorityScore: 80,
        riskFlags: [],
        explanation: 'test',
      },
    ]);

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          task_type: 'find_source_for_venue',
          candidate_id: 'candidate-1',
          candidate_canonical_key: 'venue-candidate:fasching',
          candidate_name: 'Fasching',
          priority_score: 80,
          status: 'pending',
        }),
      ],
      { onConflict: 'task_type,candidate_canonical_key' }
    );
  });
});
