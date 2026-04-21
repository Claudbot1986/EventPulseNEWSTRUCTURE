import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Stockholm variants for priority scoring
const STOCKHOLM_VARIANTS = [
  'stockholm', 'södermalm', 'norrmalm', 'vasastan', 'östermalm',
  'kungsholmen', 'djurgården', 'gamla stan', 'johanneshov',
  'hammarby', 'kista', 'södertälje'
];

// Stockholm area priority (higher = more central/relevant)
const AREA_PRIORITY: Record<string, number> = {
  'norrmalm': 100,
  'södermalm': 95,
  'östermalm': 90,
  'kungsholmen': 85,
  'vasastan': 80,
  'gamla stan': 75,
  'djurgården': 70,
  'hammarby': 65,
  'kista': 50,
};

interface QueueEntry {
  candidate_name: string;
  city: string | null;
  source: string;
  source_venue_id: string | null;
  connection_count: number;
  promoter_count: number;
  attraction_count: number;
  priority_score: number;
  /** Quality score from discovery (higher = better venue) */
  quality_score: number;
  /** Confidence score 0-100 */
  confidence_score: number;
}

/**
 * Yield logging helper for expansion queue
 */
function logYieldQueueEntry(entry: QueueEntry): void {
  console.log(
    `[expansion] [YIELD] candidate=${entry.candidate_name} ` +
    `city=${entry.city || 'unknown'} priority_score=${entry.priority_score} ` +
    `confidence_score=${entry.confidence_score} connections=${entry.connection_count}`
  );
}

/**
 * Calculate priority score for a venue candidate
 * Factors:
 * - Stockholm city: +150
 * - Area priority: varies by neighborhood (up to +100)
 * - Each connection: +10
 * - Each promoter: +5
 * - Each attraction: +3
 * Quality score added separately (1x multiplier)
 */
function calculatePriorityScore(
  city: string | null,
  connectionCount: number,
  promoterCount: number,
  attractionCount: number
): number {
  let score = 0;

  // Stockholm city priority (higher than before)
  const normalizedCity = (city || '').toLowerCase();
  if (STOCKHOLM_VARIANTS.some(v => normalizedCity.includes(v))) {
    score += 150;
  }

  // Area priority bonus
  const area = normalizedCity.split(',')[0].trim();
  const areaScore = AREA_PRIORITY[area];
  if (areaScore) {
    score += areaScore;
  }

  // Connection count
  score += connectionCount * 10;

  // Promoter bonus
  score += promoterCount * 5;

  // Attraction bonus
  score += attractionCount * 3;

  return score;
}

/**
 * Build expansion queue from discovery graph
 * Reads from discovery_venue_candidates and discovery_venue_connections
 * Writes prioritized candidates to discovery_expansion_queue
 */
export async function buildExpansionQueue(): Promise<void> {
  console.log('[expansion] buildExpansionQueue called');

  // Fetch all candidates with their connection counts
  const { data: candidates, error: candidatesError } = await supabase
    .from('discovery_venue_candidates')
    .select('id, name, city, source, source_id');

  if (candidatesError) {
    console.error('[expansion] Failed to fetch candidates:', candidatesError.message);
    return;
  }

  if (!candidates || candidates.length === 0) {
    console.log('[expansion] No candidates found in discovery_venue_candidates');
    return;
  }

  console.log(`[expansion] Found ${candidates.length} candidates`);

  // Fetch connection counts per venue name
  const { data: connections, error: connectionsError } = await supabase
    .from('discovery_venue_connections')
    .select('source_venue_name, connected_entity_type, connected_entity_name');

  if (connectionsError) {
    console.error('[expansion] Failed to fetch connections:', connectionsError.message);
    return;
  }

  console.log(`[expansion] Found ${connections?.length || 0} connections`);

  // Build connection map by venue name
  const connectionMap = new Map<string, { promoters: Set<string>; attractions: Set<string> }>();
  for (const conn of connections || []) {
    if (!connectionMap.has(conn.source_venue_name)) {
      connectionMap.set(conn.source_venue_name, { promoters: new Set(), attractions: new Set() });
    }
    const entry = connectionMap.get(conn.source_venue_name)!;
    if (conn.connected_entity_type === 'promoter') {
      entry.promoters.add(conn.connected_entity_name);
    } else if (conn.connected_entity_type === 'attraction') {
      entry.attractions.add(conn.connected_entity_name);
    }
  }

  // Build queue entries
  const queueEntries: QueueEntry[] = [];
  for (const candidate of candidates) {
    const connInfo = connectionMap.get(candidate.name) || { promoters: new Set(), attractions: new Set() };
    const promoterCount = connInfo.promoters.size;
    const attractionCount = connInfo.attractions.size;
    const connectionCount = promoterCount + attractionCount;

    // Skip venues with no connections (nothing to expand from)
    if (connectionCount === 0) {
      continue;
    }

    const priorityScore = calculatePriorityScore(
      candidate.city,
      connectionCount,
      promoterCount,
      attractionCount
    );

    // Get quality score and confidence score from candidate (if available)
    const qualityScore = (candidate as any).quality_score || 0;
    const confidenceScore = (candidate as any).confidence_score || qualityScore;

    // Boost priority for high-quality venues (1x multiplier)
    // High quality venue (90+) gets significant boost
    let boostedPriority = priorityScore + qualityScore;

    // Seed venue bonus: known Stockholm venues get extra boost
    if ((candidate as any).source === 'stockholm_seed') {
      boostedPriority += 50;
    }

    queueEntries.push({
      candidate_name: candidate.name,
      city: candidate.city,
      source: candidate.source,
      source_venue_id: candidate.source_id,
      connection_count: connectionCount,
      promoter_count: promoterCount,
      attraction_count: attractionCount,
      priority_score: Math.round(boostedPriority),
      quality_score: qualityScore,
      confidence_score: confidenceScore,
    });
  }

  if (queueEntries.length === 0) {
    console.log('[expansion] No candidates with connections to expand');
    return;
  }

  // Sort by priority and take top 50
  queueEntries.sort((a, b) => b.priority_score - a.priority_score);
  const topEntries = queueEntries.slice(0, 50);

  console.log(`[expansion] Prepared ${topEntries.length} queue entries for upsert`);

  console.log(`[expansion] Top candidates:`);
  for (const entry of topEntries.slice(0, 5)) {
    console.log(`  - ${entry.candidate_name} (${entry.city}) score=${entry.priority_score}`);
  }

  // Yield logging: top entries
  console.log(`[expansion] [YIELD] top_entries=${topEntries.length}`);
  for (const entry of topEntries.slice(0, 3)) {
    logYieldQueueEntry(entry);
  }

  // Upsert to expansion queue
  const { error: upsertError } = await supabase
    .from('discovery_expansion_queue')
    .upsert(
      topEntries.map(entry => ({
        candidate_name: entry.candidate_name,
        city: entry.city,
        source: entry.source,
        source_venue_id: entry.source_venue_id,
        connection_count: entry.connection_count,
        promoter_count: entry.promoter_count,
        attraction_count: entry.attraction_count,
        priority_score: entry.priority_score,
        quality_score: entry.quality_score,
        confidence_score: entry.confidence_score,
        status: 'pending',
      })),
      { onConflict: 'candidate_name,source' }
    );

  if (upsertError) {
    console.error('[expansion] ❌ Failed to upsert expansion queue:', upsertError.message);
    console.error('[expansion] Error details:', JSON.stringify(upsertError));
  } else {
    console.log(`[expansion] ✅ Successfully added ${topEntries.length} candidates to discovery_expansion_queue`);
    // Yield logging: final summary
    const totalConfidence = topEntries.reduce((sum, e) => sum + e.confidence_score, 0);
    const avgConfidence = topEntries.length > 0 ? totalConfidence / topEntries.length : 0;
    console.log(`[expansion] [YIELD] total_added=${topEntries.length} avg_confidence_score=${avgConfidence.toFixed(2)}`);
  }
}
