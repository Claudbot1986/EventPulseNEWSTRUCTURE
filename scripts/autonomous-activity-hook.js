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
 * For PostToolUse, tool_response is always present; we can't tell from the
 * payload alone whether it's a tool_use start or end. We treat every Agent
 * PostToolUse as "completed" and trim stale running entries on each call.
 */
function handleAgentTool(payload) {
  const { tool_input, tool_response } = payload;
  const role = tool_input?.subagent_type || 'work';
  const description = trim(tool_input?.description || '', 200);
  const taskId = trim(tool_input?.prompt?.split('\n')[0] || description, 120);

  const state = readAgentState();
  const stamp = now();

  // Mark all currently running same-role-and-similar-task entries as completed.
  for (const a of state.agents) {
    if (a.status === 'running' && (a.role === role || Date.now() - new Date(a.last_heartbeat).getTime() > 5 * 60 * 1000)) {
      a.status = 'completed';
      a.completed_at = stamp;
      a.last_heartbeat = stamp;
    }
  }

  // Promote this completion into a fresh entry if we have meaningful data.
  if (description) {
    emit('agent_completed', `${role}: ${description}`, {
      role,
      task: description,
      task_id: taskId,
    });
    // Also emit a synthetic agent_started so the timeline shows a begin/end pair.
    state.agents.push({
      role,
      task: description,
      started_at: stamp,
      last_heartbeat: stamp,
      status: 'completed',
      completed_at: stamp,
    });
  }
  writeAgentState(state);
}

function handleBash(payload) {
  const cmd = String(payload.tool_input?.command || '');
  const first = trim(cmd.split('\n')[0], 160);
  const exitCode = payload.tool_response?.exitCode ?? payload.tool_response?.exit_code ?? null;

  if (/\b(vitest|jest|npm\s+test|npx\s+vitest|npx\s+jest)\b/.test(cmd)) {
    emit('test_started', first, { command: trim(cmd, 400) });
    if (exitCode === 0) {
      emit('test_passed', first, { command: trim(cmd, 400) });
    } else if (exitCode !== null) {
      emit('test_failed', first, { command: trim(cmd, 400), exit_code: exitCode });
    }
    return;
  }
  if (/scripts\/vault-sync-session-end\.js/.test(cmd)) {
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
  emit('lead_action', `Bash: ${first}`, { exit_code: exitCode });
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

  if (process.env.EP_ACTIVITY_DEBUG || existsSync(join(PROJECT_ROOT, 'runtime/agents/.debug-payload'))) {
    try {
      writeFileSync(join(PROJECT_ROOT, `runtime/agents/last-payload-${tool}.json`), JSON.stringify(payload, null, 2));
    } catch {
      /* best-effort */
    }
  }

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
