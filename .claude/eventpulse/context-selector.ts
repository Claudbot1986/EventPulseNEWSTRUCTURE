/**
 * context-selector.ts — Tier 0..3 selection per plan §8.
 *
 * Returns file paths + 1-line summaries for the detected task. Never full
 * content — the main session uses the Read tool to pull bodies only when needed.
 *
 * Tier 4 (decision history) is NEVER auto-loaded — only via `/ep-status history`
 * or PreCompact recovery.
 */

import type { Classification, Subsystem } from './classifier';

export interface ContextEntry {
  path: string;          // repo-relative path
  summary: string;       // 1-line summary; never raw content
  tier: 0 | 1 | 2 | 3;
  optional?: boolean;    // if true, the main session may skip the Read
}

const TIER_0: ContextEntry[] = [
  {
    path: '.claude/eventpulse/policy.md',
    summary: 'Tier 0 invariant core (binding): Mission, Hard rules, Prompt-injection discipline, Risk boundaries.',
    tier: 0,
  },
];

const TIER_1: ContextEntry[] = [
  {
    path: 'docs/MASTERPLAN.md',
    summary: 'Strategic North Star (sections 1–10); agent API, ingestion, Event Graph, expo, verification.',
    tier: 1,
  },
  {
    path: 'docs/BACKLOG.md',
    summary: 'NOW / NEXT / LATER / DO NOT BUILD YET — single source of build order.',
    tier: 1,
  },
  {
    path: '.claude/rules/common/hooks.md',
    summary: 'Hook types, auto-accept permissions, TodoWrite usage.',
    tier: 1,
  },
  {
    path: '.claude/rules/common/agents.md',
    summary: 'Agent orchestration: roles, immediate-agent usage, parallel execution.',
    tier: 1,
  },
];

const TIER_2_BY_SUBSYSTEM: Record<Subsystem, ContextEntry[]> = {
  source_adapter: [
    {
      path: '02-Ingestion/A-directAPI-networkGate/runA.ts',
      summary: 'A-gate runner; reads runtime/preA-queue.jsonl + sources/*.jsonl (never_run).',
      tier: 2,
    },
  ],
  ingestion: [
    {
      path: '02-Ingestion/F-eventExtraction/schema.ts',
      summary: 'Canonical extraction schema (typed fields).',
      tier: 2,
    },
    {
      path: '02-Ingestion/F-eventExtraction/extractor.ts',
      summary: 'Universal extractor: JSON-LD via fetchHtml + JSON-LD parsing.',
      tier: 2,
    },
  ],
  normalization: [
    {
      path: '04-Normalizer/normalizer.ts',
      summary: 'buildDedupHash, category-mapping, venue-matching, deduplication, field-mapping.',
      tier: 2,
    },
  ],
  venue_graph: [
    {
      path: '07-Discovery/src/venueGraph/runVenueGraph.ts',
      summary: 'Venue graph substrate: scoring, candidate detection, observation persistence.',
      tier: 2,
    },
  ],
  event_graph: [
    {
      path: '05-Supabase/schema/schema.md',
      summary: 'Current Event Graph schema: events, venues, categories, ingestion_logs, venue_graph_*, source_candidates.',
      tier: 2,
    },
    {
      path: '04-Normalizer/normalizer.ts',
      summary: 'Normalization pipeline feeding the Event Graph.',
      tier: 2,
    },
  ],
  agent_api: [
    {
      path: '08-Agent/server.ts',
      summary: 'Phase 0 hosted agent API: POST /agent/chat with tool-calling (parse_intent, search_events, rank_events, record_feedback, …).',
      tier: 2,
      optional: true,
    },
  ],
  expo_ui: [
    {
      path: '06-UI/app.json',
      summary: 'Expo config: name, slug, sdkVersion, platforms, plugins.',
      tier: 2,
    },
    {
      path: '06-UI/App.js',
      summary: 'App root: providers, navigation, theme.',
      tier: 2,
    },
  ],
  database: [
    {
      path: '05-Supabase/schema/schema.md',
      summary: 'Authoritative schema reference.',
      tier: 2,
    },
    {
      path: '05-Supabase/migrations/',
      summary: 'Migration SQL files directory.',
      tier: 2,
    },
  ],
  queue: [
    {
      path: '03-Queue/queue.ts',
      summary: 'BullMQ queue + Redis connection.',
      tier: 2,
    },
  ],
  vault: [
    {
      path: '01-Projects/EventPulse/02-Operations/03-Current-Task.md',
      summary: 'Vault: current task + discoveries.',
      tier: 2,
    },
  ],
  docs: [
    {
      path: 'docs/MASTERPLAN.md',
      summary: 'Authoritative North Star (agent task authority).',
      tier: 2,
    },
  ],
  config: [
    {
      path: '~/.claude/settings.json',
      summary: 'Global Claude settings: env, permissions, plugins, hooks.',
      tier: 2,
    },
  ],
};

const TIER_3_BY_ROLE: Record<string, ContextEntry[]> = {
  ingestion_engineer: [
    {
      path: '02-Ingestion/A-directAPI-networkGate/adapters/',
      summary: 'Per-source adapter directory.',
      tier: 3,
    },
    {
      path: '02-Ingestion/C-htmlGate/123.md',
      summary: 'Authoritative C-htmlGate 123-loop workflow.',
      tier: 3,
    },
  ],
  event_graph_engineer: [
    {
      path: '04-Normalizer/venue-matching.ts',
      summary: 'Venue matching algorithm.',
      tier: 3,
      optional: true,
    },
  ],
  agent_ranking_engineer: [
    {
      path: '08-Agent/eval/golden-queries.stockholm.json',
      summary: 'Golden eval queries (when authored).',
      tier: 3,
      optional: true,
    },
  ],
  expo_engineer: [
    {
      path: '06-UI/services/eventServiceClient.js',
      summary: 'Anon read path (Tier 0: do NOT edit; strategic leak until agent API replaces it).',
      tier: 3,
    },
  ],
  backend_engineer: [],
  qa: [
    {
      path: 'Alltools-E2E/e2e.py',
      summary: 'Operator E2E harness invoking real runA / runB-parallel / runC-one-time-only / runD-scrapingbee.',
      tier: 3,
    },
  ],
  architect: [
    {
      path: 'RebuildPlan.md',
      summary: 'Historical rebuild plan; useful for prior-decision context.',
      tier: 3,
    },
  ],
};

export interface SelectionResult {
  tier0: ContextEntry[];
  tier1: ContextEntry[];
  tier2: ContextEntry[];
  tier3: ContextEntry[];
  notes: string[]; // human-readable notes about selection decisions
  redacted: ContextEntry[]; // entries filtered out as secret-bearing (mission §73)
}

const SECRET_PATH_PATTERNS: RegExp[] = [
  /\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.netrc$/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
  /credentials\.json$/i,
  /service[-_]account.*\.json$/i,
  /supabase\/.temp\//i,
];

function isSecretPath(p: string): boolean {
  for (const re of SECRET_PATH_PATTERNS) if (re.test(p)) return true;
  return false;
}

export function selectContext(classification: Classification, opts: { simplifyForTrivial?: boolean } = {}): SelectionResult {
  const simplify = opts.simplifyForTrivial ?? true;
  const notes: string[] = [];
  const redacted: ContextEntry[] = [];

  const tier0 = [...TIER_0];

  if (classification.complexity === 'trivial' && simplify) {
    notes.push('tier1 omitted (trivial)');
    return { tier0, tier1: [], tier2: [], tier3: [], notes, redacted };
  }

  const tier1 = [...TIER_1];

  function pushIfSafe(arr: ContextEntry[], seen: Set<string>, entry: ContextEntry): void {
    if (seen.has(entry.path)) return;
    seen.add(entry.path);
    if (isSecretPath(entry.path)) {
      redacted.push(entry);
      return;
    }
    arr.push(entry);
  }

  const tier2: ContextEntry[] = [];
  const seenTier2 = new Set<string>();
  for (const sys of classification.subsystems) {
    const entries = TIER_2_BY_SUBSYSTEM[sys] ?? [];
    for (const e of entries) pushIfSafe(tier2, seenTier2, e);
  }

  const tier3: ContextEntry[] = [];
  const seenTier3 = new Set<string>();
  for (const role of classification.roles) {
    const entries = TIER_3_BY_ROLE[role] ?? [];
    for (const e of entries) pushIfSafe(tier3, seenTier3, e);
  }

  if (classification.task_type === 'architecture') {
    const e = TIER_2_BY_SUBSYSTEM.docs[0];
    pushIfSafe(tier2, seenTier2, e);
  }

  if (classification.risk === 'critical') {
    notes.push('risk=critical — surface to human review before TaskCompleted.');
  }

  if (redacted.length > 0) {
    notes.push(`redacted ${redacted.length} secret-bearing path(s) from context (mission §73): ${redacted.map((r) => r.path).join(', ')}`);
  }

  return { tier0, tier1, tier2, tier3, notes, redacted };
}
