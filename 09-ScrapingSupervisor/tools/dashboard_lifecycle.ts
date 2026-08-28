/**
 * dashboard_lifecycle.ts — start/restart the dashboard if it is not running.
 *
 * Workaround for macOS Sequoia: launchd LaunchAgents copied from external
 * volumes get a `com.apple.provenance` xattr that launchd refuses to load
 * without `sudo xattr -d`. We work around that by spawning the dashboard
 * server as a detached background process from the supervisor.
 *
 * Each supervisor run checks if the dashboard is up; if not, it spawns it.
 * Result: dashboard restarts whenever supervisor runs (1x/day at 04:30 by
 * default). For "always on" the user can run `npx tsx
 * 09-ScrapingSupervisor/dashboard/server.ts` in a separate Terminal tab.
 */

import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DASHBOARD_PORT = Number(process.env.PORT ?? 7777);
const PID_REL_PATH = 'runtime/scraping-supervisor/dashboard.pid';
const STDOUT_REL_PATH = 'runtime/scraping-supervisor/dashboard.stdout.log';
const STDERR_REL_PATH = 'runtime/scraping-supervisor/dashboard.stderr.log';

export interface DashboardLifecycleResult {
  wasRunning: boolean;
  spawned: boolean;
  pid: number | null;
  error: string | null;
}

/**
 * Check if the dashboard is responding on its port, and if not spawn it.
 * Idempotent: if a stale PID file points at a dead process, cleans up first.
 */
export function ensureDashboardRunning(projectRoot: string): DashboardLifecycleResult {
  if (probeHealth()) {
    return { wasRunning: true, spawned: false, pid: null, error: null };
  }

  const pidPath = join(projectRoot, PID_REL_PATH);
  if (existsSync(pidPath)) {
    try { unlinkSync(pidPath); } catch { /* ignore */ }
  }

  const dashboardTs = resolve(__dirname, '..', 'dashboard', 'server.ts');
  const nodeBin = process.execPath;
  const tsxCli = resolve(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const stdoutLog = join(projectRoot, STDOUT_REL_PATH);
  const stderrLog = join(projectRoot, STDERR_REL_PATH);

  try {
    const out = openSync(stdoutLog, 'a');
    const err = openSync(stderrLog, 'a');
    const child = spawn(nodeBin, [tsxCli, dashboardTs], {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(DASHBOARD_PORT),
        EVENTPULSE_PROJECT_ROOT: projectRoot,
      },
    });
    child.unref();
    writeFileSync(pidPath, String(child.pid ?? ''));
    return { wasRunning: false, spawned: true, pid: child.pid ?? null, error: null };
  } catch (e) {
    return {
      wasRunning: false,
      spawned: false,
      pid: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function probeHealth(): boolean {
  try {
    const out = execSync(
      `curl -s -m 1 http://localhost:${DASHBOARD_PORT}/health`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out.trim() === 'ok';
  } catch {
    return false;
  }
}

/**
 * Read the running dashboard's PID (from the pidfile we wrote). Returns null
 * if no pidfile or pid is dead.
 */
export function readDashboardPid(projectRoot: string): number | null {
  const pidPath = join(projectRoot, PID_REL_PATH);
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, 'utf-8').trim();
  const pid = Number(raw);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
