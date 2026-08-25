/**
 * mission-validator.ts — strict validator for mission objects (plan §7).
 *
 * - Rejects missions with missing mandatory fields.
 * - Rejects missions with `complexity` incompatible with `execution_mode`
 *   (e.g. `trivial` with `lead_plus_specialists`).
 * - Returns a typed result so the router can fail-closed if `--strict`.
 */

import type { Mission } from './mission-compiler';
import type { Complexity, ExecutionMode } from './classifier';

const VALID_COMPLEXITY: Complexity[] = ['trivial', 'small', 'normal', 'cross_system', 'architectural'];
const VALID_EXECUTION_MODES: ExecutionMode[] = [
  'solo',
  'single_agent',
  'small_team',
  'lead_plus_specialists',
  'architectural_review',
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_VERIFICATION_PROFILES = [
  'trivial',
  'ingestion',
  'event_graph',
  'agent_ranking',
  'expo',
  'database',
  'architecture',
];

export function validateMission(m: Mission, opts: { strict?: boolean } = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const required: Array<keyof Mission> = [
    'mission_id',
    'original_prompt',
    'task_type',
    'subsystems',
    'complexity',
    'risk',
    'execution_mode',
    'roles',
    'verification_profile',
    'context',
    'acceptance_criteria',
    'constraints',
    'unknown_assumptions',
    'escalation_conditions',
    'required_gates',
    'requires_user_approval',
    'classification_confidence',
    'human_review_required',
    'planning_only',
    'user_overrides',
    'working_tree_fp',
    'repo_state',
    'compiler_version',
    'created_at',
  ];
  for (const k of required) {
    const v = (m as Mission)[k];
    if (v === undefined || v === null) {
      errors.push(`Missing mandatory field: ${String(k)}`);
    } else if (Array.isArray(v) && v.length === 0 && k !== 'roles' && k !== 'subsystems' && k !== 'requires_user_approval' && k !== 'user_overrides') {
      errors.push(`Field ${String(k)} must not be an empty array`);
    }
  }

  if (!/^EP-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_-]+-\d{3}$/.test(m.mission_id ?? '')) {
    errors.push(`mission_id does not match expected format 'EP-YYYY-MM-DD-<session>-<counter>' — got "${m.mission_id}"`);
  }

  if (m.created_at && Number.isNaN(Date.parse(m.created_at))) {
    errors.push(`created_at is not a valid ISO 8601 timestamp — got "${m.created_at}"`);
  }

  if (m.classification_confidence < 0 || m.classification_confidence > 1) {
    errors.push(`classification_confidence must be in [0, 1] — got ${m.classification_confidence}`);
  }

  if (!VALID_COMPLEXITY.includes(m.complexity)) {
    errors.push(`complexity must be one of ${VALID_COMPLEXITY.join(', ')} — got "${m.complexity}"`);
  }
  if (!VALID_EXECUTION_MODES.includes(m.execution_mode)) {
    errors.push(`execution_mode must be one of ${VALID_EXECUTION_MODES.join(', ')} — got "${m.execution_mode}"`);
  }
  if (!VALID_VERIFICATION_PROFILES.includes(m.verification_profile)) {
    errors.push(`verification_profile must be one of ${VALID_VERIFICATION_PROFILES.join(', ')} — got "${m.verification_profile}"`);
  }

  const incompat = INCOMPATIBLE.find((row) => row.complexity === m.complexity && row.mode !== m.execution_mode);
  if (incompat) {
    warnings.push(`complexity=${m.complexity} typically pairs with execution_mode=${incompat.mode} — got ${m.execution_mode}.`);
  }

  if (m.execution_mode === 'solo' && m.roles.length > 0) {
    warnings.push(`execution_mode=solo but roles[] is non-empty (${m.roles.join(', ')}).`);
  }

  if (m.acceptance_criteria.length > 5) {
    warnings.push(`acceptance_criteria has ${m.acceptance_criteria.length} bullets (recommended max 5).`);
  }

  if (!m.context || typeof m.context !== 'object') {
    errors.push('context must be an object with tier0/tier1/tier2/tier3 arrays.');
  } else {
    for (const t of ['tier0', 'tier1', 'tier2', 'tier3'] as const) {
      if (!Array.isArray(m.context[t])) errors.push(`context.${t} must be an array`);
    }
    if (m.context.tier0.length === 0) errors.push('context.tier0 must include at least policy.md (Tier 0 is always-on).');
  }

  if (m.risk === 'critical' && m.human_review_required === false) {
    errors.push('risk=critical requires human_review_required=true.');
  }

  if (m.execution_mode === 'solo' && m.subsystems.length > 1) {
    warnings.push(`execution_mode=solo but subsystems[] has ${m.subsystems.length} entries (${m.subsystems.join(', ')}).`);
  }

  if (m.planning_only && m.execution_mode !== 'solo' && m.execution_mode !== 'single_agent') {
    warnings.push(`planning_only=true with execution_mode=${m.execution_mode}; consider solo for strict plan-only.`);
  }
  if (m.planning_only && !m.constraints.some((c) => /PLANNING ONLY/i.test(c))) {
    errors.push('planning_only=true requires a constraint containing "PLANNING ONLY".');
  }

  if (!m.working_tree_fp || !/^sha256(?:-djb2)?:/.test(m.working_tree_fp)) {
    warnings.push(`working_tree_fp should start with sha256: — got "${m.working_tree_fp}"`);
  }

  if (!m.repo_state || typeof m.repo_state !== 'object') {
    errors.push('repo_state must be an object {branch, head_sha, dirty, changed_files_count, preservation_warning, captured_at}.');
  } else if (m.repo_state.captured_at && Number.isNaN(Date.parse(m.repo_state.captured_at))) {
    errors.push(`repo_state.captured_at must be ISO 8601 — got "${m.repo_state.captured_at}"`);
  }

  if (opts.strict && warnings.length) {
    for (const w of warnings) errors.push(w);
  }

  return { ok: errors.length === 0, errors, warnings };
}

const INCOMPATIBLE: Array<{ complexity: Complexity; mode: ExecutionMode }> = [
  { complexity: 'trivial', mode: 'solo' },
  { complexity: 'small', mode: 'single_agent' },
  { complexity: 'normal', mode: 'small_team' },
  { complexity: 'cross_system', mode: 'lead_plus_specialists' },
  { complexity: 'architectural', mode: 'architectural_review' },
];
