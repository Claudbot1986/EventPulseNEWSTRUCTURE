import type {
  ExpansionEvidence,
  ExpansionResult,
  ExpansionTask,
  StoredEvent,
  StoredVenue,
  VenueCandidate,
  VenueGraphEdge,
  VenueGraphNode,
  VenueGraphObservation,
  VenueGraphRepository,
  VenueGraphRunSummary,
} from './types.js';

type JsonRecord = Record<string, unknown>;
type SupabaseLikeClient = {
  from(table: string): any;
  rpc?(functionName: string, args?: Record<string, unknown>): any;
};

function toStoredVenue(row: any): StoredVenue {
  return {
    id: row.id,
    name: row.name ?? row.id,
    city: row.city ?? null,
    address: row.address ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
  };
}

function toStoredEvent(row: any): StoredEvent {
  return {
    id: row.id,
    title: row.title_en ?? row.title_sv ?? row.source_id ?? row.id,
    source: row.source ?? 'unknown',
    source_id: row.source_id ?? null,
    venue_id: row.venue_id ?? null,
    venue_name: row.raw_data?.venue_name ?? row.raw_data?.venue?.name ?? row.raw_data?._embedded?.venues?.[0]?.name ?? null,
    raw_data: row.raw_data ?? {},
  };
}

function nodeRow(node: VenueGraphNode): JsonRecord {
  return {
    node_type: node.nodeType,
    canonical_key: node.canonicalKey,
    display_name: node.displayName,
    city: node.city ?? null,
    source_table: node.sourceTable ?? null,
    source_id: node.sourceId ?? null,
    confidence_score: node.confidenceScore,
    status: node.status,
    metadata: node.metadata ?? {},
    updated_at: new Date().toISOString(),
  };
}

function edgeRow(edge: VenueGraphEdge): JsonRecord {
  return {
    edge_type: edge.edgeType,
    canonical_key: edge.canonicalKey,
    from_node_key: edge.fromKey,
    to_node_key: edge.toKey,
    evidence_type: edge.evidenceType,
    evidence_id: edge.evidenceId,
    confidence_score: edge.confidenceScore,
    metadata: edge.metadata ?? {},
  };
}

function observationRow(observation: VenueGraphObservation): JsonRecord {
  const source = observation.source ?? '';
  const rejectionReason = observation.rejectionReason ?? '';
  return {
    observation_key: [
      observation.observationType,
      observation.canonicalKey,
      observation.evidenceType,
      observation.evidenceId,
      source,
      observation.status,
      rejectionReason,
    ].join('|'),
    observation_type: observation.observationType,
    display_name: observation.displayName,
    canonical_key: observation.canonicalKey,
    evidence_type: observation.evidenceType,
    evidence_id: observation.evidenceId,
    source: source || null,
    status: observation.status,
    rejection_reason: rejectionReason || null,
    metadata: observation.metadata ?? {},
  };
}

function candidateRow(candidate: VenueCandidate): JsonRecord {
  return {
    canonical_key: candidate.canonicalKey,
    display_name: candidate.displayName,
    city: candidate.city ?? null,
    status: candidate.status,
    origin_event_id: candidate.originEventId,
    origin_path: candidate.originPath,
    confidence_score: candidate.confidenceScore,
    priority_score: candidate.priorityScore,
    risk_flags: candidate.riskFlags,
    explanation: candidate.explanation,
    updated_at: new Date().toISOString(),
  };
}

function runRow(summary: VenueGraphRunSummary): JsonRecord {
  return {
    mode: summary.mode,
    target_city: summary.targetCity,
    input_events: summary.inputEvents,
    input_venues: summary.inputVenues,
    nodes: summary.nodes,
    edges: summary.edges,
    observations: summary.observations,
    venue_candidates: summary.venueCandidates,
    rejected_observations: summary.rejectedObservations,
    verification_status: summary.verificationStatus,
  };
}

function taskFromRow(row: any): ExpansionTask {
  return {
    id: row.id,
    taskType: row.task_type,
    candidateId: row.candidate_id,
    candidateCanonicalKey: row.candidate_canonical_key ?? null,
    candidateName: row.candidate_name,
    priorityScore: row.priority_score,
    attemptCount: row.attempt_count,
  };
}

function resultRow(result: ExpansionResult): JsonRecord {
  return {
    task_id: result.taskId,
    measured: result.measured,
    result_summary: result.resultSummary,
    new_nodes_count: result.newNodesCount,
    new_edges_count: result.newEdgesCount,
    new_venue_candidates_count: result.newVenueCandidatesCount,
    new_source_candidates_count: result.newSourceCandidatesCount,
    evidence_refs: result.evidenceRefs,
  };
}

export function createSupabaseVenueGraphRepository(supabase: SupabaseLikeClient): VenueGraphRepository {
  return {
    async listVenues(): Promise<StoredVenue[]> {
      const { data, error } = await supabase
        .from('venues')
        .select('id,name,city,address,lat,lng');
      if (error) throw new Error(`Failed to list venues: ${error.message}`);
      return (data ?? []).map(toStoredVenue);
    },

    async listEvents(limit?: number): Promise<StoredEvent[]> {
      let query = supabase
        .from('events')
        .select('id,title_en,title_sv,source,source_id,venue_id,raw_data')
        .order('start_time', { ascending: false });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw new Error(`Failed to list events: ${error.message}`);
      return (data ?? []).map(toStoredEvent);
    },

    async upsertNodes(nodes: VenueGraphNode[]): Promise<void> {
      if (nodes.length === 0) return;
      const { error } = await supabase
        .from('venue_graph_nodes')
        .upsert(nodes.map(nodeRow), { onConflict: 'canonical_key' });
      if (error) throw new Error(`Failed to upsert graph nodes: ${error.message}`);
    },

    async upsertEdges(edges: VenueGraphEdge[]): Promise<void> {
      if (edges.length === 0) return;
      const { error } = await supabase
        .from('venue_graph_edges')
        .upsert(edges.map(edgeRow), { onConflict: 'canonical_key' });
      if (error) throw new Error(`Failed to upsert graph edges: ${error.message}`);
    },

    async insertObservations(observations: VenueGraphObservation[]): Promise<void> {
      if (observations.length === 0) return;
      const { error } = await supabase
        .from('venue_graph_observations')
        .upsert(observations.map(observationRow), { onConflict: 'observation_key' });
      if (error) throw new Error(`Failed to insert graph observations: ${error.message}`);
    },

    async upsertVenueCandidates(candidates: VenueCandidate[]): Promise<void> {
      if (candidates.length === 0) return;
      const { error } = await supabase
        .from('venue_candidates')
        .upsert(candidates.map(candidateRow), { onConflict: 'canonical_key' });
      if (error) throw new Error(`Failed to upsert venue candidates: ${error.message}`);
    },

    async enqueueExpansionTasks(candidates: VenueCandidate[]): Promise<void> {
      if (candidates.length === 0) return;
      const canonicalKeys = candidates.map((candidate) => candidate.canonicalKey);
      const { data, error } = await supabase
        .from('venue_candidates')
        .select('id,canonical_key,display_name,priority_score')
        .in('canonical_key', canonicalKeys);
      if (error) throw new Error(`Failed to read venue candidates for queueing: ${error.message}`);

      const tasks = (data ?? []).map((candidate: any) => ({
        task_type: 'find_source_for_venue',
        candidate_id: candidate.id,
        candidate_canonical_key: candidate.canonical_key,
        candidate_name: candidate.display_name,
        priority_score: candidate.priority_score,
        status: 'pending',
      }));

      if (tasks.length === 0) return;
      const { error: upsertError } = await supabase
        .from('venue_graph_expansion_queue')
        .upsert(tasks, { onConflict: 'task_type,candidate_canonical_key' });
      if (upsertError) throw new Error(`Failed to enqueue venue graph expansion tasks: ${upsertError.message}`);
    },

    async insertRun(summary: VenueGraphRunSummary): Promise<void> {
      const { error } = await supabase
        .from('venue_graph_runs')
        .insert(runRow(summary));
      if (error) throw new Error(`Failed to insert graph run: ${error.message}`);
    },

    async fetchPendingExpansionTasks(limit: number): Promise<ExpansionTask[]> {
      if (supabase.rpc) {
        const { data, error } = await supabase.rpc('claim_venue_graph_expansion_tasks', {
          task_limit: limit,
        });
        if (error) throw new Error(`Failed to claim expansion tasks: ${error.message}`);
        return (data ?? []).map(taskFromRow);
      }

      const { data, error } = await supabase
        .from('venue_graph_expansion_queue')
        .select('*')
        .eq('status', 'pending')
        .order('priority_score', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Failed to fetch expansion tasks: ${error.message}`);
      return (data ?? []).map(taskFromRow);
    },

    async markExpansionTaskProcessing(taskId: string): Promise<void> {
      const { error } = await supabase
        .from('venue_graph_expansion_queue')
        .update({
          status: 'processing',
          locked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)
        .in('status', ['pending', 'processing']);
      if (error) throw new Error(`Failed to mark expansion task processing: ${error.message}`);
    },

    async completeExpansionTask(taskId: string, result: ExpansionResult): Promise<void> {
      const { error: resultError } = await supabase
        .from('venue_graph_expansion_results')
        .insert(resultRow(result));
      if (resultError) throw new Error(`Failed to insert expansion result: ${resultError.message}`);

      const { error: updateError } = await supabase
        .from('venue_graph_expansion_queue')
        .update({
          status: 'expanded',
          expanded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
      if (updateError) throw new Error(`Failed to complete expansion task: ${updateError.message}`);
    },

    async failExpansionTask(taskId: string, errorMessage: string): Promise<void> {
      const { error } = await supabase
        .from('venue_graph_expansion_queue')
        .update({
          status: 'failed',
          last_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);
      if (error) throw new Error(`Failed to fail expansion task: ${error.message}`);
    },

    async findExpansionEvidence(task: ExpansionTask): Promise<ExpansionEvidence[]> {
      let query = supabase
        .from('venue_graph_observations')
        .select('evidence_id,source,metadata')
        .eq('observation_type', 'unresolved_venue_name')
        .eq('status', 'observed');
      if (task.candidateCanonicalKey) {
        query = query.eq('canonical_key', task.candidateCanonicalKey);
      } else {
        query = query.eq('display_name', task.candidateName);
      }
      const { data, error } = await query.limit(20);
      if (error) throw new Error(`Failed to find expansion evidence: ${error.message}`);

      return (data ?? []).map((row: any) => ({
        evidenceType: 'event_source',
        evidenceId: row.evidence_id,
        source: row.source ?? null,
        url: typeof row.metadata?.url === 'string' ? row.metadata.url : null,
      }));
    },
  };
}
