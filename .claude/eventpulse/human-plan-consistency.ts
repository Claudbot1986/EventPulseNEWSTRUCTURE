/**
 * human-plan-consistency.ts — consistency validator for Human Plan projections.
 *
 * Ensures the Human Plan never:
 *   - introduces a scope absent from the canonical Mission
 *   - hides a critical risk or planning-only marker
 *   - claims work that the machine plan does not require
 *   - drops approval-required flags
 *
 * Public API:
 *   - validateHumanProjection(mission, projection): ConsistencyResult
 *   - validateRenderedHumanPlan(mission, projection, rendered): ConsistencyResult
 */

import type { Mission } from './mission-compiler';
import type { HumanPlanProjection } from './human-plan-renderer';

export interface ConsistencyResult {
  ok: boolean;        // true if all hard rules pass
  errors: string[];   // hard rule violations — fail closed
  warnings: string[]; // soft rule violations — fail open with stderr note
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a Human Plan projection against the canonical Mission.
 *
 * Hard rules (errors, ok=false):
 *   1. mission_id must match exactly
 *   2. projection.touched_scopes must be subset of mission.subsystems
 *   3. if mission.risk === 'critical' → projection.mentions_risk must be true
 *   4. if mission.planning_only === true → projection.mentions_planning_only must be true
 *   5. if mission.requires_user_approval.length > 0 → projection.mentions_approval must be true
 *   6. agents referenced must be subset of mission.roles
 *   7. verification_gates must be subset of mission.required_gates
 *
 * Soft rules (warnings):
 *   - empty touched_scopes for non-trivial complexity
 *   - empty agents for execution_mode ∈ {lead_plus_specialists, small_team, architectural_review}
 */
export function validateHumanProjection(
  mission: Mission,
  projection: HumanPlanProjection,
): ConsistencyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. mission_id
  if (projection.mission_id !== mission.mission_id) {
    errors.push(
      `mission_id mismatch: projection=${projection.mission_id} mission=${mission.mission_id}`,
    );
  }

  // 2. touched_scopes ⊆ mission.subsystems
  const missionSubs = new Set<string>(mission.subsystems);
  const projectionSubs = new Set<string>(projection.touched_scopes);
  for (const s of projectionSubs) {
    if (!missionSubs.has(s)) {
      errors.push(
        `projection.touched_scopes contains "${s}" which is absent from mission.subsystems=[${[...missionSubs].join(', ')}]`,
      );
    }
  }

  // 3. critical risk must be mentioned
  if (mission.risk === 'critical' && !projection.mentions_risk) {
    errors.push(
      `risk=critical but projection does not mention risk (mission ${mission.mission_id})`,
    );
  }

  // 4. planning_only must be mentioned
  if (mission.planning_only && !projection.mentions_planning_only) {
    errors.push(
      `planning_only=true but projection does not mention planning-only (mission ${mission.mission_id})`,
    );
  }

  // 5. requires_user_approval must be mentioned
  if (mission.requires_user_approval.length > 0 && !projection.mentions_approval) {
    errors.push(
      `mission requires_user_approval=[${mission.requires_user_approval.join(', ')}] but projection does not mention approval (mission ${mission.mission_id})`,
    );
  }

  // 6. agents ⊆ mission.roles
  const missionRoles = new Set<string>(mission.roles);
  for (const role of projection.agents) {
    if (!missionRoles.has(role)) {
      errors.push(
        `projection.agents contains "${role}" which is absent from mission.roles=[${[...missionRoles].join(', ')}]`,
      );
    }
  }

  // 7. verification_gates ⊆ mission.required_gates
  const missionGates = new Set<string>(mission.required_gates);
  for (const g of projection.verification_gates) {
    if (!missionGates.has(g)) {
      errors.push(
        `projection.verification_gates contains "${g}" which is absent from mission.required_gates=[${[...missionGates].join(', ')}]`,
      );
    }
  }

  // ── Soft rules ────────────────────────────────────────────────────────

  // Empty touched_scopes for non-trivial
  if (mission.complexity !== 'trivial' && projection.touched_scopes.length === 0) {
    warnings.push(
      `mission.complexity=${mission.complexity} but projection.touched_scopes is empty`,
    );
  }

  // Empty agents for team modes
  const teamModes = ['small_team', 'lead_plus_specialists', 'architectural_review'];
  if (teamModes.includes(mission.execution_mode) && projection.agents.length === 0) {
    warnings.push(
      `mission.execution_mode=${mission.execution_mode} but projection.agents is empty`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Cheap consistency check on already-rendered text + projection.
 * Used by router after rendering; re-runs the same hard rules and
 * additionally checks that critical / planning-only / approval keywords
 * appear in the rendered text when applicable.
 */
export function validateRenderedHumanPlan(
  mission: Mission,
  projection: HumanPlanProjection,
  rendered: string,
): ConsistencyResult {
  const result = validateHumanProjection(mission, projection);

  if (mission.risk === 'critical') {
    if (!/KRITISK|risk/i.test(rendered)) {
      result.errors.push(`rendered text missing 'KRITISK' / 'risk' for risk=critical mission`);
    }
  }
  if (mission.planning_only) {
    if (!/PLANNING ONLY|plan/i.test(rendered)) {
      result.errors.push(`rendered text missing 'PLANNING ONLY' marker for planning_only mission`);
    }
  }
  if (mission.requires_user_approval.length > 0) {
    if (!/godk|approval|requires/i.test(rendered)) {
      result.errors.push(
        `rendered text missing approval marker (mission requires_user_approval=${mission.requires_user_approval.join(',')})`,
      );
    }
  }
  result.ok = result.errors.length === 0;
  return result;
}
