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

import { existsSync, readFileSync } from 'node:fs';
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
}

export interface StateSnapshot {
  wrapper: WrapperState;
  tasks: Task[];
  blocked: Task[];
  recent_commits: Commit[];
  recent_activity: ActivityEntry[];
  decisions_count: number;
  discovered_count: number;
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
    captured_at: new Date().toISOString(),
  };
}

export { existsSync };