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
import { existsSync } from 'node:fs';

export const TMUX_SESSION = 'eventpulse';

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

export function capturePane(lines = 100): string {
  if (!isTmuxRunning()) return '';
  try {
    return execSync(
      `tmux capture-pane -t ${TMUX_SESSION} -p -S -${lines}`,
      { encoding: 'utf-8' }
    );
  } catch {
    return '';
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