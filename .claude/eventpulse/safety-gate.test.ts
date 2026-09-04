/**
 * safety-gate.test.ts — regressionstest för PreToolUse-safety-gaten.
 *
 * Kör safety-gate.ts som barnprocess med syntetiska stdin-payloadar:
 *   1. rm -rf node_modules   non-lead  → BLOCK
 *   2. force-push             non-lead  → BLOCK
 *   3. force-push             lead      → ALLOW
 *   4. npm test               non-lead  → ALLOW
 *   5. Edit MASTERPLAN.md     non-lead  → BLOCK
 *   6. Edit normalizer.ts     non-lead  → ALLOW
 *
 * Notera: Claude Codes riktiga PreToolUse-payload saknar agent_name —
 * därför kan roll-bypassen aldrig trigga i produktion (empiriskt
 * verifierat; vault-regeln har därför en fil-allowlist, se Steg 2 i
 * planen 2026-09-04). Testfallen syntetiserar agent_name för att ändå
 * testa regel-logiken inklusive bypass-design-intent.
 *
 * T0094: den tidigare versionen var ett skript med hårdkodad REPO-sökväg
 * till en gammal projektkopia (/Users/claudgashi/EventPulse-recovery/…)
 * och process.exit som dödade vitest-workern vid import.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..", "..");
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const HOOK = path.join(REPO, ".claude", "eventpulse", "safety-gate.ts");

interface GateCase {
  name: string;
  payload: Record<string, unknown>;
  expect: "block" | "allow";
}

const CASES: GateCase[] = [
  {
    name: "non-lead-rm-rf → BLOCK",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "rm -rf node_modules" },
      agent_name: "ep-ingestion-engineer",
      cwd: REPO,
    },
    expect: "block",
  },
  {
    name: "non-lead-force-push → BLOCK",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "git push --force origin main" },
      agent_name: "ep-qa",
      cwd: REPO,
    },
    expect: "block",
  },
  {
    name: "lead-force-push → ALLOW",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "git push --force origin main" },
      agent_name: "ep-lead",
      cwd: REPO,
    },
    expect: "allow",
  },
  {
    name: "non-lead-npm-test → ALLOW",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      agent_name: "ep-expo-engineer",
      cwd: REPO,
    },
    expect: "allow",
  },
  {
    name: "non-lead-edit-MASTERPLAN → BLOCK",
    payload: {
      tool_name: "Edit",
      tool_input: { file_path: path.join(REPO, "docs", "MASTERPLAN.md") },
      agent_name: "ep-qa",
      cwd: REPO,
    },
    expect: "block",
  },
  {
    name: "non-lead-edit-normalizer → ALLOW",
    payload: {
      tool_name: "Edit",
      tool_input: { file_path: path.join(REPO, "04-Normalizer", "normalizer.ts") },
      agent_name: "ep-event-graph-engineer",
      cwd: REPO,
    },
    expect: "allow",
  },
];

describe("safety-gate pattern rules", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const r = spawnSync(TSX, [HOOK], {
        input: JSON.stringify(c.payload),
        encoding: "utf8",
        cwd: REPO,
      });
      const exitCode = r.status ?? -1;
      expect(exitCode).toBe(c.expect === "block" ? 2 : 0);
    });
  }
});