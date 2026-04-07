/**
 * Network Gate — GotEvent Model (PRELIMINARY, single-source validated)
 *
 * Routing logic for the Network Path in the source triage pipeline.
 *
 * INCORPORATES: GotEvent lesson (2026-03-29)
 *   A source can have clear network/API signals but still lack an open event data path.
 *   Example: GotEvent.se — API structure exists (/api/v2/event/GetEventsTeasers)
 *   but the endpoint requires an API key and returns HTTP 500.
 *   → "network signals exist" ≠ "Network Path is practically usable"
 *
 * MODEL STATUS: prelim_1src
 *   Validated against ONE source (GotEvent) only.
 *   NOT yet proven across multiple sources.
 *   May be revised or invalidated when more sources are tested.
 *
 * What this gate does (for sources with no-jsonld or wrong-type diagnosis):
 *   1. Run networkInspector to detect API signals
 *   2. Evaluate whether the API actually yields usable event data
 *   3. Route to 'network' path if viable
 *   4. Fall through to 'html' path if API is blocked/key-required/noise
 *   5. Preserve traceability metadata about why routing decision was made
 *
 * What this gate does NOT do:
 *   - Does NOT auto-approve any source for production
 *   - Does NOT bypass sanity → breadth → smoke phases
 *   - Does NOT treat GotEvent model as absolute truth
 *   - Does NOT create separate files per phase (sanity/breadth/smoke)
 *
 * Pipeline position: After JSON-LD check, before HTML heuristics.
 * Path order: JSON-LD → Network → HTML → Render → Blocked/Review
 *
 * Usage (internal to sourceTriage):
 *   import { evaluateNetworkGate } from './A-networkGate';
 *   const route = await evaluateNetworkGate(url, diagnosis);
 *   // route.nextPath: 'network' | 'html' | 'blocked-review'
 *   // route.modelStatus: 'prelim_1src'
 *   // route.reason: string
 */

import { inspectUrl, type NetworkInspectorResult } from './networkInspector';

export type NetworkRouteDecision = 'network' | 'html' | 'blocked-review';

export interface NetworkGateResult {
  /** Which path to route to next */
  nextPath: NetworkRouteDecision;
  /** Why the routing decision was made */
  reason: string;
  /** Model validation status */
  modelStatus: 'prelim_1src';
  /** Network inspector result if available */
  inspectorResult?: NetworkInspectorResult;
  /** Raw verdict from inspectUrl (promising/maybe/unclear/low_value) */
  inspectorVerdict?: string;
  /** Whether network signals were detected at all */
  networkSignalsFound: boolean;
  /** Whether the API/data endpoint is accessible without auth */
  openEventDataAccessible: boolean;
  /**
   * Phase mode governs how aggressively to route to network.
   * - sanity (1): route to network if ANY signal found
   * - breadth (2): require usable endpoint (not blocked/key-required)
   * - smoke (3): require confirmed usable endpoint with events
   *
   * Set via --phase flag or inferred from diagnosis context.
   * NOT a separate file per phase.
   */
  phaseMode: 1 | 2 | 3;
}

/**
 * Determine if an endpoint is accessible for open event data.
 * Based on GotEvent lesson: having an API structure is not enough —
 * the specific event endpoint must not require auth/key and must not return errors.
 *
 * Rules (preliminary, single-source validated):
 * - 2xx with JSON and event-like fields → open accessible
 * - 401/403 with key requirement → NOT accessible
 * - 500/Cloudflare errors → NOT accessible (GotEvent pattern)
 * - 404 on all probed endpoints → no API structure
 */
function assessOpenAccessibility(result: NetworkInspectorResult): {
  accessible: boolean;
  reason: string;
} {
  const { candidates, summary } = result;

  // If we found likely/possible API candidates, check them
  const interesting = candidates.filter(
    c => c.label === 'likely_event_api' || c.label === 'possible_api'
  );

  if (interesting.length === 0) {
    // No API signals found at all
    if (summary.errors > 0 && summary.notFound === 0) {
      // All errors but no 404s — might be DNS/timeout/blocking
      return {
        accessible: false,
        reason: `API structure attempted (${summary.errors} errors) but no usable endpoints found`,
      };
    }
    return {
      accessible: false,
      reason: 'No network/API signals detected',
    };
  }

  // Check if any candidate has auth requirement signals
  const blockedCandidates = interesting.filter(c =>
    c.statusCode === 401 ||
    c.statusCode === 403 ||
    c.statusCode === 500 ||
    c.error?.includes('cloudflare') ||
    c.error?.includes('captcha') ||
    c.error?.includes('api key') ||
    c.why.toLowerCase().includes('key') ||
    c.why.toLowerCase().includes('unauthorized') ||
    c.why.toLowerCase().includes('500')
  );

  if (blockedCandidates.length > 0 && blockedCandidates.length === interesting.length) {
    // All candidates are blocked — GotEvent pattern
    return {
      accessible: false,
      reason: `All ${blockedCandidates.length} API candidates blocked (key-required or 500/errors)`,
    };
  }

  // Check for actual event data capability
  const usableCandidates = interesting.filter(c =>
    c.statusCode === 200 &&
    c.keysFound.length > 0 &&
    !c.error
  );

  if (usableCandidates.length === 0) {
    return {
      accessible: false,
      reason: `Found ${interesting.length} candidates but none returned usable event data`,
    };
  }

  return {
    accessible: true,
    reason: `${usableCandidates.length} candidate(s) returned usable event-like data`,
  };
}

/**
 * Evaluate whether a source should be routed via Network Path.
 *
 * @param url - The source URL to evaluate
 * @param diagnosis - The diagnosis from jsonLdDiagnostic (no-jsonld or wrong-type)
 * @param phaseMode - 1=sanity, 2=breadth, 3=smoke
 * @param precomputedResult - Optional pre-computed NetworkInspectorResult to avoid duplicate inspection
 * @returns NetworkGateResult with routing decision
 */
export async function evaluateNetworkGate(
  url: string,
  diagnosis: string,
  phaseMode: 1 | 2 | 3 = 2,
  precomputedResult?: NetworkInspectorResult
): Promise<NetworkGateResult> {
  // Only gate for no-jsonld or wrong-type diagnoses
  if (diagnosis !== 'no-jsonld' && diagnosis !== 'wrong-type') {
    return {
      nextPath: 'html' as NetworkRouteDecision,
      reason: 'JSON-LD diagnosis — routing directly to HTML/Normalizer',
      modelStatus: 'prelim_1src',
      networkSignalsFound: false,
      openEventDataAccessible: false,
      phaseMode,
      inspectorVerdict: undefined,
    };
  }

  let inspectorResult: NetworkInspectorResult | undefined;

  // Use pre-computed result if provided, otherwise run inspection
  if (precomputedResult) {
    inspectorResult = precomputedResult;
  } else {
    try {
      inspectorResult = await inspectUrl(url);
    } catch {
      return {
        nextPath: 'html',
        reason: 'networkInspector failed — defaulting to HTML',
        modelStatus: 'prelim_1src',
        networkSignalsFound: false,
        openEventDataAccessible: false,
        phaseMode,
        inspectorVerdict: undefined,
      };
    }
  }

  const { accessible, reason: accessReason } = assessOpenAccessibility(inspectorResult);

  // Helper: build a short verdict summary string from inspectorResult
  const verdictSummary = `${inspectorResult.verdict} (${inspectorResult.summary.likely} likely, ${inspectorResult.summary.possible} possible)`;

  // PhaseMode governs routing aggressiveness
  if (phaseMode === 1) {
    // Sanity: route to network if ANY network signals exist
    const hasSignals = inspectorResult.summary.likely > 0 || inspectorResult.summary.possible > 0;
    if (hasSignals) {
      return {
        nextPath: 'network',
        reason: `[sanity] ${verdictSummary} — ${inspectorResult.verdictReason}. Routing to Network Path.`,
        modelStatus: 'prelim_1src',
        inspectorResult,
        inspectorVerdict: inspectorResult.verdict,
        networkSignalsFound: true,
        openEventDataAccessible: accessible,
        phaseMode,
      };
    }
    return {
      nextPath: 'html',
      reason: `[sanity] No network signals — ${inspectorResult.verdictReason}. Routing to HTML.`,
      modelStatus: 'prelim_1src',
      inspectorResult,
      inspectorVerdict: inspectorResult.verdict,
      networkSignalsFound: false,
      openEventDataAccessible: false,
      phaseMode,
    };
  }

  if (phaseMode === 2) {
    // Breadth: require usable endpoint (not blocked/key-required)
    if (accessible) {
      return {
        nextPath: 'network',
        reason: `[breadth] ${verdictSummary} — ${inspectorResult.verdictReason}. Open endpoint accessible. Routing to Network Path.`,
        modelStatus: 'prelim_1src',
        inspectorResult,
        inspectorVerdict: inspectorResult.verdict,
        networkSignalsFound: true,
        openEventDataAccessible: true,
        phaseMode,
      };
    }
    return {
      nextPath: 'html',
      reason: `[breadth] ${verdictSummary} — ${inspectorResult.verdictReason}. But: ${accessReason}. GotEvent lesson: API structure ≠ usable event data. Routing to HTML.`,
      modelStatus: 'prelim_1src',
      inspectorResult,
      inspectorVerdict: inspectorResult.verdict,
      networkSignalsFound: true,
      openEventDataAccessible: false,
      phaseMode,
    };
  }

  // phaseMode === 3 (smoke): require confirmed usable endpoint with actual event fields
  if (accessible) {
    const likely = inspectorResult.candidates.filter(c => c.label === 'likely_event_api');
    if (likely.length > 0) {
      return {
        nextPath: 'network',
        reason: `[smoke] ${verdictSummary} — ${inspectorResult.verdictReason}. Likely endpoint confirmed. Routing to Network Path.`,
        modelStatus: 'prelim_1src',
        inspectorResult,
        inspectorVerdict: inspectorResult.verdict,
        networkSignalsFound: true,
        openEventDataAccessible: true,
        phaseMode,
      };
    }
  }

  return {
    nextPath: 'html',
    reason: `[smoke] ${verdictSummary} — ${inspectorResult.verdictReason}. No confirmed likely endpoint. Routing to HTML.`,
    modelStatus: 'prelim_1src',
    inspectorResult,
    inspectorVerdict: inspectorResult.verdict,
    networkSignalsFound: inspectorResult.summary.likely > 0 || inspectorResult.summary.possible > 0,
    openEventDataAccessible: accessible,
    phaseMode,
  };
}

/**
 * Summarize a NetworkGateResult for logging/triage output.
 */
export function summarizeNetworkGateResult(r: NetworkGateResult): string {
  const signalStr = r.networkSignalsFound ? 'signals=YES' : 'signals=NO';
  const openStr = r.openEventDataAccessible ? 'open=YES' : 'open=NO';
  const phaseStr = `phase=${r.phaseMode}`;
  return `[${phaseStr}] ${signalStr} ${openStr}] → ${r.nextPath} | ${r.reason}`;
}
