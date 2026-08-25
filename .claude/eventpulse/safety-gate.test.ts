/**
 * safety-gate.test.ts — Phase 4 verification (transient; can be deleted after run).
 *
 * Runs safety-gate.ts as a child process with synthetic stdin payloads covering:
 *   1. PATTERN_RM_RF                  non-lead  → BLOCK
 *   2. PATTERN_FORCE_PUSH             non-lead  → BLOCK
 *   3. PATTERN_FORCE_PUSH             lead      → ALLOW
 *   4. npm test                       non-lead  → ALLOW
 *   5. Edit MASTERPLAN.md             non-lead  → BLOCK
 *   6. Edit normalizer.ts             non-lead  → ALLOW
 */

import { spawnSync } from "child_process";

const REPO = "/Users/claudgashi/EventPulse-recovery/clawdbot2/project/00EVENTPULSEFINALDESTINATION/NEWSTRUCTURE";

const cases = [
  {
    name: "non-lead-rm-rf",
    payload: { tool_name: "Bash", tool_input: { command: ["rm", "-rf", "node_modules"].join(" ") }, agent_name: "ep-ingestion-engineer", cwd: REPO },
    expect: "block",
  },
  {
    name: "non-lead-force-push",
    payload: { tool_name: "Bash", tool_input: { command: ["git", "push", "--force", "origin", "main"].join(" ") }, agent_name: "ep-qa", cwd: REPO },
    expect: "block",
  },
  {
    name: "lead-force-push",
    payload: { tool_name: "Bash", tool_input: { command: ["git", "push", "--force", "origin", "main"].join(" ") }, agent_name: "ep-lead", cwd: REPO },
    expect: "allow",
  },
  {
    name: "non-lead-npm-test",
    payload: { tool_name: "Bash", tool_input: { command: "npm test" }, agent_name: "ep-expo-engineer", cwd: REPO },
    expect: "allow",
  },
  {
    name: "non-lead-edit-MASTERPLAN",
    payload: { tool_name: "Edit", tool_input: { file_path: `${REPO}/docs/MASTERPLAN.md` }, agent_name: "ep-qa", cwd: REPO },
    expect: "block",
  },
  {
    name: "non-lead-edit-normalizer",
    payload: { tool_name: "Edit", tool_input: { file_path: `${REPO}/04-Normalizer/normalizer.ts` }, agent_name: "ep-event-graph-engineer", cwd: REPO },
    expect: "allow",
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const r = spawnSync("npx", ["tsx", `${REPO}/.claude/eventpulse/safety-gate.ts`], {
    input: JSON.stringify(c.payload),
    encoding: "utf8",
    cwd: REPO,
  });
  const exitCode = r.status ?? -1;
  const stdout = (r.stdout || "").trim();
  const wantsBlock = c.expect === "block";
  const isBlock = exitCode === 2;
  const ok = wantsBlock ? isBlock : exitCode === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name} expect=${c.expect} exit=${exitCode} stdout=${stdout.slice(0, 120)}`);
  ok ? pass++ : fail++;
}
console.log(`\nresult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
