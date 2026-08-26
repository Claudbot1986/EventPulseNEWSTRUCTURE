#!/usr/bin/env node
/**
 * preferences.ts — Preference pair generation (Phase L-B)
 *
 * Per master-prompt §13: korrektion skapar implicit en preference pair
 * (chosen=after, rejected=before). Append-only preferences.ndjson.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface PreferencePair {
  preference_id: string;
  correction_id: string;
  chosen_ref: string;
  rejected_ref: string;
  at: string;
}

function preferencesPath(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "preferences.ndjson");
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function maybeCreatePreferencePair(
  repoRoot: string,
  correction: { correction_id: string; before_ref: string; after_ref: string; at: string },
): { ok: boolean; written: boolean; error?: string } {
  const p = preferencesPath(repoRoot);
  ensureDir(path.dirname(p));
  const pref: PreferencePair = {
    preference_id: `PREF-${correction.correction_id}`,
    correction_id: correction.correction_id,
    chosen_ref: correction.after_ref,
    rejected_ref: correction.before_ref,
    at: correction.at,
  };
  try {
    fs.appendFileSync(p, JSON.stringify(pref) + "\n", "utf8");
    return { ok: true, written: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, written: false, error: msg };
  }
}