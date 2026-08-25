import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ExpansionCandidate {
  id: string;
  candidate_canonical_key?: string | null;
  candidate_name: string;
  city: string | null;
  source: string;
  source_venue_id: string | null;
  priority_score: number;
  connection_count: number;
  promoter_count: number;
  attraction_count: number;
  hop_level: number;
  confidence_score?: number;
}

interface ExpansionBatchSummary {
  processed: number;
  successful: number;
  errors: number;
}

async function findExpansionEvidence(candidate: ExpansionCandidate): Promise<any[]> {
  let query = supabase
    .from('venue_graph_observations')
    .select('evidence_id,source,metadata')
    .eq('observation_type', 'unresolved_venue_name')
    .eq('status', 'observed');

  if (candidate.candidate_canonical_key) {
    query = query.eq('canonical_key', candidate.candidate_canonical_key);
  } else {
    query = query.eq('display_name', candidate.candidate_name);
  }

  const { data, error } = await query.limit(20);
  if (error) {
    throw new Error(`Failed to find expansion evidence: ${error.message}`);
  }
  return data || [];
}

async function markCandidateFailed(candidateId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('venue_graph_expansion_queue')
    .update({
      status: 'failed',
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId);
  if (error) {
    console.error('[expansion-worker] Failed to mark candidate failed:', error.message);
  }
}

/**
 * Fetch next batch of pending expansion candidates from the queue.
 * Marks them as 'processing' to avoid duplicate processing.
 */
export async function processExpansionCandidate(candidate: ExpansionCandidate): Promise<void> {
  console.log(`[expansion-worker] ========================================`);
  console.log(`[expansion-worker] Processing: ${candidate.candidate_name}`);
  console.log(`[expansion-worker]   city: ${candidate.city || 'unknown'}`);
  console.log(`[expansion-worker]   source: ${candidate.source}`);
  console.log(`[expansion-worker]   priority_score: ${candidate.priority_score}`);
  console.log(`[expansion-worker]   connections: ${candidate.connection_count} (${candidate.promoter_count} promoters, ${candidate.attraction_count} attractions)`);
  console.log(`[expansion-worker]   hop_level: ${candidate.hop_level}`);
  if (candidate.confidence_score !== undefined) {
    console.log(`[expansion-worker]   confidence_score: ${candidate.confidence_score}`);
  }

  // Yield logging
  console.log(
    `[expansion-worker] [YIELD] processing candidate=${candidate.candidate_name} ` +
    `confidence_score=${candidate.confidence_score ?? 'unknown'} ` +
    `connections=${candidate.connection_count}`
  );

  const { error: lockError } = await supabase
    .from('venue_graph_expansion_queue')
    .update({
      status: 'processing',
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidate.id)
    .in('status', ['pending', 'processing']);
  if (lockError) {
    throw new Error(`Failed to mark expansion task processing: ${lockError.message}`);
  }

  const evidence = await findExpansionEvidence(candidate);
  const result = {
    task_id: candidate.id,
    measured: true,
    result_summary: [
      `Measured expansion for ${candidate.candidate_name}`,
      'task_type=find_source_for_venue',
      `evidence_refs=${evidence.length}`,
      'source_candidates_created=0',
    ].join('; '),
    new_nodes_count: 0,
    new_edges_count: 0,
    new_venue_candidates_count: 0,
    new_source_candidates_count: 0,
    evidence_refs: evidence,
  };

  const { error: resultError } = await supabase
    .from('venue_graph_expansion_results')
    .insert(result);
  if (resultError) {
    throw new Error(`Failed to insert measured expansion result: ${resultError.message}`);
  }

  await markCandidateExpanded(candidate.id);
  console.log(`[expansion-worker] ✅ Saved measured expansion result for: ${candidate.candidate_name}`);
  console.log(
    `[expansion-worker] [YIELD] processed candidate=${candidate.candidate_name} ` +
    `new_sources=0 evidence_refs=${evidence.length}`
  );
}

async function claimExpansionCandidates(batchSize: number): Promise<ExpansionCandidate[]> {
  const { data, error } = await supabase.rpc('claim_venue_graph_expansion_tasks', {
    task_limit: batchSize,
  });
  if (error) {
    throw new Error(`Failed to claim expansion candidates: ${error.message}`);
  }
  return (data || []).map((candidate: any) => ({
    id: candidate.id,
    candidate_canonical_key: candidate.candidate_canonical_key,
    candidate_name: candidate.candidate_name,
    city: null,
    source: 'venue_graph',
    source_venue_id: candidate.candidate_id,
    priority_score: candidate.priority_score,
    connection_count: 0,
    promoter_count: 0,
    attraction_count: 0,
    hop_level: 0,
  }));
}

async function runMeasuredExpansionBatch(batchSize: number): Promise<ExpansionBatchSummary> {
  const candidates = await claimExpansionCandidates(batchSize);
  let successful = 0;
  let errors = 0;

  for (const candidate of candidates) {
    try {
      await processExpansionCandidate(candidate);
      successful++;
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[expansion-worker] ❌ Error processing ${candidate.candidate_name}:`, message);
      await markCandidateFailed(candidate.id, message);
    }
  }

  return {
    processed: candidates.length,
    successful,
    errors,
  };
}

/**
 * Process a batch of candidates
 */
export async function processExpansionBatch(batchSize = 5): Promise<void> {
  console.log(`[expansion-worker] ========================================`);
  console.log(`[expansion-worker] Starting expansion batch (batchSize=${batchSize})`);

  const startTime = Date.now();
  const summary = await runMeasuredExpansionBatch(batchSize);
  if (summary.processed === 0) {
    console.log('[expansion-worker] No candidates to process');
    return;
  }

  const duration = Date.now() - startTime;
  console.log(`[expansion-worker] ========================================`);
  console.log(`[expansion-worker] ✅ Batch complete`);
  console.log(`[expansion-worker]   processed: ${summary.processed} candidates`);
  console.log(`[expansion-worker]   successful: ${summary.successful}`);
  console.log(`[expansion-worker]   errors: ${summary.errors}`);
  console.log(`[expansion-worker]   duration: ${duration}ms`);

  // Yield logging: batch summary
  console.log(`[expansion-worker] [YIELD] batch_complete processed=${summary.processed} successful=${summary.successful} errors=${summary.errors} duration_ms=${duration}`);
  console.log(`[expansion-worker] ========================================`);
}

/**
 * Fetch next batch of pending expansion candidates from the queue.
 * Marks them as 'processing' to avoid duplicate processing.
 */
export async function fetchNextExpansionCandidates(batchSize = 10): Promise<ExpansionCandidate[]> {
  console.log(`[expansion-worker] Fetching next ${batchSize} pending candidates...`);

  const { data: candidates, error: fetchError } = await supabase
    .from('venue_graph_expansion_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority_score', { ascending: false })
    .limit(batchSize);

  if (fetchError) {
    console.error('[expansion-worker] Failed to fetch candidates:', fetchError.message);
    return [];
  }

  if (!candidates || candidates.length === 0) {
    console.log('[expansion-worker] No pending candidates in queue');
    return [];
  }

  console.log(`[expansion-worker] Found ${candidates.length} pending candidates`);

  return candidates.map((candidate: any) => ({
    id: candidate.id,
    candidate_canonical_key: candidate.candidate_canonical_key,
    candidate_name: candidate.candidate_name,
    city: null,
    source: 'venue_graph',
    source_venue_id: candidate.candidate_id,
    priority_score: candidate.priority_score,
    connection_count: 0,
    promoter_count: 0,
    attraction_count: 0,
    hop_level: 0,
  }));
}

/**
 * Mark a candidate as expanded (completed)
 */
export async function markCandidateExpanded(candidateId: string): Promise<void> {
  const { error } = await supabase
    .from('venue_graph_expansion_queue')
    .update({ status: 'expanded', updated_at: new Date().toISOString() })
    .eq('id', candidateId);

  if (error) {
    console.error('[expansion-worker] Failed to mark candidate as expanded:', error.message);
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{ pending: number; processing: number; expanded: number }> {
  const { count: pending } = await supabase
    .from('venue_graph_expansion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const { count: processing } = await supabase
    .from('venue_graph_expansion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing');

  const { count: expanded } = await supabase
    .from('venue_graph_expansion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'expanded');

  const stats = {
    pending: pending || 0,
    processing: processing || 0,
    expanded: expanded || 0,
  };

  console.log(`[expansion-worker] Queue stats:`, stats);

  // Yield logging
  console.log(
    `[expansion-worker] [YIELD] queue_stats pending=${stats.pending} ` +
    `processing=${stats.processing} expanded=${stats.expanded}`
  );

  return stats;
}
