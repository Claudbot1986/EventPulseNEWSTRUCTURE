import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ExpansionCandidate {
  id: string;
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

  // For now, this is a placeholder that simulates expansion
  // In future phases this will do actual BFS traversal via connections

  const resultSummary = `Simulated expansion for ${candidate.candidate_name}. ` +
    `Found ${candidate.connection_count} connections ` +
    `(${candidate.promoter_count} promoters, ${candidate.attraction_count} attractions).`;

  const { error } = await supabase
    .from('discovery_expansion_results')
    .insert({
      candidate_name: candidate.candidate_name,
      city: candidate.city,
      source: candidate.source,
      source_venue_id: candidate.source_venue_id,
      expansion_type: 'basic',
      result_summary: resultSummary,
      new_venues_found: 0,
      new_connections_found: candidate.connection_count,
    });

  if (error) {
    console.error(`[expansion-worker] ❌ Failed to save expansion result:`, error.message);
  } else {
    console.log(`[expansion-worker] ✅ Saved expansion result for: ${candidate.candidate_name}`);
    // Yield logging
    console.log(
      `[expansion-worker] [YIELD] processed candidate=${candidate.candidate_name} ` +
      `new_connections=${candidate.connection_count}`
    );
  }

  console.log(`[expansion-worker] Marking candidate as expanded...`);

  // Mark candidate as expanded
  await markCandidateExpanded(candidate.id);
}

/**
 * Process a batch of candidates
 */
export async function processExpansionBatch(batchSize = 5): Promise<void> {
  console.log(`[expansion-worker] ========================================`);
  console.log(`[expansion-worker] Starting expansion batch (batchSize=${batchSize})`);

  const startTime = Date.now();
  const candidates = await fetchNextExpansionCandidates(batchSize);
  if (candidates.length === 0) {
    console.log('[expansion-worker] No candidates to process');
    return;
  }

  console.log(`[expansion-worker] Processing ${candidates.length} candidates...`);

  let successCount = 0;
  let errorCount = 0;

  for (const candidate of candidates) {
    try {
      await processExpansionCandidate(candidate);
      successCount++;
    } catch (err: any) {
      console.error(`[expansion-worker] ❌ Error processing ${candidate.candidate_name}:`, err.message);
      errorCount++;
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[expansion-worker] ========================================`);
  console.log(`[expansion-worker] ✅ Batch complete`);
  console.log(`[expansion-worker]   processed: ${candidates.length} candidates`);
  console.log(`[expansion-worker]   successful: ${successCount}`);
  console.log(`[expansion-worker]   errors: ${errorCount}`);
  console.log(`[expansion-worker]   duration: ${duration}ms`);

  // Yield logging: batch summary
  console.log(`[expansion-worker] [YIELD] batch_complete processed=${candidates.length} successful=${successCount} errors=${errorCount} duration_ms=${duration}`);
  console.log(`[expansion-worker] ========================================`);
}

/**
 * Fetch next batch of pending expansion candidates from the queue.
 * Marks them as 'processing' to avoid duplicate processing.
 */
export async function fetchNextExpansionCandidates(batchSize = 10): Promise<ExpansionCandidate[]> {
  console.log(`[expansion-worker] Fetching next ${batchSize} pending candidates...`);

  // First, mark candidates as 'processing'
  const { data: candidates, error: fetchError } = await supabase
    .from('discovery_expansion_queue')
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

  // Mark them as processing
  const candidateIds = candidates.map((c: any) => c.id);
  const { error: updateError } = await supabase
    .from('discovery_expansion_queue')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .in('id', candidateIds);

  if (updateError) {
    console.error('[expansion-worker] Failed to mark candidates as processing:', updateError.message);
    return [];
  }

  console.log(`[expansion-worker] Marked ${candidateIds.length} candidates as processing`);
  return candidates as ExpansionCandidate[];
}

/**
 * Mark a candidate as expanded (completed)
 */
export async function markCandidateExpanded(candidateId: string): Promise<void> {
  const { error } = await supabase
    .from('discovery_expansion_queue')
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
    .from('discovery_expansion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const { count: processing } = await supabase
    .from('discovery_expansion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing');

  const { count: expanded } = await supabase
    .from('discovery_expansion_queue')
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
