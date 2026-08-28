#!/usr/bin/env node
/**
 * mission-resolver.ts — explicit session/mission binding (Phase L-A fix)
 *
 * Background:
 *   Previous modules used "newest mtime YAML" as the implicit mission
 *   resolver. Under concurrency (two Claude sessions running in parallel)
 *   this is unsafe: telemetry and outcome events would be attributed to the
 *   wrong mission, polluting future training data.
 *
 * Design:
 *   - Every Mission YAML stores `session_id` (added by mission-compiler).
 *   - Each hook payload includes `session_id` from Claude Code.
 *   - This resolver matches by session_id ONLY — never by mtime.
 *   - If no match → null (caller logs warning, never falls back to newest mtime).
 *   - Optional allowlist: a session may have exactly one ACTIVE mission; the
 *     resolver returns the most recently CREATED one for that session.
 *
 * Public API:
 *   - findMissionBySession(repoRoot, sessionId): MissionRef | null
 *   - readMissionYaml(repoRoot, missionId): string | null
 *   - parseMissionSessionId(yamlText): string | null
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface MissionRef {
  mission_id: string;
  session_id: string;
  file: string;
  text: string;
  created_at: string | null;
  verification_profile: string | null;
  required_gates: string[];
  status: "active" | "legacy";
}

const MISSION_FIELDS_RE = {
  session_id: /^\s*session_id\s*:\s*(.+?)\s*$/m,
  created_at: /^\s*created_at\s*:\s*(.+?)\s*$/m,
  verification_profile: /^\s*verification_profile\s*:\s*(.+?)\s*$/m,
};

function parseField(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

export function parseMissionSessionId(yamlText: string): string | null {
  return parseField(yamlText, MISSION_FIELDS_RE.session_id);
}

export function parseMissionCreatedAt(yamlText: string): string | null {
  return parseField(yamlText, MISSION_FIELDS_RE.created_at);
}

export function parseMissionVerificationProfile(yamlText: string): string | null {
  return parseField(yamlText, MISSION_FIELDS_RE.verification_profile);
}

export function parseMissionRequiredGates(yamlText: string): string[] {
  const blockRe = /required_gates\s*:\s*\n((?:\s*-\s*[^\n]+\n?)+)/m;
  const m = blockRe.exec(yamlText);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Find the mission YAML whose stored session_id matches the provided sessionId.
 *
 * Returns the most recently created mission if multiple match (defensive).
 * Returns null when no match — caller MUST NOT silently fall back to
 * "newest mtime" (which is the concurrency bug we are fixing).
 */
export function findMissionBySession(
  repoRoot: string,
  sessionId: string | null | undefined,
): MissionRef | null {
  if (!sessionId || sessionId === "unknown" || sessionId === "anon") {
    return null;
  }
  const dir = path.join(repoRoot, ".claude", "eventpulse", "missions");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"));
  const matches: MissionRef[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    let text: string;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const stored = parseMissionSessionId(text);
    if (stored === sessionId) {
      matches.push({
        mission_id: f.replace(/\.yaml$/, ""),
        session_id: stored,
        file: full,
        text,
        created_at: parseMissionCreatedAt(text),
        verification_profile: parseMissionVerificationProfile(text),
        required_gates: parseMissionRequiredGates(text),
        status: "active",
      });
    }
  }
  if (matches.length === 0) return null;
  // Sort by created_at desc; fall back to file mtime
  matches.sort((a, b) => {
    if (a.created_at && b.created_at) {
      return b.created_at.localeCompare(a.created_at);
    }
    let am = 0, bm = 0;
    try { am = fs.statSync(a.file).mtimeMs; } catch { /* */ }
    try { bm = fs.statSync(b.file).mtimeMs; } catch { /* */ }
    return bm - am;
  });
  return matches[0];
}

/**
 * Read a mission YAML by exact id (used by mission-validator, finalize-episode).
 */
export function readMissionYaml(repoRoot: string, missionId: string): string | null {
  const p = path.join(repoRoot, ".claude", "eventpulse", "missions", `${missionId}.yaml`);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}