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
 * Notera: Claude Code-payloads saknar agent_name (verifierat 2026-09-04),
 * men subagent-anrop BÄR agent_id + agent_type (verifierat 2026-09-20
 * mot live-payloads). Äldre testfall syntetiserar agent_name; se blocket
 * "real payload shape" för den aktuella formen. transcript_path pekar på
 * HUVUDsessionens transcript även för subagent-anrop.
 *
 * T0094: den tidigare versionen var ett skript med hårdkodad REPO-sökväg
 * till en gammal projektkopia (/Users/claudgashi/EventPulse-recovery/…)
 * och process.exit som dödade vitest-workern vid import.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
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

// ---------------------------------------------------------------------------
// Role resolution via transcript_path → subagent meta.json (2026-09-20).
//
// Claude Codes riktiga PreToolUse-payload saknar agent_name, men BÄR
// transcript_path. För verktygsanrop inne i en subagent pekar den på
//   ~/.claude/projects/<proj>/<session>/subagents/agent-<agentId>.jsonl
// vars sibling agent-<agentId>.meta.json innehåller {"agentType": "<role>"}.
// Hooken löser rollen därifrån. Fail-closed: kan rollen inte lösas stannar
// den undefined och reglerna blockerar precis som förut.
// ---------------------------------------------------------------------------

const VAULT_FILE = path.join(
  REPO,
  "00-Vault",
  "01-Projects",
  "EventPulse",
  "02-Operations",
  "03-Current-Task.md",
);

/** Bygg en fejkad subagent-transcript: subagents/agent-<id>.jsonl + .meta.json */
function makeSubagentTranscript(root: string, agentId: string, agentType?: string): string {
  const dir = path.join(root, "session-1", "subagents");
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, `agent-${agentId}.jsonl`);
  fs.writeFileSync(transcript, "{}\n");
  if (agentType !== undefined) {
    fs.writeFileSync(
      path.join(dir, `agent-${agentId}.meta.json`),
      JSON.stringify({ agentType }),
    );
  }
  return transcript;
}

function roleCase(
  name: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  transcriptPath: string,
  expect: "block" | "allow",
): GateCase {
  return {
    name,
    payload: { tool_name: toolName, tool_input: toolInput, transcript_path: transcriptPath, cwd: REPO },
    expect,
  };
}

describe("safety-gate role resolution (transcript_path → meta.json)", () => {
  let tmpRoot = "";

  const setup = () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ep-gate-test-"));
  };
  const teardown = () => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = "";
  };

  describe("vault-regel", () => {
    it("vault-sync via meta.json → ALLOW", () => {
      setup();
      try {
        const tp = makeSubagentTranscript(tmpRoot, "v1", "vault-sync");
        const r = spawnSync(TSX, [HOOK], {
          input: JSON.stringify(
            roleCase("", "Edit", { file_path: VAULT_FILE }, tp, "allow").payload,
          ),
          encoding: "utf8",
          cwd: REPO,
        });
        expect(r.status ?? -1).toBe(0);
      } finally {
        teardown();
      }
    });

    it("annan roll (ep-qa) via meta.json → BLOCK", () => {
      setup();
      try {
        const tp = makeSubagentTranscript(tmpRoot, "q1", "ep-qa");
        const r = spawnSync(TSX, [HOOK], {
          input: JSON.stringify(
            roleCase("", "Edit", { file_path: VAULT_FILE }, tp, "block").payload,
          ),
          encoding: "utf8",
          cwd: REPO,
        });
        expect(r.status ?? -1).toBe(2);
      } finally {
        teardown();
      }
    });

    it("meta.json saknas → fail-closed BLOCK", () => {
      setup();
      try {
        const tp = makeSubagentTranscript(tmpRoot, "nometa", undefined);
        const r = spawnSync(TSX, [HOOK], {
          input: JSON.stringify(
            roleCase("", "Edit", { file_path: VAULT_FILE }, tp, "block").payload,
          ),
          encoding: "utf8",
          cwd: REPO,
        });
        expect(r.status ?? -1).toBe(2);
      } finally {
        teardown();
      }
    });

    it("transcript_path utanför subagents/ (huvudsession) → BLOCK", () => {
      setup();
      try {
        const mainTranscript = path.join(tmpRoot, "session-1", "main.jsonl");
        fs.mkdirSync(path.dirname(mainTranscript), { recursive: true });
        fs.writeFileSync(mainTranscript, "{}\n");
        const r = spawnSync(TSX, [HOOK], {
          input: JSON.stringify(
            roleCase("", "Edit", { file_path: VAULT_FILE }, mainTranscript, "block").payload,
          ),
          encoding: "utf8",
          cwd: REPO,
        });
        expect(r.status ?? -1).toBe(2);
      } finally {
        teardown();
      }
    });
  });

  describe("bash-blocklist", () => {
    it("lead via meta.json + force-push → ALLOW", () => {
      setup();
      try {
        const tp = makeSubagentTranscript(tmpRoot, "l1", "lead");
        const r = spawnSync(TSX, [HOOK], {
          input: JSON.stringify(
            roleCase("", "Bash", { command: "git push --force origin main" }, tp, "allow").payload,
          ),
          encoding: "utf8",
          cwd: REPO,
        });
        expect(r.status ?? -1).toBe(0);
      } finally {
        teardown();
      }
    });

    it("non-lead via meta.json + force-push → BLOCK", () => {
      setup();
      try {
        const tp = makeSubagentTranscript(tmpRoot, "w1", "ep-qa");
        const r = spawnSync(TSX, [HOOK], {
          input: JSON.stringify(
            roleCase("", "Bash", { command: "git push --force origin main" }, tp, "block").payload,
          ),
          encoding: "utf8",
          cwd: REPO,
        });
        expect(r.status ?? -1).toBe(2);
      } finally {
        teardown();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Real payload shape (verifierad mot live-payloads 2026-09-20): subagent-anrop
// bär agent_id + agent_type; transcript_path pekar på HUVUDtranskriptet.
// Huvudsessionens egna anrop saknar båda fälten.
// ---------------------------------------------------------------------------
const MAIN_TRANSCRIPT = "/Users/claudgashi/.claude/projects/-proj/session-1.jsonl";

const REAL_SHAPE_CASES: GateCase[] = [
  {
    name: "subagent vault-sync (agent_type) + vault-fil → ALLOW",
    payload: {
      tool_name: "Edit",
      tool_input: { file_path: VAULT_FILE },
      agent_id: "a05d61430f0ab7536",
      agent_type: "vault-sync",
      transcript_path: MAIN_TRANSCRIPT,
      cwd: REPO,
    },
    expect: "allow",
  },
  {
    name: "subagent general-purpose (agent_type) + vault-fil → BLOCK",
    payload: {
      tool_name: "Edit",
      tool_input: { file_path: VAULT_FILE },
      agent_id: "af549798ad46e64f2",
      agent_type: "general-purpose",
      transcript_path: MAIN_TRANSCRIPT,
      cwd: REPO,
    },
    expect: "block",
  },
  {
    name: "huvudsession (utan agent-fält) + vault-fil → BLOCK",
    payload: {
      tool_name: "Edit",
      tool_input: { file_path: VAULT_FILE },
      transcript_path: MAIN_TRANSCRIPT,
      cwd: REPO,
    },
    expect: "block",
  },
  {
    name: "subagent lead (agent_type) + force-push → ALLOW",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "git push --force origin main" },
      agent_id: "l123",
      agent_type: "lead",
      transcript_path: MAIN_TRANSCRIPT,
      cwd: REPO,
    },
    expect: "allow",
  },
  {
    name: "huvudsession (utan agent-fält) + force-push → BLOCK",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "git push --force origin main" },
      transcript_path: MAIN_TRANSCRIPT,
      cwd: REPO,
    },
    expect: "block",
  },
];

describe("safety-gate role resolution (real payload shape: agent_type)", () => {
  for (const c of REAL_SHAPE_CASES) {
    it(c.name, () => {
      const r = spawnSync(TSX, [HOOK], {
        input: JSON.stringify(c.payload),
        encoding: "utf8",
        cwd: REPO,
      });
      expect(r.status ?? -1).toBe(c.expect === "block" ? 2 : 0);
    });
  }
});