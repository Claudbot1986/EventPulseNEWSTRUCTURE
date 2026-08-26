#!/usr/bin/env node
/**
 * corrections.ts — Manual correction recording (Phase L-B)
 *
 * Append-only corrections.ndjson. Each correction is explicitly recorded
 * by humans or tools. Used to derive preference pairs.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface CorrectionRecord {
  correction_id: string;
  episode_id: string;
  type: "edit" | "rollback" | "redo" | "human_override" | "agent_overrule";
  before_ref: string;
  after_ref: string;
  reason?: string;
  at: string;
}

function correctionsPath(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "corrections.ndjson");
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function recordCorrection(repoRoot: string, record: CorrectionRecord): { ok: boolean; error?: string } {
  const p = correctionsPath(repoRoot);
  ensureDir(path.dirname(p));
  try {
    fs.appendFileSync(p, JSON.stringify(record) + "\n", "utf8");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export function listCorrections(repoRoot: string, episodeId?: string): CorrectionRecord[] {
  const p = correctionsPath(repoRoot);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  const out: CorrectionRecord[] = [];
  for (const line of lines) {
    try {
      const c = JSON.parse(line) as CorrectionRecord;
      if (!episodeId || c.episode_id === episodeId) out.push(c);
    } catch {
      // skip
    }
  }
  return out;
}