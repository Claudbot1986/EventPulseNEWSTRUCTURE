/**
 * ingestion-watchdog.ts — detecterar hängande chain inom rimlig tid.
 *
 * Bakgrund (2026-10-07): launchd-zombie-pattern — en child-process (t.ex.
 * runB.ts) hängde i 50h, men bash-wrappern (PID 65997) höll stdout-röret
 * öppet så launchd såg "allt OK" och startade aldrig om nästa planerade körning.
 *
 * launchd chain skriver nu (sedan 2026-10-07) en JSONL-rad per step-start
 * OCH step-end till runtime/ingestion-cron/chain-overview.log. Den här
 * watchdog:
 *   1. Läser chain-overview.log och hittar senaste step-start + step-end.
 *   2. Om chain-processen lever (PID i status.json finns i ps) men inget
 *      step-end på X minuter för pågående step → HÄNGER.
 *   3. Om chain-processen är död (PID i ps finns inte) men launchd tror
 *      att den kör → ZOMBIE.
 *   4. Om chain-overview.log inte uppdaterats på Y minuter och status.json
 *      visar running=true → ZOMBIE.
 *
 * Default-trösklar (kan overridas via env):
 *   WATCHDOG_STEP_HUNG_MS    = 30 min — step-start utan step-end
 *   WATCHDOG_OVERVIEW_STALE_MS = 30 min — filen inte ändrad
 *   WATCHDOG_CHAIN_ALIVE_MS  = 6 h    — kedjan får inte köra längre än så
 *
 * Output:
 *   - runtime/ingestion-cron/watchdog.log (append-only human-readable)
 *   - runtime/ingestion-cron/watchdog.json (senaste status, för dashboard)
 *   - exit 0 (alltid) — vi vill INTE att launchd ska slå av watchdog
 *     för att den rapporterade problem.
 *
 * Körs var 5:e minut av launchd com.eventpulse.ingestion-watchdog.plist.
 */

import { readFileSync, writeFileSync, existsSync, statSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const OVERVIEW_LOG = path.resolve(PROJECT_ROOT, 'runtime/ingestion-cron/chain-overview.log');
const STATUS_FILE = path.resolve(PROJECT_ROOT, 'runtime/ingestion-cron.status.json');
const WATCHDOG_LOG = path.resolve(PROJECT_ROOT, 'runtime/ingestion-cron/watchdog.log');
const WATCHDOG_STATE = path.resolve(PROJECT_ROOT, 'runtime/ingestion-cron/watchdog.json');

const STEP_HUNG_MS = parseInt(process.env.WATCHDOG_STEP_HUNG_MS ?? String(30 * 60_000), 10);
const OVERVIEW_STALE_MS = parseInt(process.env.WATCHDOG_OVERVIEW_STALE_MS ?? String(30 * 60_000), 10);
const CHAIN_ALIVE_MS = parseInt(process.env.WATCHDOG_CHAIN_ALIVE_MS ?? String(6 * 60 * 60_000), 10);

interface OverviewRow {
  ts: string;
  event: 'step-start' | 'step-end' | 'heartbeat';
  step: string;
  exitCode?: number;
  durationMs?: number;
  pid?: number;
  cmd?: string;
  childPid?: number;
}

interface WatchdogState {
  checkedAt: string;
  ok: boolean;
  reasons: string[];
  lastStepStart?: { step: string; ts: string; ageMs: number };
  lastStepEnd?: { step: string; ts: string; ageMs: number };
  lastHeartbeat?: { step: string; ts: string; ageMs: number };
  chainPidAlive: boolean;
  chainPid?: number;
  overviewFileMtime?: number;
}

function readOverviewTail(maxRows = 200): OverviewRow[] {
  if (!existsSync(OVERVIEW_LOG)) return [];
  const text = readFileSync(OVERVIEW_LOG, 'utf8');
  const lines = text.trim().split('\n').filter(Boolean).slice(-maxRows);
  const rows: OverviewRow[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line) as OverviewRow);
    } catch {
      // skip malformed
    }
  }
  return rows;
}

interface ExtractedEvents {
  lastStepStart?: WatchdogState['lastStepStart'];
  lastStepEnd?: WatchdogState['lastStepEnd'];
  lastHeartbeat?: WatchdogState['lastHeartbeat'];
}

function extractLatestEvents(rows: OverviewRow[]): ExtractedEvents {
  const out: ExtractedEvents = {};
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!out.lastStepStart && r.event === 'step-start') {
      out.lastStepStart = { step: r.step, ts: r.ts, ageMs: nowMs() - new Date(r.ts).getTime() };
    }
    if (!out.lastStepEnd && r.event === 'step-end') {
      out.lastStepEnd = { step: r.step, ts: r.ts, ageMs: nowMs() - new Date(r.ts).getTime() };
    }
    if (!out.lastHeartbeat && r.event === 'heartbeat') {
      out.lastHeartbeat = { step: r.step, ts: r.ts, ageMs: nowMs() - new Date(r.ts).getTime() };
    }
    if (out.lastStepStart && out.lastStepEnd && out.lastHeartbeat) break;
  }
  return out;
}

function readStatus(): { running: boolean; pid: number | null; startedAt: string | null } | null {
  if (!existsSync(STATUS_FILE)) return null;
  try {
    const j = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
    return { running: !!j.running, pid: j.pid ?? null, startedAt: j.startedAt ?? null };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function nowMs() { return Date.now(); }

function check(): WatchdogState {
  const reasons: string[] = [];
  const rows = readOverviewTail();
  const status = readStatus();
  const { lastStepStart, lastStepEnd, lastHeartbeat } = extractLatestEvents(rows);

  const chainPid = status?.pid ?? undefined;
  const chainPidAlive = chainPid != null ? pidAlive(chainPid) : false;

  // overview file mtime
  let overviewFileMtime: number | undefined;
  if (existsSync(OVERVIEW_LOG)) {
    overviewFileMtime = statSync(OVERVIEW_LOG).mtimeMs;
  }

  // Rule 1: chain still "running" in status.json but no overview update in OVERVIEW_STALE_MS
  if (status?.running && overviewFileMtime !== undefined) {
    const age = nowMs() - overviewFileMtime;
    if (age > OVERVIEW_STALE_MS) {
      reasons.push(`chain-overview stale ${Math.round(age / 60_000)}min (> ${OVERVIEW_STALE_MS / 60_000}min) — chain may be stuck or overview-logger crashed`);
    }
  }

  // Rule 2: step-start without matching step-end (i.e. the last step is hung)
  if (lastStepStart && (!lastStepEnd || new Date(lastStepStart.ts).getTime() > new Date(lastStepEnd.ts).getTime())) {
    // Använd heartbeat om det finns nyare än step-start — då lever steget.
    const usingHeartbeat = lastHeartbeat && new Date(lastHeartbeat.ts).getTime() > new Date(lastStepStart.ts).getTime();
    const age = usingHeartbeat ? lastHeartbeat.ageMs : lastStepStart.ageMs;
    const signal = usingHeartbeat ? `heartbeat for "${lastStepStart.step}"` : `step-start "${lastStepStart.step}"`;
    if (age > STEP_HUNG_MS) {
      reasons.push(`${signal} ${Math.round(age / 60_000)}min ago without step-end (> ${STEP_HUNG_MS / 60_000}min) — hung`);
    }
  }

  // Rule 3: chain PID alive but status.json says running=false for > CHAIN_ALIVE_MS
  if (status?.startedAt) {
    const ageMs = nowMs() - new Date(status.startedAt).getTime();
    if (status.running && ageMs > CHAIN_ALIVE_MS) {
      reasons.push(`chain running for ${Math.round(ageMs / 60_000)}min (> ${CHAIN_ALIVE_MS / 60_000}min) — exceeds max wall-clock budget`);
    }
  }

  // Rule 4: chain process dead but launchd thinks it's running (zombie — the original bug)
  if (status?.running && chainPid != null && !chainPidAlive) {
    reasons.push(`chain process pid=${chainPid} is dead but status.running=true — ZOMBIE (launchd won't restart)`);
  }

  return {
    checkedAt: new Date().toISOString(),
    ok: reasons.length === 0,
    reasons,
    lastStepStart,
    lastStepEnd,
    lastHeartbeat,
    chainPidAlive,
    chainPid,
    overviewFileMtime,
  };
}

function appendWatchdogLog(state: WatchdogState): void {
  const line = `[${state.checkedAt}] ${state.ok ? 'OK' : 'ALERT'} ${state.reasons.join(' | ') || '(no issues)'}\n`;
  try {
    appendFileSync(WATCHDOG_LOG, line, 'utf8');
  } catch (err) {
    console.error('failed to write watchdog log:', err);
  }
}

function main(): void {
  const state = check();
  writeFileSync(WATCHDOG_STATE, JSON.stringify(state, null, 2), 'utf8');
  appendWatchdogLog(state);

  // Always exit 0 — watchdog reporting is decoupled from watchdog health.
  // (If watchdog itself crashes, launchd will mark it as failed, which is
  // a separate signal.)
  if (!state.ok) {
    console.log(`[watchdog] ALERT ${state.reasons.length} issue(s):`);
    for (const r of state.reasons) console.log(`  - ${r}`);
  } else {
    console.log(`[watchdog] OK — last step-end ${state.lastStepEnd?.step ?? '(none)'} ${state.lastStepEnd ? `${Math.round(state.lastStepEnd.ageMs / 60_000)}min ago` : ''}`);
  }
  process.exit(0);
}

main();