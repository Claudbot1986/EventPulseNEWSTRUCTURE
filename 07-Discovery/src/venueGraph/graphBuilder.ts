import { classifyVenueName, scoreVenueCandidate } from './scoring.js';
import type {
  StoredEvent,
  StoredVenue,
  VenueCandidate,
  VenueGraphBuildResult,
  VenueGraphEdge,
  VenueGraphMode,
  VenueGraphNode,
  VenueGraphObservation,
  VenueGraphRepository,
  VenueGraphRunSummary,
} from './types.js';

interface BuildOptions {
  repository: VenueGraphRepository;
  targetCity: string;
  mode?: VenueGraphMode;
  limit?: number;
}

type MutableGraph = {
  nodes: Map<string, VenueGraphNode>;
  edges: Map<string, VenueGraphEdge>;
  observations: VenueGraphObservation[];
  candidates: Map<string, VenueCandidate>;
  rejectedObservations: VenueGraphObservation[];
};

function normalizeIdentity(value: string | null | undefined): string {
  return (value || 'unknown')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nodeKey(type: string, value: string | null | undefined): string {
  return `${type}:${normalizeIdentity(value)}`;
}

function edgeKey(edgeType: string, fromKey: string, toKey: string, evidenceId: string): string {
  return `${edgeType}:${fromKey}->${toKey}:${evidenceId}`;
}

function addNode(graph: MutableGraph, node: VenueGraphNode): void {
  if (!graph.nodes.has(node.canonicalKey)) {
    graph.nodes.set(node.canonicalKey, node);
  }
}

function addEdge(graph: MutableGraph, edge: VenueGraphEdge): void {
  if (!graph.edges.has(edge.canonicalKey)) {
    graph.edges.set(edge.canonicalKey, edge);
  }
}

function addObservation(graph: MutableGraph, observation: VenueGraphObservation): void {
  graph.observations.push(observation);
}

function getRawRecord(rawData: unknown): Record<string, any> {
  return rawData && typeof rawData === 'object' ? rawData as Record<string, any> : {};
}

function extractPromoterName(event: StoredEvent): string | null {
  const raw = getRawRecord(event.raw_data);
  const candidates = [
    raw.promoter?.name,
    raw.promoterName,
    raw.organizer?.name,
    raw.organizerName,
    raw._embedded?.promoters?.[0]?.name,
  ];
  const match = candidates.find((value) => typeof value === 'string' && value.trim().length > 1);
  return match?.trim() ?? null;
}

function extractAttractionNames(event: StoredEvent): string[] {
  const raw = getRawRecord(event.raw_data);
  const attractions = raw._embedded?.attractions;
  if (!Array.isArray(attractions)) return [];
  return attractions
    .map((attraction) => attraction?.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 1)
    .map((name) => name.trim());
}

function createVenueNode(venue: StoredVenue): VenueGraphNode {
  return {
    nodeType: 'venue',
    canonicalKey: nodeKey('venue', venue.id),
    displayName: venue.name,
    city: venue.city ?? null,
    sourceTable: 'venues',
    sourceId: venue.id,
    confidenceScore: 100,
    status: 'verified',
    metadata: {
      address: venue.address ?? null,
      lat: venue.lat ?? null,
      lng: venue.lng ?? null,
    },
  };
}

function createEventNode(event: StoredEvent): VenueGraphNode {
  return {
    nodeType: 'event',
    canonicalKey: nodeKey('event', event.id),
    displayName: event.title || event.source_id || event.id,
    sourceTable: 'events',
    sourceId: event.id,
    confidenceScore: 100,
    status: 'observed',
    metadata: {
      source: event.source,
      source_id: event.source_id ?? null,
    },
  };
}

function createSourceNode(source: string): VenueGraphNode {
  return {
    nodeType: 'source',
    canonicalKey: nodeKey('source', source),
    displayName: source,
    sourceTable: 'events',
    sourceId: source,
    confidenceScore: 90,
    status: 'observed',
  };
}

function createNamedNode(type: 'promoter' | 'attraction', name: string): VenueGraphNode {
  return {
    nodeType: type,
    canonicalKey: nodeKey(type, name),
    displayName: name,
    sourceTable: 'events.raw_data',
    sourceId: name,
    confidenceScore: 70,
    status: 'observed',
  };
}

function createEdge(
  edgeType: VenueGraphEdge['edgeType'],
  fromKey: string,
  toKey: string,
  eventId: string,
  confidenceScore = 90
): VenueGraphEdge {
  return {
    edgeType,
    canonicalKey: edgeKey(edgeType, fromKey, toKey, eventId),
    fromKey,
    toKey,
    evidenceType: 'event',
    evidenceId: eventId,
    confidenceScore,
  };
}

function venueHasCoordinates(venue?: StoredVenue): boolean {
  return Boolean(venue?.lat && venue.lng);
}

function buildCandidate(event: StoredEvent, name: string, city: string): VenueCandidate {
  const score = scoreVenueCandidate({
    displayName: name,
    city,
    observationCount: 1,
    eventFrequency: 1,
    relationStrength: 1,
    hasAddress: false,
    hasCoordinates: false,
    sourceReliability: 60,
    historicalSuccess: 0,
  });

  return {
    canonicalKey: nodeKey('venue-candidate', name),
    displayName: name,
    city,
    status: 'candidate',
    originEventId: event.id,
    originPath: [`event:${event.id}`, `source:${event.source}`],
    confidenceScore: score.confidence_score,
    priorityScore: score.priority_score,
    riskFlags: score.risk_flags,
    explanation: score.explanation,
  };
}

function addRejectedVenueObservation(graph: MutableGraph, event: StoredEvent, displayName: string, reason: string): void {
  graph.rejectedObservations.push({
    observationType: 'unresolved_venue_name',
    displayName,
    canonicalKey: nodeKey('rejected-venue', displayName),
    evidenceType: 'event',
    evidenceId: event.id,
    source: event.source,
    status: 'rejected',
    rejectionReason: reason,
  });
}

function addUnresolvedVenueCandidate(graph: MutableGraph, event: StoredEvent, venueName: string, targetCity: string): void {
  const classification = classifyVenueName(venueName);
  if (classification !== 'valid') {
    addRejectedVenueObservation(graph, event, venueName, classification === 'placeholder' ? 'placeholder_venue' : classification);
    return;
  }

  const candidate = buildCandidate(event, venueName, targetCity);
  if (!graph.candidates.has(candidate.canonicalKey)) {
    graph.candidates.set(candidate.canonicalKey, candidate);
  }

  addObservation(graph, {
    observationType: 'unresolved_venue_name',
    displayName: venueName,
    canonicalKey: candidate.canonicalKey,
    evidenceType: 'event',
    evidenceId: event.id,
    source: event.source,
    status: 'observed',
  });
}

function buildGraphFromData(events: StoredEvent[], venues: StoredVenue[], targetCity: string): VenueGraphBuildResult {
  const graph: MutableGraph = {
    nodes: new Map(),
    edges: new Map(),
    observations: [],
    candidates: new Map(),
    rejectedObservations: [],
  };

  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  const venueIdsByName = new Map(venues.map((venue) => [venue.name.toLowerCase(), venue.id]));

  for (const venue of venues) {
    addNode(graph, createVenueNode(venue));
  }

  for (const event of events) {
    const eventNode = createEventNode(event);
    const sourceNode = createSourceNode(event.source);
    addNode(graph, eventNode);
    addNode(graph, sourceNode);
    addEdge(graph, createEdge('event_from_source', eventNode.canonicalKey, sourceNode.canonicalKey, event.id));

    const venueId = event.venue_id || (event.venue_name ? venueIdsByName.get(event.venue_name.toLowerCase()) : undefined);
    const venue = venueId ? venuesById.get(venueId) : undefined;
    if (venue) {
      const venueNode = createVenueNode(venue);
      addNode(graph, venueNode);
      addEdge(graph, createEdge('event_hosted_at_venue', eventNode.canonicalKey, venueNode.canonicalKey, event.id, 100));
      addEdge(graph, createEdge('source_mentions_venue', sourceNode.canonicalKey, venueNode.canonicalKey, event.id, 85));
      addObservation(graph, {
        observationType: 'resolved_venue',
        displayName: venue.name,
        canonicalKey: venueNode.canonicalKey,
        evidenceType: 'event',
        evidenceId: event.id,
        source: event.source,
        status: 'observed',
        metadata: { hasCoordinates: venueHasCoordinates(venue) },
      });
    } else if (event.venue_name) {
      addUnresolvedVenueCandidate(graph, event, event.venue_name, targetCity);
    }

    const promoterName = extractPromoterName(event);
    if (promoterName) {
      const promoterNode = createNamedNode('promoter', promoterName);
      addNode(graph, promoterNode);
      addEdge(graph, createEdge('event_promoted_by', eventNode.canonicalKey, promoterNode.canonicalKey, event.id, 75));
    }

    for (const attractionName of extractAttractionNames(event)) {
      const attractionNode = createNamedNode('attraction', attractionName);
      addNode(graph, attractionNode);
      addEdge(graph, createEdge('event_features_attraction', eventNode.canonicalKey, attractionNode.canonicalKey, event.id, 65));
    }
  }

  const nodes = [...graph.nodes.values()];
  const edges = [...graph.edges.values()];
  const candidates = [...graph.candidates.values()];
  const summary: VenueGraphRunSummary = {
    mode: 'dry-run',
    targetCity,
    inputEvents: events.length,
    inputVenues: venues.length,
    nodes: nodes.length,
    edges: edges.length,
    observations: graph.observations.length,
    venueCandidates: candidates.length,
    rejectedObservations: graph.rejectedObservations.length,
    verificationStatus: 'dry_run_only',
  };

  return {
    summary,
    nodes,
    edges,
    observations: graph.observations,
    candidates,
    rejectedObservations: graph.rejectedObservations,
  };
}

export async function buildVenueGraph(options: BuildOptions): Promise<VenueGraphBuildResult> {
  const mode = options.mode ?? 'dry-run';
  const [venues, events] = await Promise.all([
    options.repository.listVenues(),
    options.repository.listEvents(options.limit),
  ]);
  const result = buildGraphFromData(events, venues, options.targetCity);
  result.summary.mode = mode;
  result.summary.verificationStatus = mode === 'apply' ? 'local_verified' : 'dry_run_only';

  if (mode === 'apply') {
    await options.repository.upsertNodes(result.nodes);
    await options.repository.upsertEdges(result.edges);
    await options.repository.insertObservations([...result.observations, ...result.rejectedObservations]);
    await options.repository.upsertVenueCandidates(result.candidates);
    await options.repository.enqueueExpansionTasks(result.candidates);
    await options.repository.insertRun(result.summary);
  }

  return result;
}

export async function buildVenueGraphDryRun(options: Omit<BuildOptions, 'mode'>): Promise<VenueGraphBuildResult> {
  return buildVenueGraph({ ...options, mode: 'dry-run' });
}
