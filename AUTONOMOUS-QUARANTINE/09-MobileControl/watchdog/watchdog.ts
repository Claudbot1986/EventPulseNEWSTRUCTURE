/**
 * watchdog.ts — EventPulse autonomous-loop health watchdog.
 *
 * Detects when the wrapper (scripts/autonomous-loop.sh) is stuck, dead, or
 * spinning on budget-exhausted iterations. Runs once per invocation.
 *
 * Health signals (from runtime/autonomous-loop/):
 *   - state.json: { iteration, last_iter_at, last_status, last_exit_code }
 *   - wrapper.pid: PID of the wrapper process
 *   - loop.log: append-only event log
 *
 * Detection thresholds (env-overridable):
 *   WATCHDOG_STUCK_HOURS=4     last_iter_at older than this = STUCK
 *   WATCHDOG_DEAD_MIN=30      process dead AND no activity this long = DEAD
 *   WATCHDOG_BUDGET_LOOP=3    this many consecutive budget_exhausted = BUDGET_LOOP
 *
 * Actions:
 *   - healthy: log status, exit 0
 *   - stuck:   SIGTERM the wrapper (launchd KeepAlive will respawn it cleanly)
 *   - dead:    launchctl kickstart -k the launchd job
 *   - budget_loop: log alert (do NOT auto-fix; user must review)
 *
 * Always logs a structured line to runtime/watchdog.log AND emits an event
 * to 09-MobileControl/runtime/activity.jsonl so the dashboard reflects it.
 *
 * Usage:
 *   npx tsx 09-MobileControl/watchdog/watchdog.ts
 *   npx tsx 09-MobileControl/watchdog/watchdog.ts --check   # report only, no action
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? '/Volumes/2TB filer/NEWSTRUCTURE-COPY';
const LOG_DIR = join(PROJECT_ROOT, 'runtime/autonomous-loop');
const STATE_FILE = join(LOG_DIR, 'state.json');
const PID_FILE = join(LOG_DIR, 'wrapper.pid');
const LOOP_LOG = join(LOG_DIR, 'loop.log');
const STOP_FILE = join(LOG_DIR, 'STOP');
const WATCHDOG_LOG = join(LOG_DIR, 'watchdog.log');
const ACTIVITY_LOG = join(PROJECT_ROOT, '09-MobileControl/runtime/activity.jsonl');
const LAUNCHD_LABEL = 'com.eventpulse.autonomous';

const STUCK_HOURS = Number(process.env.WATCHDOG_STUCK_HOURS ?? '4');
const DEAD_MIN = Number(process.env.WATCHDOG_DEAD_MIN ?? '30');
const BUDGET_LOOP_COUNT = Number(process.env.WATCHDOG_BUDGET_LOOP ?? '3');
const CHECK_ONLY = process.argv.includes('--check');

type Verdict = 'healthy' | 'stuck' | 'dead' | 'budget_loop' | 'unknown';

interface State {
  iteration: number;
  last_iter_at: string | null;
  last_status: string;
  last_exit_code: number | null;
}

interface HealthReport {
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

function log(line: string): void {
  const ts = new Date().toISOString();
  const out = `[${ts}] ${line}\n`;
  process.stdout.write(out);
  try {
    appendFileSync(WATCHDOG_LOG, out);
  } catch {
    /* non-fatal */
  }
}

function emitActivity(type: string, detail: string, meta: Record<string, unknown>): void {
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), type, detail, meta }) + '\n';
    appendFileSync(ACTIVITY_LOG, entry);
  } catch {
    /* non-fatal */
  }
}

function readJsonSafe<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure helper exported for unit tests. Counts trailing "budget exhausted"
 * lines in loop.log, stopping at the first non-budget-exhausted iter.
 */
export function parseLoopLogConsecutiveBudgetExceeded(path: string = LOOP_LOG): number {
  if (!existsSync(path)) return 0;
  try {
    const text = readFileSync(path, 'utf-8');
    const lines = text.trim().split('\n').reverse();
    let count = 0;
    for (const line of lines) {
      if (line.includes('budget exhausted')) {
        count++;
      } else if (line.includes('exit=0') || /\biter=\d+\s+elapsed/.test(line)) {
        // A successful iter or new iter invocation breaks the streak.
        break;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Pure helper exported for unit tests. Returns age in minutes (negative if
 * the timestamp is in the future), or null for invalid input.
 */
export function ageMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 60000;
}

/**
 * Kill the wrapper via SIGTERM. launchd's KeepAlive will respawn it within
 * ThrottleInterval (10s).
 */
function killWrapper(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
    return;
  } catch {
    /* fall through to SIGKILL after a brief wait */
  }
  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }, 5000);
}

/**
 * Ask launchd to restart the job (kickstart -k = kill + restart).
 * Falls back to launchctl load if the job isn't loaded.
 */
function launchctlKickstart(): void {
  const uid = Number(process.getuid?.() ?? 0);
  const target = uid === 0 ? `system/${LAUNCHD_LABEL}` : `gui/${uid}/${LAUNCHD_LABEL}`;
  try {
    execSync(`launchctl kickstart -k "${target}"`, { stdio: 'ignore' });
    return;
  } catch {
    /* fall through to load */
  }
  const plistDest = join(process.env.HOME ?? '', 'Library/LaunchAgents', LAUNCHD_LABEL + '.plist');
  try {
    execSync(`launchctl load -w "${plistDest}"`, { stdio: 'ignore' });
  } catch {
    /* swallow */
  }
}

function check(): HealthReport {
  const state = readJsonSafe<State>(STATE_FILE);
  const pidRaw = existsSync(PID_FILE) ? readFileSync(PID_FILE, 'utf-8').trim() : '';
  const pid = pidRaw && /^\d+$/.test(pidRaw) ? Number(pidRaw) : null;
  const pidAlive = pid !== null && isPidAlive(pid);
  const lastIterAt = state?.last_iter_at ?? null;
  const ageMin = ageMinutes(lastIterAt);
  const iter = state?.iteration ?? 0;
  const consec = parseLoopLogConsecutiveBudgetExceeded();

  const report: HealthReport = {
    verdict: 'unknown',
    reason: '',
    pid,
    pidAlive,
    iteration: iter,
    lastIterAt,
    ageMin,
    consecutiveBudgetExceeded: consec,
    actions: [],
  };

  // User-set STOP file means wrapper exited intentionally — not a problem.
  if (existsSync(STOP_FILE)) {
    report.verdict = 'healthy';
    report.reason = 'STOP file present (intentional exit)';
    return report;
  }

  if (!pidAlive && ageMin !== null && ageMin > DEAD_MIN) {
    report.verdict = 'dead';
    report.reason = `wrapper PID ${pid} not alive AND last_iter_at ${ageMin.toFixed(1)}min ago (>${DEAD_MIN}min)`;
  } else if (pidAlive && ageMin !== null && ageMin > STUCK_HOURS * 60) {
    report.verdict = 'stuck';
    report.reason = `wrapper PID ${pid} alive BUT last_iter_at ${ageMin.toFixed(1)}min ago (>${STUCK_HOURS}h)`;
  } else if (consec >= BUDGET_LOOP_COUNT) {
    report.verdict = 'budget_loop';
    report.reason = `${consec} consecutive budget-exhausted iters in loop.log tail`;
  } else if (pidAlive) {
    report.verdict = 'healthy';
    report.reason = `wrapper PID ${pid} alive, last_iter_at ${ageMin === null ? 'n/a' : ageMin.toFixed(1) + 'min'} ago`;
  } else if (ageMin !== null && ageMin <= DEAD_MIN) {
    report.verdict = 'healthy';
    report.reason = `wrapper restarting (last iter ${ageMin.toFixed(1)}min ago, within ${DEAD_MIN}min grace)`;
  } else {
    report.verdict = 'unknown';
    report.reason = 'no state.json or wrapper.pid yet';
  }

  return report;
}

function act(report: HealthReport): void {
  if (CHECK_ONLY) return;

  switch (report.verdict) {
    case 'stuck':
      if (report.pid !== null) {
        log(`ACTION: killing stuck wrapper pid=${report.pid} (launchd will respawn)`);
        killWrapper(report.pid);
        report.actions.push(`SIGTERM pid=${report.pid}`);
      }
      break;
    case 'dead':
      log(`ACTION: kicking launchd job ${LAUNCHD_LABEL} (wrapper dead since ${report.ageMin?.toFixed(1)}min)`);
      launchctlKickstart();
      report.actions.push(`launchctl kickstart ${LAUNCHD_LABEL}`);
      break;
    case 'budget_loop':
      log(`ALERT: budget exhausted ${report.consecutiveBudgetExceeded}x — user review required`);
      break;
    case 'healthy':
    case 'unknown':
    default:
      break;
  }
}

function main(): void {
  const report = check();
  const summary =
    `verdict=${report.verdict} ` +
    `pid=${report.pid ?? 'n/a'} alive=${report.pidAlive} ` +
    `iter=${report.iteration} age=${report.ageMin === null ? 'n/a' : report.ageMin.toFixed(1) + 'min'} ` +
    `budget_streak=${report.consecutiveBudgetExceeded} ` +
    `reason="${report.reason}"`;
  log(`CHECK: ${summary}`);
  emitActivity('watchdog_check', summary, {
    verdict: report.verdict,
    pid: report.pid,
    pid_alive: report.pidAlive,
    iteration: report.iteration,
    last_iter_at: report.lastIterAt,
    age_min: report.ageMin,
    consecutive_budget_exceeded: report.consecutiveBudgetExceeded,
    reason: report.reason,
  });

  act(report);

  if (report.actions.length > 0) {
    log(`ACTIONS: ${report.actions.join('; ')}`);
    emitActivity('watchdog_action', report.actions.join('; '), { actions: report.actions });
  }
}

main();
