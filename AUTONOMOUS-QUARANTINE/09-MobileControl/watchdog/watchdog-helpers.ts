/**
 * watchdog-helpers.ts — pure helpers for the watchdog. No side effects,
 * no main() invocation. Safe to import from tests.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_PROJECT_ROOT = '/Volumes/2TB filer/NEWSTRUCTURE-COPY';
export const DEFAULT_LOG_DIR = join(DEFAULT_PROJECT_ROOT, 'runtime/autonomous-loop');
export const DEFAULT_LOOP_LOG = join(DEFAULT_LOG_DIR, 'loop.log');

export const DEFAULT_STUCK_HOURS = 4;
export const DEFAULT_DEAD_MIN = 30;
export const DEFAULT_BUDGET_LOOP_COUNT = 3;
export const DEFAULT_LAUNCHD_LABEL = 'com.eventpulse.autonomous';

export interface State {
  iteration: number;
  last_iter_at: string | null;
  last_status: string;
  last_exit_code: number | null;
}

export type Verdict = 'healthy' | 'stuck' | 'dead' | 'budget_loop' | 'unknown';

export interface HealthReport {
  verdict: Verdict;
  reason: string;
  pid: number | null;
  pidAlive: boolean;
  iteration: number;
  lastIterAt: string | null;
  ageMin: number | null;
  consecutiveBudgetExceeded: number;
  actions: string[];
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function parseLoopLogConsecutiveBudgetExceeded(loopLogPath: string = DEFAULT_LOOP_LOG): number {
  if (!existsSync(loopLogPath)) return 0;
  try {
    const text = readFileSync(loopLogPath, 'utf-8');
    const lines = text.trim().split('\n').reverse();
    let count = 0;
    for (const line of lines) {
      if (line.includes('budget exhausted')) {
        count++;
      } else if (line.includes('exit=0') || /\biter=\d+\s+elapsed/.test(line)) {
        break;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export function ageMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 60000;
}
