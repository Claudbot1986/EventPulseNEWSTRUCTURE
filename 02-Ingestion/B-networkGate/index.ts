/**
 * B-networkGate — Network Path Gate
 *
 * Routing logic for the Network Path in the source triage pipeline.
 * Runs after JSON-LD check fails, before HTML heuristics.
 *
 * Pipeline: JSON-LD → Network → HTML → Render → Blocked/Review
 */

export { evaluateNetworkGate, summarizeNetworkGateResult, type NetworkGateResult, type NetworkRouteDecision } from './A-networkGate';
export { inspectUrl, type NetworkInspectorResult } from './networkInspector';
