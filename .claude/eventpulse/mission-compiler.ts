/**
 * mission-compiler.ts — compile (prompt, classification, selection)
 * into a YAML mission per plan §7/§9.
 *
 * - Writes a mirror file to `.claude/eventpulse/missions/<mission_id>.yaml`
 *   (gitignored per plan §22).
 * - Loads required_gates from `.claude/eventpulse/profiles/<profile>.yaml`.
 * - Returns the YAML string for injection via UserPromptSubmit hook.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Classification, UserOverride } from './classifier';
import type { SelectionResult } from './context-selector';

export interface RepoState {
  branch: string | null;
  head_sha: string | null;
  dirty: boolean;
  changed_files_count: number;
  preservation_warning: string | null;
  captured_at: string; // ISO 8601
}

export interface Mission {
  mission_id: string;
  original_prompt: string;
  task_type: Classification['task_type'];
  subsystems: Classification['subsystems'];
  complexity: Classification['complexity'];
  risk: Classification['risk'];
  execution_mode: Classification['execution_mode'];
  roles: Classification['roles'];
  verification_profile: Classification['verification_profile'];
  context: {
    tier0: string[];
    tier1: string[];
    tier2: string[];
    tier3: string[];
  };
  acceptance_criteria: string[];
  constraints: string[];
  unknown_assumptions: string[];
  escalation_conditions: string[];
  required_gates: string[];
  requires_user_approval: string[];
  classification_confidence: number;
  human_review_required: boolean;
  planning_only: boolean;
  user_overrides: UserOverride[];
  working_tree_fp: string;
  repo_state: RepoState;
  compiler_version: string;
  created_at: string;
  session_id: string;
  notes?: string[];
}

const PROFILE_DEFAULTS: Record<string, { gates: string[]; constraints: string[]; criteria?: string[]; approval?: string[] }> = {
  trivial: {
    gates: ['typecheck'],
    constraints: ['Single-line edits preferred; no scope drift.'],
  },
  ingestion: {
    gates: ['typecheck', 'adapter_test', 'fixture_replay', 'dedup_smoke'],
    constraints: [
      'Do not modify A-directAPI-networkGate/runA.ts interface.',
      'Do not change dedup hash algorithm.',
      'Adapters must run against real code paths; no synthetic extraction.',
      'Generalization Protection Rule: no IGNORE_PATTERNS / scoring weight changes based on a single site.',
    ],
  },
  event_graph: {
    gates: ['typecheck', 'schema_diff', 'venue_graph_dry_run', 'dedup_test'],
    constraints: [
      'Author-only on prod migrations; apply only via `npm run venue-graph:apply` or `supabase db push` against `supabase start` local instance.',
      'Do not edit docs/MASTERPLAN.md or docs/BACKLOG.md.',
    ],
    approval: ['production database modification', 'migration apply'],
  },
  agent_ranking: {
    gates: ['typecheck', 'grounding_eval', 'no_fabricated_events'],
    constraints: [
      '`search_events` MUST return only events with real canonical_event_id from Supabase; no UUID invented in the agent process.',
      '`rank_events` MUST rank by real features; never hallucinated scores.',
      '`search_external_web` MUST be off by default in Phase 0.',
    ],
  },
  expo: {
    gates: ['expo_typecheck', 'expo_lint', 'expo_smoke'],
    constraints: [
      'Do not edit 06-UI/services/eventServiceClient.js (Tier 0 anon read path).',
      'No simulated extraction in UI code that surfaces event counts.',
      'No Zustand/Redux/React Query without explicit approval.',
    ],
  },
  database: {
    gates: ['schema_validate', 'migration_safety', 'apply_test_db_only'],
    constraints: [
      'Apply only against `supabase start` local instance; prod apply requires explicit human approval.',
      'Migration must include BEGIN; ... COMMIT; and must not contain DROP TABLE on a non-temp table without IF EXISTS + backup.',
    ],
    approval: ['production database modification', 'migration apply'],
  },
  architecture: {
    gates: ['typecheck', 'docs_cross_check', 'policy_validate', 'human_review'],
    constraints: [
      'Do not modify docs/MASTERPLAN.md, docs/BACKLOG.md, or .claude/eventpulse/policy.md without explicit human approval.',
      'human_review_required: true — never auto-TaskCompleted.',
    ],
    approval: ['strategic North Star modification', 'runtime policy change'],
  },
};

function loadProfile(repoRoot: string, profile: string): { gates: string[]; constraints: string[]; criteria?: string[]; approval?: string[] } {
  const profilePath = path.join(repoRoot, '.claude', 'eventpulse', 'profiles', `${profile}.yaml`);
  try {
    if (fs.existsSync(profilePath)) {
      const raw = fs.readFileSync(profilePath, 'utf8');
      const gatesMatch = raw.match(/^gates:\s*\n((?:\s*-\s*.+\n?)+)/m);
      const constraintsMatch = raw.match(/^constraints:\s*\n((?:\s*-\s*.+\n?)+)/m);
      const criteriaMatch = raw.match(/^acceptance_criteria:\s*\n((?:\s*-\s*.+\n?)+)/m);
      const approvalMatch = raw.match(/^approval:\s*\n((?:\s*-\s*.+\n?)+)/m);
      const gates = gatesMatch ? gatesMatch[1].split(/\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : [];
      const constraints = constraintsMatch ? constraintsMatch[1].split(/\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : [];
      const criteria = criteriaMatch ? criteriaMatch[1].split(/\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : undefined;
      const approval = approvalMatch ? approvalMatch[1].split(/\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : undefined;
      if (gates.length || constraints.length) {
        return { gates, constraints, criteria, approval };
      }
    }
  } catch {
    // fall through to defaults
  }
  return PROFILE_DEFAULTS[profile] ?? PROFILE_DEFAULTS.ingestion;
}

function makeMissionId(now: Date, sessionId: string): string {
  const date = now.toISOString().slice(0, 10);
  const sessPart = sessionId ? sessionId.slice(0, 8) : 'anon';
  const counter = String(now.getUTCMilliseconds()).padStart(3, '0');
  return `EP-${date}-${sessPart}-${counter}`;
}

export const COMPILER_VERSION = 'epc-1.1';

function gitSafe(repoRoot: string, args: string[]): string {
  try {
    const out = execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim();
  } catch {
    return '';
  }
}

export function computeWorkingTreeFp(repoRoot: string): string {
  const listed = gitSafe(repoRoot, ['ls-files']);
  if (!listed) return 'sha256:unavailable';
  const sorted = listed.split('\n').filter(Boolean).sort().join('\n');
  // lightweight hash via Node (no crypto dep needed)
  let h = 5381;
  for (let i = 0; i < sorted.length; i++) h = ((h << 5) + h + sorted.charCodeAt(i)) | 0;
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  const changed = gitSafe(repoRoot, ['diff', '--name-only']);
  const dirty = changed.length > 0 ? `:dirty${changed.split('\n').length}` : ':clean';
  return `sha256-djb2:${hex}${dirty}`;
}

export function computeRepoState(repoRoot: string): RepoState {
  const branch = gitSafe(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || null;
  const head_sha = gitSafe(repoRoot, ['rev-parse', '--short', 'HEAD']) || null;
  const changedRaw = gitSafe(repoRoot, ['status', '--porcelain']);
  const changedFiles = changedRaw ? changedRaw.split('\n').filter(Boolean) : [];
  const dirty = changedFiles.length > 0;
  return {
    branch,
    head_sha,
    dirty,
    changed_files_count: changedFiles.length,
    preservation_warning: dirty
      ? `Working tree has ${changedFiles.length} uncommitted change(s); preserve unrelated edits.`
      : null,
    captured_at: new Date().toISOString(),
  };
}

function sanitizeText(value: string, maxLen = 4000): string {
  // mission §72: strip invalid control chars (keep \n, \t), enforce size, validate UTF-8 (Node strings are UTF-16, but reject lone surrogates).
  let s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // strip lone surrogates
  s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '').replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1');
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
  return s;
}

const MISSION_DELIM_START = '--- EVENTPULSE COMPILED MISSION START ---';
const MISSION_DELIM_END = '--- EVENTPULSE COMPILED MISSION END ---';

function escapeDelimiters(s: string): string {
  // prevent external data from terminating the mission block (§72)
  return s.split(MISSION_DELIM_START).join('[DELIM-START-escaped]').split(MISSION_DELIM_END).join('[DELIM-END-escaped]');
}

export function renderMissionMarkdown(m: Mission, opts: { maxTokens?: number } = {}): string {
  const maxChars = (opts.maxTokens ?? 1500) * 4; // ~4 chars/token heuristic
  const lines: string[] = [];
  lines.push(MISSION_DELIM_START);
  lines.push('This mission is generated context. The original user request remains authoritative.');
  lines.push('');
  lines.push(`Mission: ${m.mission_id}`);
  lines.push(`Compiler: ${m.compiler_version}`);
  lines.push(`Created: ${m.created_at}`);
  lines.push('');
  lines.push('## Original User Request');
  lines.push(escapeDelimiters(m.original_prompt));
  lines.push('');
  lines.push('## Classification');
  lines.push(`- intent: ${m.task_type}`);
  lines.push(`- task_type: ${m.task_type}`);
  lines.push(`- subsystems: ${m.subsystems.join(', ') || '(none)'}`);
  lines.push(`- complexity: ${m.complexity}`);
  lines.push(`- risk: ${m.risk}`);
  lines.push(`- execution_mode: ${m.execution_mode}`);
  lines.push(`- verification_profile: ${m.verification_profile}`);
  lines.push(`- classification_confidence: ${m.classification_confidence}`);
  if (m.planning_only) lines.push('- PLANNING ONLY: yes — code modification is PROHIBITED');
  if (m.user_overrides.length) lines.push(`- user_overrides: ${m.user_overrides.join(', ')}`);
  lines.push('');
  lines.push('## Roles');
  lines.push(m.roles.length ? m.roles.map((r) => `- ${r}`).join('\n') : '(none — solo)');
  lines.push('');
  lines.push('## Selected Context');
  for (const t of ['tier0', 'tier1', 'tier2', 'tier3'] as const) {
    const arr = m.context[t];
    if (!arr.length) continue;
    lines.push(`- ${t}: ${arr.join(', ')}`);
  }
  lines.push('');
  lines.push('## Acceptance Criteria');
  for (const a of m.acceptance_criteria) lines.push(`- ${a}`);
  lines.push('');
  lines.push('## Constraints');
  for (const c of m.constraints) lines.push(`- ${c}`);
  lines.push('');
  lines.push('## Escalation Conditions');
  for (const e of m.escalation_conditions) lines.push(`- ${e}`);
  lines.push('');
  if (m.requires_user_approval.length) {
    lines.push('## Requires User Approval');
    for (const a of m.requires_user_approval) lines.push(`- ${a}`);
    lines.push('');
  }
  lines.push('## Repo State');
  lines.push(`- branch: ${m.repo_state.branch ?? 'unknown'}`);
  lines.push(`- head_sha: ${m.repo_state.head_sha ?? 'unknown'}`);
  lines.push(`- dirty: ${m.repo_state.dirty}`);
  lines.push(`- working_tree_fp: ${m.working_tree_fp}`);
  if (m.repo_state.preservation_warning) lines.push(`- preservation_warning: ${m.repo_state.preservation_warning}`);
  lines.push('');
  lines.push('## Verification Profile');
  lines.push(`Profile: ${m.verification_profile} | Required gates: ${m.required_gates.join(', ')}`);
  lines.push(`human_review_required: ${m.human_review_required}`);
  lines.push('');
  lines.push('## Unknown Assumptions');
  for (const u of m.unknown_assumptions) lines.push(`- ${u}`);
  lines.push('');
  lines.push('This generated mission is subordinate to the original user request and authoritative EventPulse current-truth documentation.');
  lines.push(MISSION_DELIM_END);
  let rendered = lines.join('\n');
  rendered = sanitizeText(rendered, maxChars);
  return rendered;
}

export function compileMission(opts: {
  prompt: string;
  classification: Classification;
  selection: SelectionResult;
  repoRoot: string;
  sessionId?: string;
  now?: Date;
}): { mission: Mission; yaml: string } {
  const now = opts.now ?? new Date();
  const profile = loadProfile(opts.repoRoot, opts.classification.verification_profile);

  const repoState = computeRepoState(opts.repoRoot);
  const working_tree_fp = computeWorkingTreeFp(opts.repoRoot);
  const approval = profile.approval ?? [];

  const baseCriteria = profile.criteria ?? [
    'Adapter/feature handles the recorded edge case.',
    'All required_gates pass with real code paths.',
    'No forbidden patterns introduced (mutation, hardcoded secrets, console.log in prod).',
  ];

  const constraints = [...profile.constraints];
  if (opts.classification.planning_only) {
    constraints.unshift('EXECUTION MODE: PLANNING ONLY — code modification is PROHIBITED.');
    constraints.unshift('DO NOT spawn implementers; produce a written plan only.');
  }
  for (const ov of opts.classification.user_overrides) {
    if (ov === 'planning_only' || ov === 'do_not_implement') continue; // already expressed above
    constraints.push(`USER OVERRIDE: ${ov.replace(/_/g, ' ')}.`);
  }
  if (repoState.dirty) {
    constraints.push(`PRESERVE WORKING TREE: ${repoState.preservation_warning ?? 'uncommitted changes exist'}.`);
  }

  const escalation = [
    "If the task touches a file outside this mission's scope → stop and escalate.",
    'If a required gate fails → fix or escalate to ep-lead.',
  ];
  if (opts.classification.planning_only) {
    escalation.push('If user later asks to implement, require explicit confirmation before code modification.');
  }

  const mission: Mission = {
    mission_id: makeMissionId(now, opts.sessionId ?? 'anon'),
    original_prompt: sanitizeText(opts.prompt, 500),
    task_type: opts.classification.task_type,
    subsystems: opts.classification.subsystems,
    complexity: opts.classification.complexity,
    risk: opts.classification.risk,
    execution_mode: opts.classification.execution_mode,
    roles: opts.classification.roles,
    verification_profile: opts.classification.verification_profile,
    context: {
      tier0: opts.selection.tier0.map((e) => e.path),
      tier1: opts.selection.tier1.map((e) => e.path),
      tier2: opts.selection.tier2.map((e) => e.path),
      tier3: opts.selection.tier3.map((e) => e.path),
    },
    acceptance_criteria: baseCriteria,
    constraints,
    unknown_assumptions: ['User intent inferred from prompt keywords; please correct if wrong.'],
    escalation_conditions: escalation,
    required_gates:
      opts.classification.risk === 'critical' && !profile.gates.includes('human_review')
        ? [...profile.gates, 'human_review']
        : profile.gates,
    requires_user_approval: approval,
    classification_confidence: opts.classification.classification_confidence,
    human_review_required:
      opts.classification.risk === 'critical' ||
      opts.classification.task_type === 'architecture' ||
      opts.classification.execution_mode === 'architectural_review' ||
      opts.classification.planning_only,
    planning_only: opts.classification.planning_only,
    user_overrides: opts.classification.user_overrides,
    working_tree_fp,
    repo_state: repoState,
    compiler_version: COMPILER_VERSION,
    created_at: now.toISOString(),
    session_id: opts.sessionId ?? "anon",
    notes: opts.selection.notes,
  };

  const yaml = renderYaml(mission);
  return { mission, yaml };
}

function yamlEscape(value: string): string {
  if (value == null) return '';
  if (/[":#&*!|>'%@`]/.test(value) || value.includes('\n') || /^\s|\s$/.test(value)) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return value;
}

function renderYaml(m: Mission): string {
  const lines: string[] = [];
  lines.push(`mission_id: ${yamlEscape(m.mission_id)}`);
  lines.push(`original_prompt: ${yamlEscape(m.original_prompt)}`);
  lines.push(`task_type: ${m.task_type}`);
  if (m.subsystems.length) {
    lines.push(`subsystems:`);
    for (const s of m.subsystems) lines.push(`  - ${s}`);
  } else {
    lines.push(`subsystems: []`);
  }
  lines.push(`complexity: ${m.complexity}`);
  lines.push(`risk: ${m.risk}`);
  lines.push(`execution_mode: ${m.execution_mode}`);
  if (m.roles.length) {
    lines.push(`roles:`);
    for (const r of m.roles) lines.push(`  - ${r}`);
  } else {
    lines.push(`roles: []`);
  }
  lines.push(`verification_profile: ${m.verification_profile}`);
  lines.push(`context:`);
  lines.push(`  tier0: [${m.context.tier0.map(yamlEscape).join(', ')}]`);
  lines.push(`  tier1: [${m.context.tier1.map(yamlEscape).join(', ')}]`);
  lines.push(`  tier2: [${m.context.tier2.map(yamlEscape).join(', ')}]`);
  lines.push(`  tier3: [${m.context.tier3.map(yamlEscape).join(', ')}]`);
  lines.push(`acceptance_criteria:`);
  for (const a of m.acceptance_criteria) lines.push(`  - ${yamlEscape(a)}`);
  lines.push(`constraints:`);
  for (const c of m.constraints) lines.push(`  - ${yamlEscape(c)}`);
  lines.push(`unknown_assumptions:`);
  for (const u of m.unknown_assumptions) lines.push(`  - ${yamlEscape(u)}`);
  lines.push(`escalation_conditions:`);
  for (const e of m.escalation_conditions) lines.push(`  - ${yamlEscape(e)}`);
  lines.push(`required_gates:`);
  for (const g of m.required_gates) lines.push(`  - ${g}`);
  if (m.requires_user_approval.length) {
    lines.push(`requires_user_approval:`);
    for (const a of m.requires_user_approval) lines.push(`  - ${yamlEscape(a)}`);
  } else {
    lines.push(`requires_user_approval: []`);
  }
  lines.push(`classification_confidence: ${Number(m.classification_confidence.toFixed(2))}`);
  lines.push(`human_review_required: ${m.human_review_required ? 'true' : 'false'}`);
  lines.push(`planning_only: ${m.planning_only ? 'true' : 'false'}`);
  if (m.user_overrides.length) {
    lines.push(`user_overrides:`);
    for (const u of m.user_overrides) lines.push(`  - ${u}`);
  } else {
    lines.push(`user_overrides: []`);
  }
  lines.push(`working_tree_fp: ${m.working_tree_fp}`);
  lines.push(`repo_state:`);
  lines.push(`  branch: ${m.repo_state.branch ?? 'unknown'}`);
  lines.push(`  head_sha: ${m.repo_state.head_sha ?? 'unknown'}`);
  lines.push(`  dirty: ${m.repo_state.dirty ? 'true' : 'false'}`);
  lines.push(`  changed_files_count: ${m.repo_state.changed_files_count}`);
  if (m.repo_state.preservation_warning) {
    lines.push(`  preservation_warning: ${yamlEscape(m.repo_state.preservation_warning)}`);
  }
  lines.push(`  captured_at: ${m.repo_state.captured_at}`);
  lines.push(`compiler_version: ${m.compiler_version}`);
  lines.push(`created_at: ${m.created_at}`);
  lines.push(`session_id: ${m.session_id}`);
  if (m.notes && m.notes.length) {
    lines.push(`notes:`);
    for (const n of m.notes) lines.push(`  - ${yamlEscape(n)}`);
  }
  return lines.join('\n') + '\n';
}

export function writeMissionMirror(repoRoot: string, mission: Mission, yaml: string): string {
  const missionsDir = path.join(repoRoot, '.claude', 'eventpulse', 'missions');
  fs.mkdirSync(missionsDir, { recursive: true });
  const filePath = path.join(missionsDir, `${mission.mission_id}.yaml`);
  fs.writeFileSync(filePath, yaml, 'utf8');
  return filePath;
}
