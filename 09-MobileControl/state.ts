/**
 * state.ts — read Phase 1 persistent state into a typed snapshot.
 *
 * Sources (read-only — we never write to Phase 1 files):
 *   - runtime/autonomous-loop/state.json   (wrapper state, per-iter summary)
 *   - runtime/autonomous-loop/loop.log      (human-readable event log)
 *   - runtime/autonomous-loop/iter-N.json  (per-iteration claude output)
 *   - 00-Vault/.../23-Active-Task-Queue.md  (persistent task queue)
 *   - 00-Vault/.../19-Decision-Log.md       (decisions)
 *   - 00-Vault/.../24-Discovered-Work.md    (discovered work)
 *   - runtime/autonomous-loop/wrapper.pid   (is wrapper alive?)
 *   - git log                               (recent commits via child_process)
 *
 * This module is the bridge from Phase 1's persistent state to Phase 2's
 * dashboard. It must NEVER invent state — if a source is missing or stale,
 * return an honest empty/zero value.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

export interface WrapperState {
  status: 'running' | 'stopped' | 'unknown';
  pid: number | null;
  started_at: string | null;
  iteration: number;
  last_status: string;
  last_exit_code: number | null;
  last_iter_at: string | null;
  elapsed_hours: number;
  max_restarts: number;
  max_total_hours: number;
}

export interface Task {
  id: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  source: string;
  verify: string;
  owner_agent?: string;
  last_verified_state?: string;
}

export interface Commit {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface ActivityEntry {
  ts: string;
  type: string;
  detail: string;
  meta?: Record<string, unknown>;
}

export interface IterSummary {
  iter: number;
  stop_reason: string;
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  duration_ms: number | null;
  result_preview: string;
  captured_at: string;
}

export interface AgentState {
  role: 'lead' | 'work' | 'vault-sync';
  task: string;
  started_at: string;
  last_heartbeat: string;
  status: 'running' | 'completed' | 'failed';
}

export interface StateSnapshot {
  wrapper: WrapperState;
  tasks: Task[];
  blocked: Task[];
  currently_active_task: string | null;
  recent_commits: Commit[];
  recent_activity: ActivityEntry[];
  decisions_count: number;
  discovered_count: number;
  agents: AgentState[];
  last_iter_summary: IterSummary | null;
  last_event_at: string | null;
  captured_at: string;
}

const DEFAULT_PROJECT_ROOT = '/Volumes/2TB filer/NEWSTRUCTURE-COPY';

export function projectRoot(): string {
  return process.env.PROJECT_ROOT ?? DEFAULT_PROJECT_ROOT;
}

export function wrapperStatePath(): string {
  return join(projectRoot(), 'runtime/autonomous-loop/state.json');
}

export function wrapperPidPath(): string {
  return join(projectRoot(), 'runtime/autonomous-loop/wrapper.pid');
}

export function loopLogPath(): string {
  return join(projectRoot(), 'runtime/autonomous-loop/loop.log');
}

export function taskQueuePath(): string {
  return join(
    projectRoot(),
    '00-Vault/01-Projects/EventPulse/02-Operations/23-Active-Task-Queue.md'
  );
}

export function decisionLogPath(): string {
  return join(
    projectRoot(),
    '00-Vault/01-Projects/EventPulse/02-Operations/19-Decision-Log.md'
  );
}

export function discoveredWorkPath(): string {
  return join(
    projectRoot(),
    '00-Vault/01-Projects/EventPulse/02-Operations/24-Discovered-Work.md'
  );
}

export function activityStreamPath(): string {
  return join(projectRoot(), '09-MobileControl/runtime/activity.jsonl');
}

export function agentStatePath(): string {
  return join(projectRoot(), 'runtime/agents/state.json');
}

export function iterOutputDir(): string {
  return join(projectRoot(), 'runtime/autonomous-loop');
}

function readJsonSafe<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function readTextSafe(path: string): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Read wrapper state. Combines state.json + wrapper.pid liveness.
 */
export function readWrapperState(): WrapperState {
  const stateFile = readJsonSafe<Partial<WrapperState>>(wrapperStatePath(), {});

  let pid: number | null = null;
  let runningStatus: 'running' | 'stopped' | 'unknown' = 'unknown';
  if (existsSync(wrapperPidPath())) {
    const raw = readFileSync(wrapperPidPath(), 'utf-8').trim();
    pid = Number.parseInt(raw, 10);
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        runningStatus = 'running';
      } catch {
        runningStatus = 'stopped';
      }
    }
  }

  return {
    status: runningStatus,
    pid,
    started_at: stateFile.started_at ?? null,
    iteration: stateFile.iteration ?? 0,
    last_status: stateFile.last_status ?? 'unknown',
    last_exit_code: stateFile.last_exit_code ?? null,
    last_iter_at: stateFile.last_iter_at ?? null,
    elapsed_hours: stateFile.elapsed_hours ?? 0,
    max_restarts: stateFile.max_restarts ?? 1000,
    max_total_hours: stateFile.max_total_hours ?? 24,
  };
}

/**
 * Parse the task queue markdown. Returns flat array of Task.
 *
 * Schema (one task = one bullet block starting with `_T<NNNN>_`):
 *   _T0002_ — **Title** — Description
 *     *Verify:* ...
 *     *Source:* ...
 */
export function readTaskQueue(): Task[] {
  const md = readTextSafe(taskQueuePath());
  if (!md) return [];

  const tasks: Task[] = [];
  const lines = md.split('\n');

  let currentPriority: Task['priority'] = 'P3';
  const ownerHints = new Map<string, string>();
  const lvHints = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sectionMatch = line.match(/^###\s+(P[0-3])\b/);
    if (sectionMatch) {
      currentPriority = sectionMatch[1] as Task['priority'];
      continue;
    }
    if (line.includes('## Completed')) break;

    const taskMatch = line.match(/^_(T\d+)_\s+—\s+\*\*(.+?)\*\*(?:\s+—\s+(.+))?$/);
    if (taskMatch) {
      const [, id, title] = taskMatch;
      let status: Task['status'] = 'pending';
      let source = '';
      let verify = '';

      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const next = lines[j];
        if (next.startsWith('_T') || next.startsWith('###')) break;
        const vMatch = next.match(/\*Verify:\*\s*(.+)/);
        const sMatch = next.match(/\*Source:\*\s*(.+)/);
        const oMatch = next.match(/\*Owner agent:\*\s*(.+)/);
        const lvMatch = next.match(/\*Last verified state:\*\s*(.+)/);
        if (vMatch) verify = vMatch[1].trim();
        if (sMatch) source = sMatch[1].trim();
        if (oMatch) ownerHints.set(id, oMatch[1].trim());
        if (lvMatch) lvHints.set(id, lvMatch[1].trim());
        if (next.includes('**DONE') || next.includes('DONE 2026-')) status = 'done';
        const sm = next.match(/\*Status:\*\s*`?(\w+)`?/);
        if (sm) status = sm[1] as Task['status'];
      }

      tasks.push({
        id,
        status,
        priority: currentPriority,
        title,
        source,
        verify,
        owner_agent: ownerHints.get(id),
        last_verified_state: lvHints.get(id),
      });
    }
  }

  return tasks;
}

export function readBlockedTasks(): Task[] {
  return readTaskQueue().filter((t) => t.status === 'blocked' || t.status === 'in_progress');
}

export function readRecentCommits(n = 10): Commit[] {
  try {
    const out = execSync(
      `git log -${n} --pretty=format:"%H%x1f%h%x1f%s%x1f%an%x1f%ad" --date=iso-strict`,
      { cwd: projectRoot(), encoding: 'utf-8' }
    );
    return out.split('\n').filter(Boolean).map((line) => {
      const [hash, short_hash, subject, author, date] = line.split('\x1f');
      return { hash, short_hash, subject, author, date };
    });
  } catch {
    return [];
  }
}

export function readActivity(n = 50): ActivityEntry[] {
  const path = activityStreamPath();
  if (!existsSync(path)) return [];
  try {
    const text = readFileSync(path, 'utf-8');
    const lines = text.trim().split('\n').filter(Boolean);
    return lines
      .slice(-n)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line) as ActivityEntry;
        } catch {
          return { ts: '', type: 'malformed', detail: line };
        }
      });
  } catch {
    return [];
  }
}

function countSectionBullets(md: string, sectionHeading: string): number {
  const start = md.indexOf(sectionHeading);
  if (start === -1) return 0;
  const tail = md.slice(start);
  const end = tail.indexOf('\n## ');
  const section = end === -1 ? tail : tail.slice(0, end);
  return (section.match(/^- /gm) ?? []).length;
}

export function readDecisionsCount(): number {
  const md = readTextSafe(decisionLogPath());
  return countSectionBullets(md, '## Aktiva beslut');
}

/**
 * Read the most recent iteration's summary from iter-N.json.
 * `claude --print --output-format json` produces a flat result object (no
 * messages array), so we surface what we actually have:
 * stop_reason, num_turns, total_cost_usd, result preview.
 *
 * When the wrapper is restarted, it overwrites `state.json` but leaves old
 * `iter-N.json` files on disk. Without filtering, the dashboard would show
 * the highest-N iter from a previous run. We use `state.json.started_at`
 * to ignore iter files older than the current wrapper invocation.
 */
export function parseLastIterSummary(): IterSummary | null {
  const dir = iterOutputDir();
  if (!existsSync(dir)) return null;

  // Cutoff: only iter files with mtime >= the current wrapper started_at.
  let cutoffMs = 0;
  try {
    const statePath = wrapperStatePath();
    const stateFile = readJsonSafe<{ started_at?: string }>(statePath, {});
    if (stateFile?.started_at) {
      const parsed = Date.parse(stateFile.started_at);
      if (Number.isFinite(parsed)) cutoffMs = parsed;
    }
  } catch {
    /* fall through with cutoffMs=0 — accept all iters */
  }

  let highestIter = 0;
  let highestPath: string | null = null;
  try {
    const entries = readdirSync(dir);
    for (const name of entries) {
      const m = name.match(/^iter-(\d+)\.json$/);
      if (!m) continue;
      const n = Number.parseInt(m[1], 10);
      if (!Number.isFinite(n)) continue;
      const fullPath = join(dir, name);
      if (cutoffMs > 0) {
        try {
          const st = statSync(fullPath);
          if (st.mtimeMs < cutoffMs) continue; // stale, from a previous wrapper run
        } catch {
          continue;
        }
      }
      if (n > highestIter) {
        highestIter = n;
        highestPath = fullPath;
      }
    }
  } catch {
    return null;
  }
  if (!highestPath) return null;

  const data = readJsonSafe<Record<string, unknown>>(highestPath, {});
  if (!data || typeof data !== 'object') return null;

  const result = typeof data.result === 'string' ? data.result : '';
  return {
    iter: highestIter,
    stop_reason: typeof data.stop_reason === 'string' ? data.stop_reason : 'unknown',
    is_error: data.is_error === true,
    num_turns: typeof data.num_turns === 'number' ? data.num_turns : 0,
    total_cost_usd:
      typeof data.total_cost_usd === 'number' ? data.total_cost_usd : 0,
    duration_ms:
      typeof data.duration_ms === 'number' ? data.duration_ms : null,
    result_preview: result.slice(0, 240),
    captured_at: new Date().toISOString(),
  };
}

/**
 * Read per-agent liveness from runtime/agents/state.json.
 * Written by Claude Code PostToolUse hooks when EP_AUTONOMOUS=1.
 * Returns empty array if no agents are active or file is missing.
 */
export function readActiveAgents(): AgentState[] {
  const path = agentStatePath();
  if (!existsSync(path)) return [];
  const data = readJsonSafe<{ agents?: AgentState[] }>(path, {});
  if (!data?.agents) return [];
  // Only surface agents updated in the last 30 min as "active"
  const cutoff = Date.now() - 30 * 60 * 1000;
  return data.agents.filter((a) => {
    const t = new Date(a.last_heartbeat).getTime();
    return Number.isFinite(t) && t > cutoff;
  });
}

/**
 * Read the timestamp of the most recent activity.jsonl entry.
 * Null if the file is empty or missing.
 */
export function readLastEventAt(): string | null {
  const path = activityStreamPath();
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, 'utf-8').trim();
    if (!text) return null;
    const lines = text.split('\n');
    const last = lines[lines.length - 1];
    const parsed = JSON.parse(last) as { ts?: string };
    return parsed.ts ?? null;
  } catch {
    return null;
  }
}

export function readDiscoveredCount(): number {
  const md = readTextSafe(discoveredWorkPath());
  return countSectionBullets(md, '## Discovered');
}

export function readSnapshot(): StateSnapshot {
  const tasks = readTaskQueue();
  const wrapper = readWrapperState();

  // Heuristic: which task is the lead currently working on?
  // 1. Wrapper must be running
  // 2. Last iter must be recent (within 10 min) — else system is idle
  // 3. Prefer an explicit in_progress task; else first pending P0/P1 task
  let activeId: string | null = null;
  if (wrapper.status === 'running' && wrapper.last_iter_at) {
    const ageMs = Date.now() - new Date(wrapper.last_iter_at).getTime();
    if (ageMs >= 0 && ageMs < 10 * 60 * 1000) {
      const inProg = tasks.find((t) => t.status === 'in_progress');
      if (inProg) {
        activeId = inProg.id;
      } else {
        const top = tasks.find(
          (t) => t.status === 'pending' && (t.priority === 'P0' || t.priority === 'P1')
        );
        if (top) activeId = top.id;
      }
    }
  }

  return {
    wrapper,
    tasks,
    blocked: tasks.filter((t) => t.status === 'blocked' || t.status === 'in_progress'),
    currently_active_task: activeId,
    recent_commits: readRecentCommits(10),
    recent_activity: readActivity(50),
    decisions_count: readDecisionsCount(),
    discovered_count: readDiscoveredCount(),
    agents: readActiveAgents(),
    last_iter_summary: parseLastIterSummary(),
    last_event_at: readLastEventAt(),
    captured_at: new Date().toISOString(),
  };
}

export { existsSync };