/**
 * classifier.ts — deterministic classifier for UserPromptSubmit.
 *
 * Keyword/regex-driven. NO LLM call inside the hook (per plan §6).
 * Returns a Classification object consumed by context-selector and mission-compiler.
 *
 * The optional LLM-based classifier (router-llm.ts) is OFF by default.
 */

export type TaskType =
  | 'trivial'
  | 'bug'
  | 'feature'
  | 'refactor'
  | 'ingestion'
  | 'source-adapter'
  | 'event-graph'
  | 'agent-ranking'
  | 'expo-ui'
  | 'backend'
  | 'database'
  | 'schema'
  | 'architecture'
  | 'research'
  | 'planning'
  | 'testing'
  | 'documentation'
  | 'operations';

export type Complexity = 'trivial' | 'small' | 'normal' | 'cross_system' | 'architectural';
export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type ExecutionMode =
  | 'solo'
  | 'single_agent'
  | 'small_team'
  | 'lead_plus_specialists'
  | 'architectural_review';
export type VerificationProfile =
  | 'trivial'
  | 'ingestion'
  | 'event_graph'
  | 'agent_ranking'
  | 'expo'
  | 'database'
  | 'architecture';

export type Subsystem =
  | 'source_adapter'
  | 'ingestion'
  | 'normalization'
  | 'venue_graph'
  | 'event_graph'
  | 'agent_api'
  | 'expo_ui'
  | 'database'
  | 'queue'
  | 'vault'
  | 'docs'
  | 'config';

export type Role =
  | 'lead'
  | 'ingestion_engineer'
  | 'event_graph_engineer'
  | 'agent_ranking_engineer'
  | 'expo_engineer'
  | 'backend_engineer'
  | 'qa'
  | 'architect';

export type UserOverride =
  | 'planning_only'
  | 'no_commit'
  | 'no_web'
  | 'use_only_one_agent'
  | 'do_not_touch_masterplan'
  | 'do_not_implement';

export interface Classification {
  task_type: TaskType;
  subsystems: Subsystem[];
  complexity: Complexity;
  risk: Risk;
  execution_mode: ExecutionMode;
  roles: Role[];
  verification_profile: VerificationProfile;
  classification_confidence: number; // 0..1; deterministic classifier always returns heuristic score
  signals: Record<string, number>; // debug: which keyword buckets fired and how strongly
  planning_only: boolean; // mission §29: explicit "plan only", "do not implement" → hard execution constraint
  user_overrides: UserOverride[]; // mission §30: explicit user constraints
}

interface KeywordBucket {
  taskTypes: TaskType[];
  subsystems: Subsystem[];
  verificationProfile?: VerificationProfile;
  baseComplexity: Complexity;
  baseRisk: Risk;
  baseConfidence: number;
}

const KEYWORD_BUCKETS: Array<{ patterns: RegExp[]; bucket: KeywordBucket }> = [
  {
    patterns: [/\bingestion\b/i, /\bscrape\b/i, /\bqueue\b/i, /\bdrain\b/i, /\bextract(ion|or)?\b/i],
    bucket: {
      taskTypes: ['ingestion'],
      subsystems: ['ingestion'],
      verificationProfile: 'ingestion',
      baseComplexity: 'normal',
      baseRisk: 'low',
      baseConfidence: 0.7,
    },
  },
  {
    patterns: [/\badapter\b/i, /\bsource[- ]?(adapter|onboarding)\b/i, /\bonboard(kulturhuset|berwaldhallen|ticketmaster|eventbrite)\b/i],
    bucket: {
      taskTypes: ['source-adapter'],
      subsystems: ['source_adapter', 'ingestion'],
      verificationProfile: 'ingestion',
      baseComplexity: 'small',
      baseRisk: 'low',
      baseConfidence: 0.78,
    },
  },
  {
    patterns: [/\bevent[- ]?graph\b/i, /\bcanonical[- ]?event\b/i, /\bdedup(lication|licate)?\b/i, /\bvenue[- ]?graph\b/i, /\bdedup[- ]?hash\b/i, /\bnormaliz(er|ation)\b/i],
    bucket: {
      taskTypes: ['event-graph'],
      subsystems: ['event_graph', 'normalization'],
      verificationProfile: 'event_graph',
      baseComplexity: 'normal',
      baseRisk: 'medium',
      baseConfidence: 0.72,
    },
  },
  {
    patterns: [/\b08[- ]?agent\b/i, /\bagent[- ]?api\b/i, /\bparse_intent\b/i, /\bsearch_events\b/i, /\brank_events\b/i, /\bgrounding\b/i, /\bhallucinat/i, /\brecommend(ation|s|ed)?\b/i, /\bpersonal(ized|isation|ization)?\b/i, /\bfamil(y|ies)\b/i, /\bmagic[- ]?query\b/i],
    bucket: {
      taskTypes: ['agent-ranking'],
      subsystems: ['agent_api', 'event_graph'],
      verificationProfile: 'agent_ranking',
      baseComplexity: 'normal',
      baseRisk: 'medium',
      baseConfidence: 0.74,
    },
  },
  {
    patterns: [/\b06[- ]?ui\b/i, /\bexpo\b/i, /\breact[- ]?native\b/i, /\bapp\.js\b/i, /\bscreen\b/i, /\bnavigation\b/i],
    bucket: {
      taskTypes: ['expo-ui'],
      subsystems: ['expo_ui'],
      verificationProfile: 'expo',
      baseComplexity: 'normal',
      baseRisk: 'low',
      baseConfidence: 0.7,
    },
  },
  {
    patterns: [/\bschema\.md\b/i, /\bmigration\b/i, /\bsupabase\b/i, /\bdb\.py\b/i],
    bucket: {
      taskTypes: ['schema', 'database'],
      subsystems: ['database'],
      verificationProfile: 'database',
      baseComplexity: 'normal',
      baseRisk: 'medium',
      baseConfidence: 0.7,
    },
  },
  {
    patterns: [/\barchitecture\b/i, /\bnorth[- ]?star\b/i, /\bmasterplan\b/i, /\bbacklog\b/i],
    bucket: {
      taskTypes: ['architecture', 'planning'],
      subsystems: ['docs'],
      verificationProfile: 'architecture',
      baseComplexity: 'architectural',
      baseRisk: 'high',
      baseConfidence: 0.8,
    },
  },
  {
    patterns: [/\bbug\b/i, /\bbroken\b/i, /\bfailing\b/i, /\bcrash(es|ing|ed)?\b/i, /\b(404|500|timeout)\b/i, /\bimage[- ]?missing\b/i],
    bucket: {
      taskTypes: ['bug'],
      subsystems: [],
      verificationProfile: 'ingestion',
      baseComplexity: 'small',
      baseRisk: 'low',
      baseConfidence: 0.5,
    },
  },
  {
    patterns: [/\bfeature\b/i, /\badd\b/i, /\bimplement\b/i, /\bsupport\b/i],
    bucket: {
      taskTypes: ['feature'],
      subsystems: [],
      verificationProfile: 'ingestion',
      baseComplexity: 'normal',
      baseRisk: 'low',
      baseConfidence: 0.45,
    },
  },
  {
    patterns: [/\btest\b/i, /\bvitest\b/i, /\bfixture\b/i, /\breplay\b/i],
    bucket: {
      taskTypes: ['testing'],
      subsystems: [],
      verificationProfile: 'ingestion',
      baseComplexity: 'small',
      baseRisk: 'low',
      baseConfidence: 0.55,
    },
  },
];

const PLANNING_ONLY_PATTERNS: RegExp[] = [
  /\bplan[ -]?only\b/i,
  /\bdo[ -]?not[ -]?(implement|change|codemod)\b/i,
  /\b(only[ -])?(plan|investigate|research|analyze)[ -]?(first|only)?\b/i,
  /\bno[ -]?(changes?|implementation|codemod|edits?)\b/i,
  /\binvestigate[ -]?(first|only)?\b/i,
];

const USER_OVERRIDE_PATTERNS: Array<{ re: RegExp; value: UserOverride }> = [
  { re: /\bdo[ -]?not[ -]?commit\b/i, value: 'no_commit' },
  { re: /\bno[ -]?(web|network|http|fetch)\b/i, value: 'no_web' },
  { re: /\b(use[ -]?)?only[ -]?one[ -]?agent\b/i, value: 'use_only_one_agent' },
  { re: /\bdo[ -]?not[ -]?(touch|modify|edit|change)[ -]?(masterplan|north[ -]?star)\b/i, value: 'do_not_touch_masterplan' },
  { re: /\bdo[ -]?not[ -]?(implement|change|code)\b/i, value: 'do_not_implement' },
];

function detectPlanningOnly(prompt: string): boolean {
  for (const re of PLANNING_ONLY_PATTERNS) if (re.test(prompt)) return true;
  return false;
}

function detectUserOverrides(prompt: string): UserOverride[] {
  const out: UserOverride[] = [];
  const seen = new Set<UserOverride>();
  for (const { re, value } of USER_OVERRIDE_PATTERNS) {
    if (re.test(prompt) && !seen.has(value)) {
      out.push(value);
      seen.add(value);
    }
  }
  return out;
}

const RISK_BUCKETS: Array<{ patterns: RegExp[]; delta: number }> = [
  { patterns: [/\bprod(uction)?\b/i, /\bmigration\s+apply\b/i, /\bgit\s+push\b/i, /\bmain\s+branch\b/i, /\bdrop\b/i, /\bdelete\b/i, /\bdestroy\b/i, /\bdrop\s+table\b/i, /\brebuild\b/i], delta: 2 },
  { patterns: [/\bforce[- ]?push\b/i, /\brm\s+-rf\b/i, /\bschema\s+apply\b/i, /\bapply\s+migration\b/i, /migration\b/i], delta: 1 },
];

const COMPLEXITY_BUCKETS: Array<{ patterns: RegExp[]; delta: number }> = [
  { patterns: [/\bmasterplan\b/i, /\bschema\b/i, /\bbacklog\b/i, /\barchitect(ure|ure)\b/i, /\bcross[- ]?system\b/i], delta: 1 },
  { patterns: [/\bforce\b/i, /\bdelete\b/i, /\bprod\b/i, /\bdeploy\b/i], delta: 1 },
  { patterns: [/\bfix\b/i, /\bsmall\b/i, /kulturhuset|berwaldhallen|ticketmaster|eventbrite|billetto|debaser/i, /\b(?:adapter|rule)\b/i], delta: -1 },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function applyRisk(prompt: string, base: Risk): { risk: Risk; signals: Record<string, number> } {
  const signals: Record<string, number> = {};
  let score = base === 'low' ? 0 : base === 'medium' ? 1 : base === 'high' ? 2 : 3;
  for (const bucket of RISK_BUCKETS) {
    for (const re of bucket.patterns) {
      if (re.test(prompt)) {
        signals[`risk:${re.source}`] = bucket.delta;
        score += bucket.delta;
      }
    }
  }
  const risk: Risk = score <= 0 ? 'low' : score <= 1 ? 'low' : score <= 2 ? 'medium' : score <= 3 ? 'high' : 'critical';
  return { risk, signals };
}

function applyComplexity(prompt: string, base: Complexity): { complexity: Complexity; signals: Record<string, number> } {
  const order: Complexity[] = ['trivial', 'small', 'normal', 'cross_system', 'architectural'];
  const signals: Record<string, number> = {};
  let idx = order.indexOf(base);
  for (const bucket of COMPLEXITY_BUCKETS) {
    for (const re of bucket.patterns) {
      if (re.test(prompt)) {
        signals[`complexity:${re.source}`] = bucket.delta;
        idx += bucket.delta;
      }
    }
  }
  idx = clamp(idx, 0, order.length - 1);
  return { complexity: order[idx], signals };
}

function detectExecutionMode(complexity: Complexity, risk: Risk): ExecutionMode {
  if (complexity === 'trivial') return 'solo';
  if (complexity === 'small') {
    if (risk === 'low' || risk === 'medium') return 'single_agent';
    return 'small_team';
  }
  if (complexity === 'normal') {
    if (risk === 'low') return 'single_agent';
    if (risk === 'medium') return 'small_team';
    return 'lead_plus_specialists';
  }
  if (complexity === 'cross_system') {
    if (risk === 'low' || risk === 'medium') return 'small_team';
    return 'lead_plus_specialists';
  }
  // architectural
  return 'architectural_review';
}

function pickRoles(executionMode: ExecutionMode, subsystems: Subsystem[]): Role[] {
  const roles: Role[] = [];
  if (executionMode !== 'solo') {
    roles.push('lead');
  }
  const sysToRole: Record<Subsystem, Role | undefined> = {
    source_adapter: 'ingestion_engineer',
    ingestion: 'ingestion_engineer',
    normalization: 'event_graph_engineer',
    venue_graph: 'event_graph_engineer',
    event_graph: 'event_graph_engineer',
    agent_api: 'agent_ranking_engineer',
    expo_ui: 'expo_engineer',
    database: 'event_graph_engineer',
    queue: 'ingestion_engineer',
    vault: 'lead',
    docs: 'lead',
    config: 'lead',
  };
  const seen = new Set<Role>(['lead']);
  for (const s of subsystems) {
    const r = sysToRole[s];
    if (r && !seen.has(r)) {
      seen.add(r);
      roles.push(r);
    }
  }
  if (execution_mode_requires_qa(executionMode) && !seen.has('qa')) {
    roles.push('qa');
  }
  return roles;
}

function execution_mode_requires_qa(mode: ExecutionMode): boolean {
  return mode === 'small_team' || mode === 'lead_plus_specialists' || mode === 'architectural_review';
}

export function classify(prompt: string): Classification {
  const trimmed = (prompt ?? '').trim();
  const upper = trimmed.length > 500 ? trimmed.slice(0, 500) + '…' : trimmed;

  let bestBucket: KeywordBucket | null = null;
  let bestScore = 0;
  const signals: Record<string, number> = {};

  for (const { patterns, bucket } of KEYWORD_BUCKETS) {
    let localScore = 0;
    for (const re of patterns) {
      if (re.test(upper)) {
        localScore += 1;
      }
    }
    if (localScore > bestScore) {
      bestScore = localScore;
      bestBucket = bucket;
    }
    if (localScore > 0) {
      signals[`bucket:${patterns[0].source}`] = localScore;
    }
  }

  if (!bestBucket) {
    if (trimmed.length < 40) {
      const planning_only = detectPlanningOnly(upper);
      const user_overrides = detectUserOverrides(upper);
      return {
        task_type: planning_only ? 'planning' : 'trivial',
        subsystems: [],
        complexity: 'trivial',
        risk: 'low',
        execution_mode: planning_only ? 'solo' : 'solo',
        roles: [],
        verification_profile: 'trivial',
        classification_confidence: 0.6,
        signals: { fallback: 1 },
        planning_only,
        user_overrides,
      };
    }
    bestBucket = {
      taskTypes: ['feature'],
      subsystems: [],
      verificationProfile: 'ingestion',
      baseComplexity: 'normal',
      baseRisk: 'low',
      baseConfidence: 0.35,
    };
  }

  const { risk, signals: rs } = applyRisk(upper, bestBucket.baseRisk);
  const { complexity, signals: cs } = applyComplexity(upper, bestBucket.baseComplexity);
  Object.assign(signals, rs, cs);

  const planning_only = detectPlanningOnly(upper);
  const user_overrides = detectUserOverrides(upper);

  const execution_mode = planning_only
    ? 'solo'
    : detectExecutionMode(complexity, risk);
  const roles = planning_only ? [] : pickRoles(execution_mode, bestBucket.subsystems);

  let task_type: TaskType =
    bestBucket.taskTypes.find((t) => t !== 'feature') ?? bestBucket.taskTypes[0] ?? 'feature';
  if (planning_only && task_type !== 'planning') task_type = 'planning';

  return {
    task_type,
    subsystems: bestBucket.subsystems,
    complexity,
    risk,
    execution_mode,
    roles,
    verification_profile: bestBucket.verificationProfile ?? 'ingestion',
    classification_confidence: clamp(bestBucket.baseConfidence + bestScore * 0.05, 0, 1),
    signals,
    planning_only,
    user_overrides,
  };
}

if (typeof require !== 'undefined' && require.main === module) {
  // CLI smoke test: `tsx classifier.ts "Fix Kulturhuset adapter when image is missing"`
  const prompt = process.argv.slice(2).join(' ') || 'Fix a small bug in runA.ts';
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(classify(prompt), null, 2));
}
