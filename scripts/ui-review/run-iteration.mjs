#!/usr/bin/env node
/**
 * EventPulse UI-review — loop-orchestrator: en iteration = render → screenshot → vision review.
 *
 * KEDJA (Claude Code startar ENDAST detta textkommando — ingen bild hanteras någonsin
 * av Claude; se säkerhetsregeln i scripts/ui-review/README.md):
 *   1. säkerställ Expo web (startar `expo start --web --port 8088` om nere)
 *   2. python3 ui-screenshot.py      → PNG + dom-audit.json
 *   3. npx tsx ui-vision-review.ts   → review.json + review.md (GLM-5.3-Flash via Ollama)
 *   4. loop-state.json uppdateras med score + CONTINUE/STOP-rekommendation
 *
 * Loop-kontroll (default max 3 iterationer per session):
 *   STOP om: max iterationer nådda | inga high/critical kvar | försumbar förbättring
 *   (<5 poäng) | regression (≥5 poäng sämre) | vision-reviewern misslyckades.
 *   Manuell STOP (Claude/Claude-beslut): nästa ändring kräver produktbeslut.
 *
 * Användning:
 *   node scripts/ui-review/run-iteration.mjs --view utforska [--max-iterations 3]
 *   node scripts/ui-review/run-iteration.mjs --continue            # fortsätt senaste sessionen
 *   node scripts/ui-review/run-iteration.mjs --session-dir PATH    # explicit session
 *   node scripts/ui-review/run-iteration.mjs --focus "granska tabbaren extra"
 */

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_DIR = __dirname;
const SESSION_ROOT = path.join(REPO_ROOT, 'runtime', 'verify', 'ui-review');
const DEFAULT_URL = 'http://localhost:8088';
const DEFAULT_MAX_ITERATIONS = 3;
const MIN_MEANINGFUL_DELTA = 5;      // poäng — mindre räknas som försumbar förbättring
const REGRESSION_DELTA = 5;          // poäng — lika mycket eller sämre räknas som regression
const FULL_IMAGE_MAX_BYTES = 4 * 1024 * 1024; // full-page PNG skickas bara om den är rimligt liten
const VIEWS = ['utforska', 'hem', 'notiser', 'profil'];

// ---------- Args ----------

function parseArgs(argv) {
  const args = {
    view: 'utforska',
    url: process.env.UI_REVIEW_URL || DEFAULT_URL,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    continue: false,
    sessionDir: null,
    focus: null,
    noExpoStart: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--view' && next) { args.view = next; i++; }
    else if (a === '--url' && next) { args.url = next; i++; }
    else if (a === '--max-iterations' && next) { args.maxIterations = parseInt(next, 10); i++; }
    else if (a === '--continue') { args.continue = true; }
    else if (a === '--session-dir' && next) { args.sessionDir = next; i++; }
    else if (a === '--focus' && next) { args.focus = next; i++; }
    else if (a === '--no-expo-start') { args.noExpoStart = true; }
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(path.join(SCRIPT_DIR, 'README.md'), 'utf8'));
      process.exit(0);
    }
  }
  return args;
}

// ---------- Expo web-hantering ----------

async function isUp(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureExpo(url, { noExpoStart }) {
  if (await isUp(url)) {
    console.log(`[loop] Expo web är uppe på ${url}`);
    return true;
  }
  if (noExpoStart) {
    console.error(`[loop] Expo web är NERE på ${url} och --no-expo-start är satt`);
    return false;
  }
  const port = new URL(url).port || '8088';
  const logPath = path.join(REPO_ROOT, 'runtime', 'verify', 'ui-review', `expo-web-${port}.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');
  console.log(`[loop] startar Expo web (port ${port}, logg: ${logPath})`);
  const child = spawn('npx', ['expo', 'start', '--web', '--port', port, '--non-interactive'], {
    cwd: path.join(REPO_ROOT, '06-UI'),
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  });
  child.unref();
  const deadline = Date.now() + 180_000; // första web-compile kan ta ett par minuter
  while (Date.now() < deadline) {
    if (await isUp(url)) {
      console.log(`[loop] Expo web är nu uppe på ${url}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.error(`[loop] Expo web kom inte upp inom 180s — se ${logPath}`);
  return false;
}

// ---------- Session/loop-state ----------

function newSessionDir() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const dir = path.join(SESSION_ROOT, ts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function latestSessionDir() {
  if (!fs.existsSync(SESSION_ROOT)) return null;
  const dirs = fs.readdirSync(SESSION_ROOT)
    .filter((d) => fs.statSync(path.join(SESSION_ROOT, d)).isDirectory() && /^20\d\d-/.test(d))
    .sort();
  return dirs.length ? path.join(SESSION_ROOT, dirs[dirs.length - 1]) : null;
}

function readLoopState(sessionDir) {
  const statePath = path.join(sessionDir, 'loop-state.json');
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    console.warn(`[loop] kunde inte läsa loop-state.json (${e}); börjar om`);
    return null;
  }
}

function writeLoopState(sessionDir, state) {
  fs.writeFileSync(path.join(sessionDir, 'loop-state.json'), JSON.stringify(state, null, 2));
}

function recommend(state, review, iterationNumber, maxIterations) {
  if (review.critical_issues.length === 0 && review.high_priority.length === 0) {
    return { recommendation: 'STOP', reason: 'inga high/critical-issues återstår' };
  }
  const prev = state?.iterations?.[state.iterations.length - 1]?.score;
  if (typeof prev === 'number') {
    const delta = review.score - prev;
    if (delta <= -REGRESSION_DELTA) {
      return { recommendation: 'STOP', reason: `regression: score ${prev} → ${review.score} (${delta} poäng)` };
    }
    if (delta < MIN_MEANINGFUL_DELTA) {
      return { recommendation: 'STOP', reason: `försumbar förbättring: score ${prev} → ${review.score} (+${delta} poäng < ${MIN_MEANINGFUL_DELTA})` };
    }
  }
  if (iterationNumber >= maxIterations) {
    return { recommendation: 'STOP', reason: `max ${maxIterations} iterationer nådda` };
  }
  return { recommendation: 'CONTINUE', reason: `high/critical kvarstår (${review.critical_issues.length}c/${review.high_priority.length}h) och utrymme för förbättring finns` };
}

// ---------- Kör barnprocesser (textutdata endast) ----------

function runCommand(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', ...opts });
    child.on('error', (e) => resolve({ code: 1, error: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

function readReview(iterDir) {
  const reviewPath = path.join(iterDir, 'review.json');
  if (!fs.existsSync(reviewPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- Main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!VIEWS.includes(args.view)) {
    console.error(`[loop] FEL: okänd vy '${args.view}' (giltiga: ${VIEWS.join(', ')})`);
    process.exit(2);
  }

  const sessionDir = args.sessionDir
    ? path.resolve(args.sessionDir)
    : (args.continue ? (latestSessionDir() || newSessionDir()) : newSessionDir());
  fs.mkdirSync(sessionDir, { recursive: true });

  const state = readLoopState(sessionDir) || {
    session: path.basename(sessionDir),
    view: args.view,
    url: args.url,
    max_iterations: args.maxIterations,
    iterations: [],
  };
  state.view = args.view;
  state.url = args.url;
  state.max_iterations = args.maxIterations;

  const iterationNumber = state.iterations.length + 1;
  if (iterationNumber > args.maxIterations) {
    writeLoopState(sessionDir, state);
    console.error(`[loop] STOP: max ${args.maxIterations} iterationer — vägrar köra iteration ${iterationNumber}.`);
    console.error(`[loop] starta ny session (ta bort --continue) eller höj --max-iterations medvetet.`);
    process.exit(2);
  }

  console.log(`[loop] session=${path.basename(sessionDir)} iteration=${iterationNumber}/${args.maxIterations} vy=${args.view}`);

  if (!(await ensureExpo(args.url, args))) {
    writeLoopState(sessionDir, state);
    process.exit(1);
  }

  const iterDir = path.join(sessionDir, `iter-${iterationNumber}`);
  fs.mkdirSync(iterDir, { recursive: true });

  // Steg 1-2: render + screenshot
  const shotResult = await runCommand('python3', [
    path.join(SCRIPT_DIR, 'ui-screenshot.py'),
    '--view', args.view,
    '--url', args.url,
    '--out-dir', iterDir,
  ]);
  if (shotResult.code !== 0) {
    state.iterations.push({ n: iterationNumber, dir: iterDir, status: 'screenshot_failed', code: shotResult.code, error: shotResult.error || null });
    state.recommendation = 'STOP';
    state.reason = 'screenshot-steget misslyckades — åtgärda innan loop fortsätter';
    writeLoopState(sessionDir, state);
    console.error('[loop] STOP: screenshot-steget misslyckades (se logg ovan; loop-state.json uppdaterad)');
    process.exit(1);
  }

  // Samla ihop PNG:er — primär (top) först, sedan mid; full endast om rimligt liten
  const auditPath = path.join(iterDir, 'dom-audit.json');
  const shots = JSON.parse(fs.readFileSync(auditPath, 'utf8')).screenshots;
  const imageArgs = ['--screenshot', shots.top];
  if (shots.mid && fs.existsSync(shots.mid)) imageArgs.push('--screenshot', shots.mid);
  if (shots.full && fs.existsSync(shots.full) && fs.statSync(shots.full).size <= FULL_IMAGE_MAX_BYTES) {
    imageArgs.push('--screenshot', shots.full);
  } else if (shots.full) {
    console.log(`[loop] hoppar över full-page-bilden (${(fs.statSync(shots.full).size / 1024 / 1024).toFixed(1)} MB > ${FULL_IMAGE_MAX_BYTES / 1024 / 1024} MB)`);
  }

  // Steg 3: isolerad vision-review (GLM-5.3-Flash via Ollama)
  const reviewCmdArgs = [
    path.join(SCRIPT_DIR, 'ui-vision-review.ts'),
    ...imageArgs,
    '--out-dir', iterDir,
    '--view', args.view,
  ];
  if (args.focus) reviewCmdArgs.push('--focus', args.focus);

  const reviewResult = await runCommand('npx', ['tsx', ...reviewCmdArgs]);
  const review = readReview(iterDir);

  if (reviewResult.code !== 0 || !review) {
    state.iterations.push({ n: iterationNumber, dir: iterDir, status: 'vision_error', code: reviewResult.code });
    state.recommendation = 'STOP';
    state.reason = 'vision-reviewern misslyckades — fel loggat i review-error.json; huvudsessionen fortsätter';
    writeLoopState(sessionDir, state);
    console.error('[loop] STOP: vision-reviewern misslyckades (review-error.json finns; inget kraschade)');
    process.exit(1);
  }

  // Steg 4: utvärdera iteration + rekommendation
  const { recommendation, reason } = recommend(state, review, iterationNumber, args.maxIterations);
  state.iterations.push({
    n: iterationNumber,
    dir: iterDir,
    status: 'ok',
    score: review.score,
    critical: review.critical_issues.length,
    high: review.high_priority.length,
    medium: review.medium_priority.length,
    low: review.low_priority.length,
  });
  state.recommendation = recommendation;
  state.reason = reason;
  writeLoopState(sessionDir, state);

  const prev = state.iterations[state.iterations.length - 2];
  console.log('');
  console.log(`[loop] === ITERATION ${iterationNumber} KLAR ===`);
  console.log(`[loop] score: ${review.score}/100${prev ? ` (föregående: ${prev.score})` : ''}`);
  console.log(`[loop] issues: ${review.critical_issues.length} critical / ${review.high_priority.length} high / ${review.medium_priority.length} medium / ${review.low_priority.length} low`);
  console.log(`[loop] läs textresultat: ${path.join(iterDir, 'review.md')}`);
  console.log(`[loop] loop-state: ${path.join(sessionDir, 'loop-state.json')}`);
  console.log(`[loop] rekommendation: ${recommendation} — ${reason}`);
  if (recommendation === 'CONTINUE') {
    console.log('[loop] nästa steg: implementera high/critical-fixar från review.md, kör sedan: node scripts/ui-review/run-iteration.mjs --continue');
  }
}

main().catch((e) => {
  console.error(`[loop] OFÖRVÄNTAT FEL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});