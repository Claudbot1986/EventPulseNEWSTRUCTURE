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
 *   7–12. vault-regelns fil-allowlist (se VAULT_CASES nedan)
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

// Vault-regelns fil-allowlist (Steg 2, plan 2026-09-04): de tre maskinsynkade
// filerna tillåts UTAN agent_name (Claude Code skickar aldrig agent_name i
// produktion), övriga vault-filer blockeras. bypassRoles-maskineriet testas
// syntetiskt för att dokumentera design-intent om framtida payloads bär namn.
const VAULT_CASES: GateCase[] = [
  {
    name: "vault-allowlist-current-state (ingen agent_name) → ALLOW",
    payload: {
      tool_name: "Edit",
      tool_input: {
        file_path: path.join(
          REPO,
          "00-Vault",
          "01-Projects",
          "EventPulse",
          "00-Core",
          "01-Current-State.md",
        ),
      },
      cwd: REPO,
    },
    expect: "allow",
  },
  {
    name: "vault-allowlist-current-state-proposed (ingen agent_name) → ALLOW",
    payload: {
      tool_name: "Write",
      tool_input: {
        file_path: path.join(
          REPO,
          "00-Vault",
          "01-Projects",
          "EventPulse",
          "00-Core",
          "01-Current-State.proposed.md",
        ),
      },
      cwd: REPO,
    },
    expect: "allow",
  },
  {
    name: "vault-allowlist-task-queue (ingen agent_name) → ALLOW",
    payload: {
      tool_name: "Edit",
      tool_input: {
        file_path: path.join(
          REPO,
          "00-Vault",
          "01-Projects",
          "EventPulse",
          "02-Operations",
          "23-Active-Task-Queue.md",
        ),
      },
      cwd: REPO,
    },
    expect: "allow",
  },
  {
    name: "vault-annan-fil (ingen agent_name) → BLOCK",
    payload: {
      tool_name: "Edit",
      tool_input: {
        file_path: path.join(
          REPO,
          "00-Vault",
          "01-Projects",
          "EventPulse",
          "02-Operations",
          "03-Current-Task.md",
        ),
      },
      cwd: REPO,
    },
    expect: "block",
  },
  {
    name: "vault-annan-fil MED agent_name vault-sync → ALLOW (design-intent)",
    payload: {
      tool_name: "Edit",
      tool_input: {
        file_path: path.join(
          REPO,
          "00-Vault",
          "01-Projects",
          "EventPulse",
          "02-Operations",
          "03-Current-Task.md",
        ),
      },
      agent_name: "vault-sync",
      cwd: REPO,
    },
    expect: "allow",
  },
  {
    name: "policy.md (ingen agent_name) → BLOCK (Tier 0 skyddad)",
    payload: {
      tool_name: "Edit",
      tool_input: { file_path: path.join(REPO, ".claude", "eventpulse", "policy.md") },
      cwd: REPO,
    },
    expect: "block",
  },
];

describe("safety-gate vault rule (fil-allowlist)", () => {
  for (const c of VAULT_CASES) {
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