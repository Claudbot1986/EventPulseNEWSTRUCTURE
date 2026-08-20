/**
 * tmux.ts — persistent terminal wrapper.
 *
 * The autonomous loop MUST survive mobile disconnects. tmux is the standard
 * way: the autonomous-loop wrapper runs inside a tmux session, the mobile
 * dashboard can attach (with `tmux attach -t eventpulse`) to inspect or
 * interact, then detach without killing the underlying loop.
 *
 * Why tmux and not just nohup:
 *   - User can ssh in or attach via the dashboard's terminal button and SEE
 *     what the agent is doing in real time.
 *   - Disconnect/reconnect doesn't lose the session.
 *   - We can pipe commands to the session via `tmux send-keys` from the
 *     REST API (e.g. "send a message to the lead agent").
 *
 * Conventions:
 *   Session name: `eventpulse`
 *   Window name:  `autonomous`
 *   First pane runs: scripts/autonomous-loop.sh
 *
 * The tmux session is started by scripts/start-mobile-control.sh.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TMUX_SESSION = 'eventpulse';

const DEFAULT_PROJECT_ROOT = '/Volumes/2TB filer/NEWSTRUCTURE-COPY';

function hasTmux(): boolean {
  try {
    execSync('command -v tmux', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function tmuxAvailable(): boolean {
  return hasTmux();
}

export function isTmuxRunning(): boolean {
  if (!hasTmux()) return false;
  try {
    execSync(`tmux has-session -t ${TMUX_SESSION}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The autonomous-loop wrapper logs every status line to `runtime/autonomous-loop/loop.log`
 * via `>> "$LOG_FILE"` redirection rather than printing to the pane — its `echo "..."`
 * lines never reach the pane's stdout, and `claude --print`'s JSON output is redirected
 * to `iter-N.json`. The result is a pane that is empty even while the loop is actively
 * running. To honour the user requirement ("Terminal Live reflects the actual persistent
 * Claude/tmux execution"), we fall back to tailing loop.log when the pane has no usable
 * content. loop.log is the wrapper's durable record of every iter start, exit code,
 * timeout, and stop, so it accurately mirrors the loop's real state. The pane is always
 * preferred when it has content — the fallback only kicks in for an empty/blank pane.
 */
function fallbackLogTail(lines: number): string {
  try {
    const logPath = join(
      process.env.PROJECT_ROOT ?? DEFAULT_PROJECT_ROOT,
      'runtime/autonomous-loop/loop.log'
    );
    if (!existsSync(logPath)) return '';
    const data = readFileSync(logPath, 'utf-8');
    const allLines = data.split('\n');
    return allLines.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export function capturePane(lines = 100): string {
  if (!isTmuxRunning()) {
    return fallbackLogTail(lines);
  }
  try {
    const pane = execSync(
      `tmux capture-pane -t ${TMUX_SESSION} -p -S -${lines}`,
      { encoding: 'utf-8' }
    );
    // Treat a pane with only whitespace as empty and fall back to the durable log.
    if (pane.trim().length === 0) {
      return fallbackLogTail(lines);
    }
    return pane;
  } catch {
    return fallbackLogTail(lines);
  }
}

export function sendKeys(keys: string): boolean {
  if (!isTmuxRunning()) return false;
  try {
    spawn('tmux', ['send-keys', '-t', TMUX_SESSION, keys], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function spawnSession(projectRoot: string): boolean {
  if (!hasTmux()) return false;
  if (isTmuxRunning()) return true;
  if (!existsSync(`${projectRoot}/scripts/autonomous-loop.sh`)) return false;
  try {
    spawn(
      'tmux',
      [
        'new-session',
        '-d',
        '-s',
        TMUX_SESSION,
        '-n',
        'autonomous',
        '-c',
        projectRoot,
        `${projectRoot}/scripts/autonomous-loop.sh`,
      ],
      { detached: true, stdio: 'ignore' }
    );
    return true;
  } catch {
    return false;
  }
}

export function killSession(): boolean {
  if (!isTmuxRunning()) return true;
  try {
    execSync(`tmux kill-session -t ${TMUX_SESSION}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}