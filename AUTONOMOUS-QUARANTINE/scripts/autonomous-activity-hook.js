#!/usr/bin/env node
/**
 * autonomous-activity-hook.js — Claude Code PostToolUse hook.
 *
 * Wired into ~/.claude/settings.json as a PostToolUse hook for all tools.
 * Runs after every tool invocation and:
 *   - If $EP_AUTONOMOUS is unset, exits silently (so interactive sessions
 *     like this one don't pollute the activity stream).
 *   - Otherwise maps the tool call to an activity event type and appends
 *     a structured JSONL line to 09-MobileControl/runtime/activity.jsonl.
 *   - For Agent tool_use / tool_result pairs, maintains
 *     runtime/agents/state.json so the dashboard's NOW section can show
 *     which sub-agents are currently running and what they're doing.
 *
 * Tool mapping (kept minimal to avoid flooding the feed):
 *   Agent           → agent_started / agent_completed
 *   Bash            → lead_action (Bash <first 80 chars of command>)
 *                     + test_started/passed/failed (vitest / jest / npm test)
 *                     + commit_created (git commit)
 *                     + vault_reconciled (scripts/vault-sync-session-end.js)
 *   Edit|Write|MultiEdit → lead_action (<tool> <file path>)
 *   Read|Glob|Grep |TodoWrite|WebFetch|WebSearch → suppressed (too noisy)
 *   others          → suppressed
 *
 * Hook contract (Claude Code):
 *   stdin  = JSON {session_id, transcript_path, cwd, hook_event_name,
 *                   tool_name, tool_input, tool_response, ...}
 *   stdout = free-form (ignored by Claude Code)
 *   exit   = 0 (any non-zero exit is logged but does NOT block the agent)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PROJECT_ROOT =
  process.env.EP_AUTONOMOUS_ROOT ||
  process.env.PROJECT_ROOT ||
  '/Volumes/2TB filer/NEWSTRUCTURE-COPY';
const ACTIVITY_LOG = join(PROJECT_ROOT, '09-MobileControl/runtime/activity.jsonl');
const AGENT_STATE = join(PROJECT_ROOT, 'runtime/agents/state.json');

// Read hook payload from stdin.
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf-8');
}

function now() {
  return new Date().toISOString();
}

function safeAppend(line) {
  const dir = dirname(ACTIVITY_LOG);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* best-effort */
    }
  }
  try {
    appendFileSync(ACTIVITY_LOG, line + '\n');
  } catch (err) {
    process.stderr.write(`[activity-hook] append failed: ${err.message}\n`);
  }
}

function emit(type, detail, meta = {}) {
  safeAppend(
    JSON.stringify({ ts: now(), type, detail, meta: { ...meta } })
  );
}

function readAgentState() {
  try {
    if (!existsSync(AGENT_STATE)) return { agents: [] };
    return JSON.parse(readFileSync(AGENT_STATE, 'utf-8'));
  } catch {
    return { agents: [] };
  }
}

function writeAgentState(state) {
  try {
    const dir = dirname(AGENT_STATE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(AGENT_STATE, JSON.stringify(state, null, 2));
  } catch (err) {
    process.stderr.write(`[activity-hook] state write failed: ${err.message}\n`);
  }
}

function trim(s, n = 160) {
  if (typeof s !== 'string') return '';
  return s.length <= n ? s : s.slice(0, n) + '…';
}

/**
 * Agent-tool bookkeeping: track role + task in runtime/agents/state.json.
 *
 * The PostToolUse payload distinguishes start from finish via
 * tool_response.status: background agents report `async_launched` at spawn
 * time (the agent is still running), while synchronous Agent calls only
 * return once the sub-agent has produced its final result. tool_response
 * .agentId is the stable identity we key state on, so a later completion
 * updates the same entry instead of appending a duplicate.
 */
function handleAgentTool(payload) {
  const { tool_input, tool_response } = payload;
  const role = tool_input?.subagent_type || 'work';
  const task = trim(tool_input?.description || '', 200);
  const agentId = tool_response?.agentId || null;
  const launched = tool_response?.status === 'async_launched';

  const state = readAgentState();
  const stamp = now();

  const idx = state.agents.findIndex((a) => agentId && a.agent_id === agentId);
  if (launched) {
    const entry = {
      agent_id: agentId,
      role,
      task,
      started_at: stamp,
      last_heartbeat: stamp,
      status: 'running',
      completed_at: null,
    };
    if (idx >= 0) state.agents[idx] = entry;
    else state.agents.push(entry);
    emit('agent_started', `${role}: ${task}`, { role, task, agent_id: agentId });
  } else {
    const startedAt = idx >= 0 ? state.agents[idx].started_at : stamp;
    const entry = {
      agent_id: agentId,
      role,
      task,
      started_at: startedAt,
      last_heartbeat: stamp,
      status: 'completed',
      completed_at: stamp,
    };
    if (idx >= 0) state.agents[idx] = entry;
    else state.agents.push(entry);
    const durationSec = Math.max(
      0,
      Math.round((Date.parse(stamp) - Date.parse(startedAt)) / 1000)
    );
    emit('agent_completed', `${role}: ${task}`, {
      role,
      task,
      agent_id: agentId,
      duration_sec: durationSec,
    });
  }

  // Reap entries that have been "running" for over 30 minutes with no update;
  // the spawning session is gone and they will never report completion.
  const staleCutoff = Date.now() - 30 * 60 * 1000;
  for (const a of state.agents) {
    if (a.status === 'running' && Date.parse(a.last_heartbeat) < staleCutoff) {
      a.status = 'completed';
      a.completed_at = stamp;
    }
  }
  writeAgentState(state);
}

/**
 * The Bash tool_response carries {stdout, stderr, interrupted, isImage,
 * noOutputExpected} — there is no exit code. Test pass/fail is therefore
 * derived from the runner's own summary line in the captured output, which
 * is real measured output, not an inferred status.
 */
function testOutcome(output) {
  if (/Tests?\s+.*\b\d+\s+failed/i.test(output) || /\bFAIL\b/.test(output)) {
    return 'failed';
  }
  if (/Tests?\s+.*\b\d+\s+passed/i.test(output)) return 'passed';
  return null;
}

function handleBash(payload) {
  const cmd = String(payload.tool_input?.command || '');
  const first = trim(cmd.split('\n')[0], 160);
  const resp = payload.tool_response ?? {};
  const output = `${resp.stdout ?? ''}\n${resp.stderr ?? ''}`;
  const interrupted = resp.interrupted === true || resp.interrupted === 'true';

  if (/\b(vitest|jest|npm\s+test|npx\s+vitest|npx\s+jest)\b/.test(cmd)) {
    emit('test_started', first, { command: trim(cmd, 400) });
    const outcome = interrupted ? 'failed' : testOutcome(output);
    if (outcome === 'passed') {
      emit('test_passed', trim(output.match(/Tests?\s+[^\n]*/i)?.[0] || first, 160), {
        command: trim(cmd, 400),
      });
    } else if (outcome === 'failed') {
      emit('test_failed', trim(output.match(/Tests?\s+[^\n]*/i)?.[0] || first, 160), {
        command: trim(cmd, 400),
        interrupted,
      });
    }
    return;
  }
  // Require an actual invocation — a `git diff` or `cat` that merely mentions
  // the script path must not be reported as a completed vault sync.
  if (/(?:^|[|&;]\s*)(?:node|npx\s+tsx?)\s+\S*scripts\/vault-sync-session-end\.js/.test(cmd)) {
    emit('vault_reconciled', first, { command: trim(cmd, 400) });
    return;
  }
  if (/^git\s+commit\b/.test(cmd.trim())) {
    const m = cmd.match(/git\s+commit[^|]*-m\s+["']([^"']{0,120})["']/);
    const subject = m ? m[1] : first;
    emit('commit_created', subject, { command: trim(cmd, 400) });
    return;
  }
  if (first.length === 0) return;
  emit('lead_action', `Bash: ${first}`, interrupted ? { interrupted: true } : {});
}

function handleFileEdit(payload) {
  const tool = payload.tool_name;
  const filePath =
    payload.tool_input?.file_path ||
    payload.tool_input?.path ||
    payload.tool_input?.notebook_path ||
    '';
  emit('lead_action', `${tool}: ${filePath}`, { file: filePath, tool });
}

function suppress() {
  /* no-op — keep the hook from flooding the feed */
}

const SUPPRESSED = new Set([
  'Read',
  'Glob',
  'Grep',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'ListMcpResourcesTool',
  'NotebookEdit',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree',
  'ExitWorktree',
  'CronCreate',
  'CronDelete',
  'CronList',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'SendMessage',
  'Skill',
]);

async function main() {
  // Gate: only run when the wrapper has marked this as an autonomous session.
  if (!process.env.EP_AUTONOMOUS) {
    process.exit(0);
  }

  let payload;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw || '{}');
  } catch (err) {
    process.stderr.write(`[activity-hook] bad stdin: ${err.message}\n`);
    process.exit(0);
  }

  const tool = payload.tool_name;
  if (!tool) process.exit(0);

  if (tool === 'Agent') {
    try {
      handleAgentTool(payload);
    } catch (err) {
      process.stderr.write(`[activity-hook] Agent handler: ${err.message}\n`);
    }
  } else if (tool === 'Bash') {
    try {
      handleBash(payload);
    } catch (err) {
      process.stderr.write(`[activity-hook] Bash handler: ${err.message}\n`);
    }
  } else if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    try {
      handleFileEdit(payload);
    } catch (err) {
      process.stderr.write(`[activity-hook] Edit handler: ${err.message}\n`);
    }
  } else if (SUPPRESSED.has(tool)) {
    suppress();
  } else {
    emit('lead_action', `${tool}`, { tool });
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[activity-hook] fatal: ${err.message}\n`);
  process.exit(0); // never block the agent
});
