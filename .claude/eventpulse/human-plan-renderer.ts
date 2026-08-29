/**
 * human-plan-renderer.ts — deterministic Swedish ASCII plan renderer.
 *
 * Renders a `Mission` (canonical machine plan) as a compact, human-readable
 * Swedish view of the SAME plan. NEVER independently reasons about the
 * mission — only projects structured fields into a terminal-friendly view.
 *
 * No LLM call. No external I/O. Pure function.
 *
 * Sections (all optional; skipped when no useful data):
 *   MÅL, FLÖDE, PÅVERKAS, RÖRS INTE, AGENTER, VERIFIERING, RISK
 *
 * Complexity/Risk matrix (adaptive detail):
 *   trivial           → minimal (MÅL + 1-line FLÖDE only)
 *   small / normal    → MÅL + sequential FLÖDE
 *   cross_system /
 *   lead_plus_specialists → MÅL + multi-agent FLÖDE with branches
 *   architectural     → all sections + risk explicit
 *
 * Persistence: NONE. Returned string is intended for stderr/stdout only.
 *
 * Public API:
 *   - renderHumanPlan(mission: Mission, opts?): string
 *   - extractProjection(mission): HumanPlanProjection  (for consistency check)
 */

import type { Mission } from './mission-compiler';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RenderOpts {
  maxWidth?: number; // default 60; <=40 forces ASCII fallback
  /**
   * Optional pre-built projection. If provided, the renderer mutates its
   * `sections_rendered` field rather than allocating a fresh one. The router
   * uses this to keep the consistency-check projection in sync with what
   * was actually rendered.
   */
  projection?: HumanPlanProjection;
}

export interface HumanPlanProjection {
  mission_id: string;
  touched_scopes: string[]; // sorted
  planning_only: boolean;
  risk_level: string;
  mentions_planning_only: boolean;
  mentions_risk: boolean;
  mentions_approval: boolean;
  agents: string[];
  verification_gates: string[];
  sections_rendered: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Swedish-friendly risk descriptions (deterministic). */
const RISK_LABEL: Record<string, string> = {
  low: 'LÅG',
  medium: 'MEDIUM',
  high: 'HÖG',
  critical: 'KRITISK',
};

/** Gate → Swedish label. */
const GATE_LABEL: Record<string, string> = {
  typecheck: 'typkontroll',
  adapter_test: 'adaptertest',
  fixture_replay: 'fixture-replay',
  dedup_smoke: 'dedup-rökprov',
  schema_diff: 'schema-diff',
  venue_graph_dry_run: 'venue-graph dry-run',
  dedup_test: 'dedup-test',
  grounding_eval: 'grounding-utvärdering',
  no_fabricated_events: 'inga fabricerade events',
  expo_typecheck: 'expo-typkontroll',
  expo_lint: 'expo-lint',
  expo_smoke: 'expo-rökprov',
  schema_validate: 'schemavalidering',
  migration_safety: 'migrationssäkerhet',
  apply_test_db_only: 'apply endast test-DB',
  docs_cross_check: 'dokument-korscheck',
  policy_validate: 'policy-validering',
  human_review: 'human review',
};

/** Role → Swedish readable. */
const ROLE_LABEL: Record<string, string> = {
  lead: 'Lead',
  ingestion_engineer: 'Ingestion-engineer',
  event_graph_engineer: 'Event Graph-engineer',
  agent_ranking_engineer: 'Agent ranking-engineer',
  expo_engineer: 'Expo-engineer',
  backend_engineer: 'Backend-engineer',
  qa: 'QA',
  architect: 'Arkitekt',
};

/** Subsystem → Swedish readable (for PÅVERKAS / RÖRS INTE). */
const SUBSYSTEM_LABEL: Record<string, string> = {
  source_adapter: 'source adapter',
  ingestion: 'ingestion',
  normalization: 'normalisering',
  venue_graph: 'venue graph',
  event_graph: 'Event Graph',
  agent_api: 'agent-API',
  expo_ui: 'expo-UI',
  database: 'databas',
  queue: 'kö',
  vault: 'vault',
  docs: 'dokumentation',
  config: 'runtime-konfig',
};

/** Strategic / protected scope labels. */
const PROTECTED_SCOPE: Record<string, string> = {
  docs: 'MASTERPLAN/BACKLOG',
  vault: 'Project Brain',
  config: 'runtime policy',
  database: 'databasschema',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a Human Plan projection from the canonical Mission.
 * Use this for consistency validation; never invent content here.
 */
export function extractProjection(m: Mission): HumanPlanProjection {
  return {
    mission_id: m.mission_id,
    touched_scopes: [...m.subsystems].sort(),
    planning_only: m.planning_only,
    risk_level: m.risk,
    mentions_planning_only: m.planning_only,
    mentions_risk: m.risk === 'critical' || m.risk === 'high',
    mentions_approval: m.requires_user_approval.length > 0,
    agents: [...m.roles].sort(),
    verification_gates: [...m.required_gates],
    sections_rendered: [], // filled in by renderer
  };
}

/**
 * Render a Mission into a Swedish ASCII human plan.
 * Deterministic. No I/O. No LLM.
 *
 * If `opts.projection` is provided, the renderer mutates that projection's
 * `sections_rendered` field instead of creating a fresh internal one. This
 * lets the router reuse the projection it built for the consistency check.
 */
export function renderHumanPlan(m: Mission, opts: RenderOpts = {}): string {
  const maxWidth = opts.maxWidth ?? 60;
  const useAscii = maxWidth <= 40;
  const projection = opts.projection ?? extractProjection(m);
  const sections: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────
  sections.push(line(useAscii, 40));
  sections.push('EVENTPULSE — PLAN');
  sections.push(line(useAscii, 40));
  sections.push('');

  // ── MÅL ───────────────────────────────────────────────────────────────
  const goalText = shortenGoal(m.original_prompt);
  if (goalText) {
    sections.push('MÅL');
    sections.push('');
    sections.push(wrap(goalText, maxWidth));
    sections.push('');
    projection.sections_rendered.push('goal');
  }

  // ── FLÖDE ─────────────────────────────────────────────────────────────
  const flow = buildFlow(m, useAscii);
  if (flow) {
    sections.push('FLÖDE');
    sections.push('');
    sections.push(flow);
    sections.push('');
    projection.sections_rendered.push('flow');
  }

  // ── PÅVERKAS / RÖRS INTE ──────────────────────────────────────────────
  const scope = buildScope(m);
  if (scope.touched.length > 0) {
    sections.push('PÅVERKAS');
    sections.push('');
    for (const s of scope.touched) sections.push(`+ ${s}`);
    sections.push('');
    projection.sections_rendered.push('scope.touched');
  }
  if (scope.protected.length > 0 && isScopeRelevant(m)) {
    sections.push('RÖRS INTE');
    sections.push('');
    for (const s of scope.protected) sections.push(`- ${s}`);
    sections.push('');
    projection.sections_rendered.push('scope.protected');
  }

  // ── AGENTER ───────────────────────────────────────────────────────────
  if (m.execution_mode !== 'solo' && m.roles.length > 0) {
    sections.push('AGENTER');
    sections.push('');
    sections.push(buildAgentTree(m.roles, useAscii));
    sections.push('');
    projection.sections_rendered.push('agents');
  }

  // ── VERIFIERING ───────────────────────────────────────────────────────
  if (m.required_gates.length > 0) {
    sections.push('VERIFIERING');
    sections.push('');
    const gates = m.required_gates.map((g) => '- ' + gateLabel(g));
    sections.push(gates.join('\n'));
    sections.push('');
    projection.sections_rendered.push('verification');
  }

  // ── RISK ──────────────────────────────────────────────────────────────
  if (isRiskRelevant(m)) {
    sections.push('RISK');
    sections.push('');
    sections.push(buildRiskLine(m));
    sections.push('');
    projection.sections_rendered.push('risk');
  }

  // ── Footer (machine id) ───────────────────────────────────────────────
  sections.push(line(useAscii, 40));
  sections.push(`Machine mission: ${m.mission_id}`);
  sections.push(line(useAscii, 40));

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Internal builders
// ---------------------------------------------------------------------------

function line(ascii: boolean, width: number): string {
  return ascii ? '-'.repeat(Math.min(width, 40)) : '─'.repeat(Math.min(width, 40));
}

function shortenGoal(prompt: string): string {
  if (!prompt) return 'UNKNOWN';
  // Strip noise; keep first sentence-like fragment; cap at 120 chars.
  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 120) return cleaned;
  // Prefer first period or comma boundary
  const cut = cleaned.slice(0, 120);
  const lastBoundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '));
  if (lastBoundary > 40) return cut.slice(0, lastBoundary) + '.';
  return cut + '…';
}

function wrap(s: string, width: number): string {
  if (s.length <= width) return s;
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= width) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

function arrow(ascii: boolean): string {
  return ascii ? 'v' : '↓';
}

function tee(ascii: boolean): string {
  return ascii ? '+--' : '┌──';
}

function teeR(ascii: boolean): string {
  return ascii ? '+--' : '└──';
}

function pipe(ascii: boolean): string {
  return ascii ? '|' : '│';
}

function buildFlow(m: Mission, ascii: boolean): string {
  const a = arrow(ascii);
  const isAorB = /a\/b|ab[- ]?test|champion|variant/i.test(
    (m.notes ?? []).join(' ') + ' ' + m.original_prompt,
  );

  // ── trivial: minimal 3-step ────────────────────────────────────────────
  if (m.complexity === 'trivial') {
    return ['App', a, 'fix', a, 'test'].join('\n');
  }

  // ── solo or small_team with A/B ───────────────────────────────────────
  if (isAorB && (m.complexity === 'small' || m.complexity === 'normal' || m.execution_mode === 'small_team')) {
    return [
      'Current', a,
      'Candidate', a,
      'A/B-test', a,
      '  Better?',
      '  /     ' + '\\',
      'yes      no',
      ` ${a}        ${a}`,
      'keep    reject',
      '  ' + a,
      'verify',
      '  ' + a,
      'memory reconcile',
    ].join('\n');
  }

  // ── cross_system / lead_plus_specialists / architectural ─────────────
  if (
    m.execution_mode === 'lead_plus_specialists' ||
    m.execution_mode === 'architectural_review' ||
    m.complexity === 'cross_system' ||
    m.complexity === 'architectural'
  ) {
    const specialistCount = Math.max(1, m.roles.filter((r) => r !== 'lead' && r !== 'qa').length);
    const branches: string[] = [];
    branches.push('User goal', a, 'Mission compiler', a);
    const t = tee(ascii);
    const p = pipe(ascii);
    const tr = teeR(ascii);
    const parts: string[] = [];
    parts.push(t + '────────────' + t + '────────────');
    for (let i = 0; i < specialistCount; i++) {
      const slot = i === specialistCount - 1 ? tr : t;
      parts.push(p + ' Agent ' + (i + 1) + '   ' + slot + '   Agent ' + (i + 2));
    }
    parts.push('   ' + a);
    parts.push('Integration', a, 'Tests', a, 'Independent QA', a, 'Completion Gate', a, 'Memory Reconciliation');
    return [...branches, ...parts].join('\n');
  }

  // ── default: sequential small/normal ──────────────────────────────────
  return [
    'Analys', a,
    'Plan', a,
    'Implementering', a,
    'Tester', a,
    'Verifiering', a,
    'Memory reconcile',
  ].join('\n');
}

function buildScope(m: Mission): { touched: string[]; protected: string[] } {
  const touched = m.subsystems.map((s) => SUBSYSTEM_LABEL[s] ?? s);
  const touchedSet = new Set(m.subsystems);
  const protectedItems: string[] = [];
  // Show protected only if those subsystems are NOT touched (i.e. work is adjacent)
  for (const [sys, label] of Object.entries(PROTECTED_SCOPE)) {
    if (!touchedSet.has(sys as any) && isProtectedAdjacent(m, sys)) {
      protectedItems.push(label);
    }
  }
  return { touched, protected: protectedItems };
}

function isProtectedAdjacent(m: Mission, sys: string): boolean {
  // Show protected sections when work is close enough to those boundaries.
  if (sys === 'docs' && (m.task_type === 'architecture' || m.task_type === 'planning')) return true;
  if (sys === 'database' && m.task_type === 'schema') return true;
  if (sys === 'config' && (m.risk === 'high' || m.risk === 'critical')) return true;
  if (sys === 'vault' && m.task_type === 'documentation') return true;
  return false;
}

function isScopeRelevant(m: Mission): boolean {
  return (
    m.risk === 'medium' ||
    m.risk === 'high' ||
    m.risk === 'critical' ||
    m.task_type === 'architecture' ||
    m.task_type === 'planning' ||
    m.task_type === 'schema' ||
    m.task_type === 'database'
  );
}

function buildAgentTree(roles: ReadonlyArray<string>, ascii: boolean): string {
  const a = arrow(ascii);
  const lastBranch = ascii ? '`--' : '└─';
  const midBranch = ascii ? '|--' : '├─';
  if (roles.length === 0) return 'UNKNOWN';
  if (roles.length === 1) return ROLE_LABEL[roles[0]] ?? roles[0];
  // Copy before shifting so we never mutate the caller's array.
  const local = [...roles];
  const lead = local[0] === 'lead' ? local.shift() : null;
  const lines: string[] = [];
  if (lead) {
    lines.push(ROLE_LABEL[lead] ?? lead);
    for (let i = 0; i < local.length; i++) {
      const isLast = i === local.length - 1;
      const branch = isLast ? lastBranch : midBranch;
      lines.push(`${branch} ${ROLE_LABEL[local[i]] ?? local[i]}`);
    }
    lines.push(`  ${a}`);
    lines.push('Integration');
  } else {
    lines.push(ROLE_LABEL[local[0]] ?? local[0]);
  }
  return lines.join('\n');
}

function isRiskRelevant(m: Mission): boolean {
  return m.risk !== 'low' || m.requires_user_approval.length > 0;
}

function buildRiskLine(m: Mission): string {
  const label = RISK_LABEL[m.risk] ?? m.risk.toUpperCase();
  const reason = riskReason(m);
  return `${label} — ${reason}`;
}

function riskReason(m: Mission): string {
  if (m.risk === 'critical') {
    return 'kritisk: kräver explicit human approval innan något exekveras.';
  }
  if (m.risk === 'high') {
    if (m.requires_user_approval.length > 0) {
      return `hög: kräver godkännande (${m.requires_user_approval.join(', ')}).`;
    }
    return 'hög: vidrör strategiska子系统 eller migrations.';
  }
  if (m.risk === 'medium') {
    if (m.requires_user_approval.length > 0) {
      return `medium: kräver godkännande (${m.requires_user_approval.join(', ')}).`;
    }
    return 'medium: ändrar rekommendations-/beteendedata utan lagrade event-ändringar.';
  }
  // low
  return 'låg: lokal ändring med typecheck-gate.';
}

function gateLabel(g: string): string {
  return GATE_LABEL[g] ?? g;
}
