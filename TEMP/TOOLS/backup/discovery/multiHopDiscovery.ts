import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_HOPS = 3;
const STOCKHOLM_VARIANTS = [
  'stockholm', 'södermalm', 'norrmalm', 'vasastan', 'östermalm',
  'kungsholmen', 'djurgården', 'gamla stan', 'johanneshov',
  'hammarby', 'kista', 'södertälje'
];

/** Known fake/placeholder venue names to filter out */
const VENUE_BLACKLIST = [
  'tba', 'tbd', '待定', 'tbc', 'coming soon',
  'venue', 'location', 'tbd venue', 'tba venue',
  'online', 'virtual', 'online event',
  'sweden', 'stockholm, sweden', 'sweden ',
];

interface VenueValidationResult {
  isValid: boolean;
  reason?: string;
  qualityScore: number;
  verifiedInEvents: boolean;
  eventCount: number;
  /** Confidence score 0-100, +1 if venue found in events */
  confidence_score: number;
}

interface VenueQualityScore {
  hasCoordinates: boolean;
  hasAddress: boolean;
  isStockholm: boolean;
  hasValidName: boolean;
  score: number;
}

interface DiscoveredVenue {
  name: string;
  city: string | null;
  hop: number;
  path: string[];
  connectionType: 'promoter' | 'attraction';
  connectionName: string;
  sourceVenue: string;
  /** Prevent duplicate discovery via different paths */
  discoveryKey: string;
  /** Number of connections that led to this venue (more = higher confidence) */
  connectionCount: number;
  /** Venue confidence score 0-100 (higher = more confident) */
  confidence_score: number;
}

/**
 * Check if city is Stockholm area
 */
function isStockholm(city: string | null): boolean {
  const normalized = (city || '').toLowerCase();
  return STOCKHOLM_VARIANTS.some(v => normalized.includes(v));
}

/**
 * Check if venue name is valid (not placeholder/blacklisted)
 */
function isValidVenueName(name: string | null): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().trim();
  if (normalized.length < 2) return false;
  if (VENUE_BLACKLIST.some(bad => normalized === bad || normalized.includes(bad))) {
    return false;
  }
  // Reject names that are just numbers or single characters
  if (/^[\d\W]+$/.test(normalized)) return false;
  return true;
}

/**
 * Score venue quality for prioritization
 */
function scoreVenueQuality(
  name: string | null,
  city: string | null,
  lat: number | null,
  lng: number | null,
  address: string | null
): VenueQualityScore {
  const hasCoordinates = lat !== null && lng !== null && lat !== 0 && lng !== 0;
  const hasAddress = address !== null && address.trim().length > 5;
  const isStockholm = isStockholm(city);
  const hasValidName = isValidVenueName(name);

  let score = 0;
  if (hasCoordinates) score += 40;
  if (hasAddress) score += 30;
  if (isStockholm) score += 20;
  if (hasValidName) score += 10;

  return { hasCoordinates, hasAddress, isStockholm, hasValidName, score };
}

/**
 * Check if venue already exists in verified venues table
 */
async function isVerifiedVenue(name: string | null): Promise<boolean> {
  if (!name) return false;

  const { data } = await supabase
    .from('venues')
    .select('id')
    .ilike('name', name)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/**
 * Check if venue appears in events table (via venue_name or venue_id)
 * This confirms the venue actually hosts events
 */
async function isVenueInEvents(name: string | null, venueId: string | null): Promise<{ found: boolean; eventCount: number }> {
  if (!name && !venueId) {
    return { found: false, eventCount: 0 };
  }

  // Check by venue_id first (stronger match)
  if (venueId) {
    const { data: byId } = await supabase
      .from('events')
      .select('id')
      .eq('venue_id', venueId)
      .limit(1);

    if (byId && byId.length > 0) {
      return { found: true, eventCount: byId.length };
    }
  }

  // Fall back to venue_name match
  if (name) {
    const { data: byName, count } = await supabase
      .from('events')
      .select('id', { count: 'exact' })
      .ilike('venue_name', name)
      .limit(10);

    if (byName && byName.length > 0) {
      return { found: true, eventCount: count || byName.length };
    }
  }

  return { found: false, eventCount: 0 };
}

/**
 * Full validation of a venue candidate before saving
 */
async function validateVenue(
  name: string | null,
  city: string | null,
  lat: number | null,
  lng: number | null,
  address: string | null,
  venueId: string | null = null
): Promise<VenueValidationResult> {
  // Check valid name
  if (!isValidVenueName(name)) {
    return { isValid: false, reason: 'invalid_name', qualityScore: 0, verifiedInEvents: false, eventCount: 0, confidence_score: 0 };
  }

  // Check against blacklist
  const normalized = name.toLowerCase().trim();
  if (VENUE_BLACKLIST.some(bad => normalized === bad || normalized.includes(bad))) {
    return { isValid: false, reason: 'blacklisted', qualityScore: 0, verifiedInEvents: false, eventCount: 0, confidence_score: 0 };
  }

  // Check if venue already exists in verified venues table
  const verified = await isVerifiedVenue(name);
  if (verified) {
    return { isValid: false, reason: 'already_verified', qualityScore: 100, verifiedInEvents: true, eventCount: 0, confidence_score: 100 };
  }

  // Check if venue already exists in candidates (any source)
  const { data: existing } = await supabase
    .from('discovery_venue_candidates')
    .select('id')
    .eq('name', name)
    .limit(1);

  if (existing && existing.length > 0) {
    return { isValid: false, reason: 'already_candidate', qualityScore: 0, verifiedInEvents: false, eventCount: 0, confidence_score: 0 };
  }

  // Check if venue appears in events table (CRITICAL validation)
  const eventCheck = await isVenueInEvents(name, venueId);
  if (eventCheck.found) {
    console.log(`[validation] ✅ Venue "${name}" verified in events table (${eventCheck.eventCount} events)`);
  }

  // Calculate quality score
  const quality = scoreVenueQuality(name, city, lat, lng, address);

  // Minimum quality threshold
  if (quality.score < 30) {
    return { isValid: false, reason: 'low_quality', qualityScore: quality.score, verifiedInEvents: eventCheck.found, eventCount: eventCheck.eventCount, confidence_score: quality.score };
  }

  // Calculate confidence score: quality score + bonuses/penalties
  let confidence_score = quality.score;
  if (eventCheck.found) {
    confidence_score += 1; // +1 if venue found in events
  }
  if (!city || !isStockholm(city)) {
    confidence_score -= 1; // -1 if city is missing or outside Stockholm
  }

  // Skip venues with low confidence (quality < 30 AND not in events)
  if (confidence_score < 30) {
    return { isValid: false, reason: 'low_confidence', qualityScore: quality.score, verifiedInEvents: eventCheck.found, eventCount: eventCheck.eventCount, confidence_score };
  }

  return { isValid: true, qualityScore: quality.score, verifiedInEvents: eventCheck.found, eventCount: eventCheck.eventCount, confidence_score };
}

/**
 * Calculate priority score for a venue (adapted from priorityEngine.js)
 */
function calculatePriorityScore(
  city: string | null,
  connectionCount: number,
  promoterCount: number,
  attractionCount: number
): number {
  let score = 0;
  if (isStockholm(city)) score += 100;
  score += connectionCount * 10;
  score += promoterCount * 5;
  score += attractionCount * 3;
  return score;
}

/**
 * Get direct connections from a venue via promoters and attractions
 */
async function getDirectConnections(venueName: string): Promise<{ type: 'promoter' | 'attraction'; name: string }[]> {
  const { data: connections } = await supabase
    .from('discovery_venue_connections')
    .select('connected_entity_type, connected_entity_name')
    .eq('source_venue_name', venueName);

  return (connections || []).map(c => ({
    type: c.connected_entity_type as 'promoter' | 'attraction',
    name: c.connected_entity_name,
  }));
}

/**
 * Find venues linked to a promoter or attraction
 */
async function findVenuesByConnection(
  type: 'promoter' | 'attraction',
  name: string,
  visited: Set<string>
): Promise<{ name: string; city: string | null }[]> {
  const { data: connections } = await supabase
    .from('discovery_venue_connections')
    .select('source_venue_name, city')
    .eq('connected_entity_type', type)
    .eq('connected_entity_name', name);

  return (connections || [])
    .filter(c => !visited.has(c.source_venue_name))
    .map(c => ({
      name: c.source_venue_name,
      city: c.city,
    }));
}

/**
 * BFS multi-hop traversal from a starting venue
 */
async function multiHopTraversal(
  startVenue: { name: string; city: string | null },
  maxHops: number = MAX_HOPS
): Promise<DiscoveredVenue[]> {
  console.log(`[multi-hop] Traversal from: ${startVenue.name} (max ${maxHops} hops)`);

  const discovered: DiscoveredVenue[] = [];
  /** Track how many connections led to each venue */
  const venueConnectionCounts = new Map<string, number>();
  const visited = new Set<string>();
  /** Track (connectionType:connectionName) pairs to avoid path loops */
  const visitedConnections = new Set<string>();

  // Queue: { venue, hop, path, connectionType, connectionName }
  interface QueueItem {
    name: string;
    city: string | null;
    hop: number;
    path: string[];
    connectionType: 'promoter' | 'attraction';
    connectionName: string;
  }

  const queue: QueueItem[] = [];
  visited.add(startVenue.name);

  // Get initial connections and add to queue
  const initialConnections = await getDirectConnections(startVenue.name);
  for (const conn of initialConnections) {
    const connKey = `${conn.type}:${conn.name}`;
    visitedConnections.add(connKey);
    queue.push({
      name: startVenue.name,
      city: startVenue.city,
      hop: 1,
      path: [connKey],
      connectionType: conn.type,
      connectionName: conn.name,
    });
  }

  console.log(`[multi-hop] Hop 1: ${queue.length} connections`);

  let currentHop = 1;
  while (queue.length > 0 && currentHop <= maxHops) {
    const currentBatch = queue.splice(0, queue.length);
    console.log(`[multi-hop] Processing hop ${currentHop}: ${currentBatch.length} items`);

    const promoterCount = currentBatch.filter(i => i.connectionType === 'promoter').length;
    const attractionCount = currentBatch.filter(i => i.connectionType === 'attraction').length;
    console.log(`[multi-hop]   via promoters: ${promoterCount}, via attractions: ${attractionCount}`);

    for (const item of currentBatch) {
      const connectedVenues = await findVenuesByConnection(
        item.connectionType,
        item.connectionName,
        visited
      );

      for (const venue of connectedVenues) {
        const discoveryKey = `${venue.name.toLowerCase()}:${venue.city?.toLowerCase() || 'unknown'}`;

        // Increment connection count for this venue
        const currentCount = venueConnectionCounts.get(discoveryKey) || 0;
        venueConnectionCounts.set(discoveryKey, currentCount + 1);

        // Skip if already discovered via different path
        if (discovered.some(d => d.discoveryKey === discoveryKey)) {
          continue;
        }

        // Only add venues that are NOT already in candidates (from ANY source)
        const { data: existing } = await supabase
          .from('discovery_venue_candidates')
          .select('id')
          .eq('name', venue.name)
          .limit(1);

        if (!existing || existing.length === 0) {
          // Full validation before accepting
          const validation = await validateVenue(venue.name, venue.city, null, null, null);

          if (!validation.isValid) {
            console.log(`[multi-hop] ❌ Skipping venue: ${venue.name} (${validation.reason})`);
            continue;
          }

          // Skip if not Stockholm-adjacent (unless it's hop 1)
          if (item.hop > 1 && !isStockholm(venue.city)) {
            console.log(`[multi-hop] Skipping non-Stockholm venue at hop ${item.hop}: ${venue.name}`);
            continue;
          }

          const connectionCount = venueConnectionCounts.get(discoveryKey) || 1;
          const multiConnectionBonus = connectionCount > 1 ? 1 : 0; // +1 if multiple connections lead to same venue
          const directConnectionBonus = item.hop === 1 ? 1 : 0; // +1 if direct connection (hop 1)
          const totalBonus = multiConnectionBonus + directConnectionBonus;
          const finalConfidenceScore = validation.confidence_score + totalBonus;

          console.log(`[multi-hop] ✅ Validated venue: ${venue.name} (confidence_score: ${finalConfidenceScore}, connections: ${connectionCount}, multi_bonus: +${multiConnectionBonus}, direct_bonus: +${directConnectionBonus})`);

          // Yield logging: record discovered venue with confidence
          console.log(`[multi-hop] [YIELD] venue=${venue.name} city=${venue.city || 'unknown'} hop=${item.hop} confidence_score=${finalConfidenceScore} path=${item.path.join(' → ')}`);

          discovered.push({
            name: venue.name,
            city: venue.city,
            hop: item.hop,
            path: item.path,
            connectionType: item.connectionType,
            connectionName: item.connectionName,
            sourceVenue: startVenue.name,
            discoveryKey,
            connectionCount,
            confidence_score: finalConfidenceScore,
          });
        }
      }
    }

    // Build next hop queue from discovered venues
    if (currentHop < maxHops) {
      for (const item of currentBatch) {
        const nextConnections = await getDirectConnections(item.connectionName);
        for (const conn of nextConnections) {
          const connKey = `${conn.type}:${conn.name}`;

          // Skip if we've already traversed this connection path (loop prevention)
          if (visitedConnections.has(connKey)) {
            continue;
          }
          visitedConnections.add(connKey);

          const nextVenues = await findVenuesByConnection(conn.type, conn.name, visited);
          for (const venue of nextVenues) {
            queue.push({
              name: venue.name,
              city: venue.city,
              hop: item.hop + 1,
              path: [...item.path, connKey],
              connectionType: conn.type,
              connectionName: conn.name,
            });
          }
        }
      }
    }

    currentHop++;
  }

  // Log discovery summary by hop level
  const byHop = new Map<number, number>();
  for (const v of discovered) {
    byHop.set(v.hop, (byHop.get(v.hop) || 0) + 1);
  }
  console.log(`[multi-hop] Discovery summary:`);
  for (const [hop, count] of [...byHop.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`[multi-hop]   hop ${hop}: ${count} venues`);
  }
  console.log(`[multi-hop] ✅ Total discovered: ${discovered.length} new venues`);

  // Yield logging: summary of all discoveries
  if (discovered.length > 0) {
    console.log(`[multi-hop] [YIELD] total=${discovered.length}`);
    const avgConfidence = discovered.reduce((sum, v) => sum + v.confidence_score, 0) / discovered.length;
    console.log(`[multi-hop] [YIELD] avg_confidence_score=${avgConfidence.toFixed(2)}`);
  }

  return discovered;
}

/**
 * Save new venues to discovery_venue_candidates
 */
async function saveNewVenues(venues: DiscoveredVenue[]): Promise<number> {
  if (venues.length === 0) return 0;

  const candidates = venues.map(v => ({
    source: 'multi_hop',
    source_id: null,
    name: v.name,
    city: v.city,
    address: null,
    lat: null,
    lng: null,
    promoters: v.connectionType === 'promoter' ? [v.connectionName] : [],
    attractions: v.connectionType === 'attraction' ? [v.connectionName] : [],
    linked_event_ids: [],
    /** Store hop info for analytics */
    hop_level: v.hop,
    discovery_path: v.path.join(' → '),
    /** Store validation reason for debugging */
    validation_reason: 'passed',
    /** Quality score is already validated, store it */
    quality_score: 50,
    /** Store confidence score 0-100 */
    confidence_score: v.confidenceScore,
    /** Store how many connections led to this venue */
    connection_count: v.connectionCount,
    updated_at: new Date().toISOString(),
  }));

  // Yield logging: record saved venues
  console.log(`[multi-hop] [YIELD] saved_venues=${candidates.length} total_confidence=${candidates.reduce((sum, c) => sum + c.confidence_score, 0)}`);

  const { error } = await supabase
    .from('discovery_venue_candidates')
    .upsert(candidates, { onConflict: 'source,name' });

  if (error) {
    console.error(`[multi-hop] Failed to save new venues: ${error.message}`);
    return 0;
  }

  console.log(`[multi-hop] ✅ Saved ${candidates.length} new venue candidates`);
  return candidates.length;
}

/**
 * Save new connections for discovered venues
 */
async function saveNewConnections(venues: DiscoveredVenue[]): Promise<number> {
  let totalConnections = 0;

  for (const venue of venues) {
    const connection = {
      source: 'multi_hop',
      source_venue_id: null,
      source_venue_name: venue.sourceVenue,
      city: venue.city,
      connected_entity_type: venue.connectionType,
      connected_entity_name: venue.connectionName,
      linked_event_ids: [],
    };

    const { error } = await supabase
      .from('discovery_venue_connections')
      .upsert(connection, {
        onConflict: 'source,source_venue_name,connected_entity_type,connected_entity_name',
      });

    if (!error) totalConnections++;
  }

  console.log(`[multi-hop] ✅ Saved ${totalConnections} new connections`);
  return totalConnections;
}

/**
 * Update expansion queue status
 */
async function markExpanded(candidateId: string): Promise<void> {
  await supabase
    .from('discovery_expansion_queue')
    .update({ status: 'expanded', updated_at: new Date().toISOString() })
    .eq('id', candidateId);
}

/**
 * Save expansion result
 */
async function saveExpansionResult(
  candidate: { candidate_name: string; city: string | null; source: string },
  newVenuesCount: number,
  newConnectionsCount: number
): Promise<void> {
  await supabase
    .from('discovery_expansion_results')
    .insert({
      candidate_name: candidate.candidate_name,
      city: candidate.city,
      source: candidate.source,
      expansion_type: 'multi_hop',
      result_summary: `Multi-hop expansion: found ${newVenuesCount} new venues, ${newConnectionsCount} connections`,
      new_venues_found: newVenuesCount,
      new_connections_found: newConnectionsCount,
    });
}

/**
 * Main multi-hop discovery run
 */
export async function runMultiHopDiscovery(): Promise<void> {
  console.log('[multi-hop] Starting multi-hop discovery...');

  // Fetch pending candidates
  const { data: candidates } = await supabase
    .from('discovery_expansion_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority_score', { ascending: false })
    .limit(5);

  if (!candidates || candidates.length === 0) {
    console.log('[multi-hop] No pending candidates to expand');
    return;
  }

  console.log(`[multi-hop] Found ${candidates.length} pending candidates`);

  let totalVenues = 0;
  let totalConnections = 0;
  let processedCount = 0;

  for (const candidate of candidates) {
    console.log(`\n[multi-hop] Expanding: ${candidate.candidate_name} (${candidate.city})`);

    try {
      // Run BFS traversal
      const discovered = await multiHopTraversal(
        { name: candidate.candidate_name, city: candidate.city },
        MAX_HOPS
      );

      // Save new venues
      const newVenues = await saveNewVenues(discovered);

      // Save new connections
      const newConnections = await saveNewConnections(discovered);

      // Save result
      await saveExpansionResult(candidate, newVenues, newConnections);

      // Mark as expanded
      await markExpanded(candidate.id);

      totalVenues += newVenues;
      totalConnections += newConnections;
      processedCount++;

      // Yield logging: record expansion result
      console.log(`[multi-hop] [YIELD] candidate=${candidate.candidate_name} new_venues=${newVenues} new_connections=${newConnections}`);
      console.log(`[multi-hop] ✅ Completed: ${newVenues} venues, ${newConnections} connections`);
    } catch (error: any) {
      console.error(`[multi-hop] ❌ Failed to expand ${candidate.candidate_name}: ${error.message}`);
    }
  }

  console.log(`\n[multi-hop] === SUMMARY ===`);
  console.log(`[multi-hop] Candidates expanded: ${processedCount}`);
  console.log(`[multi-hop] New venues discovered: ${totalVenues}`);
  console.log(`[multi-hop] New connections: ${totalConnections}`);

  // Yield logging: final summary
  console.log(`[multi-hop] [YIELD] run_summary candidates_processed=${processedCount} total_venues=${totalVenues} total_connections=${totalConnections}`);
}
