#!/usr/bin/env node
/**
 * Regression test for Run Controller autonomy bug (2026-10-02).
 *
 * Incident: agent identiferade sig själv som "inte klar" (ROOT_GOAL !=
 * DONE) OCH REQUIRED runnable tasks fanns kvar (5.1→5.2→5.3), men
 * returnerade kontrollen till användaren med frågan "Vad vill du göra
 * nu?". Detta är exakt det beteende Run Controller-systemet ska förhindra.
 *
 * Root cause: ingen autonomy state-fil fanns för description-coverage-
 * uppgiften → scripts/autonomy/runner.mjs hade inga tasks att iterera →
 * systemet kunde inte catcha modellens "Vad vill du göra?"-return.
 *
 * Fix: denna regressionstest verifierar att
 *   1. ROOT_GOAL != DONE
 *   2. REQUIRED runnable tasks finns
 *   3. Next action är satt
 *   4. Status är IN_PROGRESS
 * → return-blocked logic ska gälla (i detta fall: vi vill att modellen
 *   fortsätter med NEXT ACTION istället för att fråga).
 *
 * Detta är ett meta-test modell beteelnationen — verifierar att autonomy-
 * state-filen finns OCH att runner.mjs hittar den som aktiv. Det är INTE
 * ett test av modellens tool-loop-beslut (detta är utanför ramen för vår
 * automation), men det dokumenterar den specifika incidenten och ger en
 * hook för framtida automation att verifiera state-infrastrukturen.
 *
 * Run: node scripts/autonomy/_test-runner-autonomy-bug.mjs
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STATE_DIR = path.join(REPO_ROOT, "runtime", "autonomy");
const STATE_MJS = path.join(__dirname, "state.mjs");
const RUNNER_MJS = path.join(__dirname, "runner.mjs");

let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function readFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) return { fm: {}, body: raw };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fm, body: m[2] };
}

function readSection(body, name) {
  // Splitta på ## headings, hitta de tillåtna section name och returnera innehållet.
  const sections = {};
  let current = null;
  let buf = [];
  for (const line of body.split("\n")) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      if (current !== null) sections[current] = buf.join("\n").trim();
      current = h[1].trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  if (current !== null) sections[current] = buf.join("\n").trim();
  return sections[name] || "";
}

console.log("Regression: Run Controller autonomy bug (2026-10-02)\n");

// ── Check 1: ROOT_GOAL != DONE ─────────────────────────────────────────────
// Verifierar att minst en task i autonomy-state har IN_PROGRESS-status.
// Om alla är DONE har vi inget att testa — den aktiva sessionen är klar.
const allTasks = fs.existsSync(STATE_DIR)
  ? fs.readdirSync(STATE_DIR).filter((f) => f.endsWith(".md"))
  : [];

const inProgressTasks = allTasks
  .map((f) => path.join(STATE_DIR, f))
  .map((fp) => ({ fp, fm: readFrontmatter(fp)?.fm || {} }))
  .filter((t) => (t.fm.status || "IN_PROGRESS").toUpperCase() === "IN_PROGRESS");

assert(
  inProgressTasks.length > 0,
  `ROOT_GOAL != DONE — minst en IN_PROGRESS task finns (${inProgressTasks.length} st)`,
);

if (inProgressTasks.length === 0) {
  console.log("\nAll tasks DONE — regressionstestet är inte applicable just nu.");
  console.log("Skapa en IN_PROGRESS task först via:");
  console.log("  node scripts/autonomy/state.mjs init --id test-task --goal '...' --task-size xs");
  process.exit(failed > 0 ? 1 : 0);
}

// ── Check 2: REQUIRED runnable tasks finns + NEXT ACTION är satt ─────────
// För den första IN_PROGRESS tasken — verifiera att NEXT ACTION inte är
// tom (state.mjs::cmdUpdate skulle ha refuserat annars). Detta är vad
// modellens tool-loop ska titta på för att avgöra om arbete återstår.
const sampleTask = inProgressTasks[0];
const parsed = readFrontmatter(sampleTask.fp);
const body = parsed?.body || "";
const nextAction = readSection(body, "NEXT ACTION");
const isPlaceholder =
  !nextAction ||
  nextAction === "(none yet)" ||
  nextAction === "Define the next concrete action.";

assert(!isPlaceholder, `NEXT ACTION är satt för task ${path.basename(sampleTask.fp, ".md")}`);
assert(
  nextAction.length > 10,
  `NEXT ACTION har >10 tecken (rule 2 i runner — placeholder filtered)`,
);

// ── Check 3: runner.mjs hittar tasken som aktiv ──────────────────────────
// Kör runner.mjs status och verifiera att tasken listas.
let runnerOutput = "";
try {
  runnerOutput = execFileSync("node", [RUNNER_MJS, "status"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  runnerOutput = (err.stdout || "") + (err.stderr || "");
}

const taskId = path.basename(sampleTask.fp, ".md");
assert(
  runnerOutput.includes(taskId),
  `runner.mjs status listar task ${taskId}`,
);

// ── Check 4: state-filen är parsbar av state.mjs::cmdStatus ──────────────
// Kör state.mjs status och verifiera att utdata innehåller "IN_PROGRESS".
let stateOutput = "";
try {
  stateOutput = execFileSync(
    "node",
    [STATE_MJS, "status", "--id", taskId],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (err) {
  stateOutput = (err.stdout || "") + (err.stderr || "");
}

assert(
  /status:\s+IN_PROGRESS/.test(stateOutput),
  `state.mjs::cmdStatus rapporterar IN_PROGRESS för ${taskId}`,
);

// ── Check 5: workflow.mjs::checkSize validerar NEXT ACTION ──────────────
// Om NEXT ACTION är tom/placeholder → checkSize blockerar med exit 2.
// Detta är den sista linjen i SKALDD: agenten kan INTE markera DONE
// utan att ha satt en konkret NEXT ACTION.
let checkExit = 0;
try {
  execFileSync(
    "node",
    [path.join(__dirname, "workflow.mjs"), "check-size", "--id", taskId],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (err) {
  checkExit = err.status || 2;
}

// check-size ska INTE blockera — task är xs/s (eller saknar gates).
// Det vi vill fånga är om NEXT ACTION är tom (exit 2 med "NEXT ACTION is empty").
if (checkExit !== 0) {
  let checkOutput = "";
  try {
    checkOutput = execFileSync(
      "node",
      [path.join(__dirname, "workflow.mjs"), "check-size", "--id", taskId],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    checkOutput = (err.stdout || "") + (err.stderr || "");
  }
  const blocksNextActionEmpty = /NEXT ACTION is empty/.test(checkOutput);
  assert(
    !blocksNextActionEmpty,
    `workflow.mjs::checkSize blockerar INTE pga tom NEXT ACTION för ${taskId}`,
  );
} else {
  console.log(`  ✓ workflow.mjs::checkSize PASS för ${taskId} (size-driven gates uppfyllda)`);
  passed++;
}

// ── Sammanfattning ──────────────────────────────────────────────────────
console.log(`\nRegression summary:`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failed > 0) {
  console.error(
    "\n❌ Run Controller regression misslyckades. Modellen skulle ha fortsatt med NEXT ACTION,",
  );
  console.error(
    "   inte returnerat kontroll till användaren med frågan 'Vad vill du göra?'.",
  );
  process.exit(1);
}

console.log(
  "\n✓ Run Controller regressionstest passerar — autonomy-infrastrukturen",
);
console.log("  är på plats. Om modellen returnerar kontrollen ska den fortsätta");
console.log("  med NEXT ACTION (se autonomy task " + taskId + ").");
process.exit(0);