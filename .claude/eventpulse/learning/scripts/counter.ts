#!/usr/bin/env node
/**
 * counter.ts — Episode counter med exklusiv lock (Phase L-B + K2 user feedback)
 *
 * Per master-prompt §K2: POSIX-atomic rename ensam räcker inte. Vi wrappar
 * hela read-modify-write i withLock() så att lost updates omöjliggörs.
 *
 * Public API:
 *   - readCounter(repoRoot): CounterState  (read-only, ingen lock)
 *   - updateCounter(repoRoot, mutator, opts): CounterState  (med exklusiv lock)
 *
 * Layout:
 *   .claude/eventpulse/learning/state/counter.json
 *   .claude/eventpulse/learning/state/counter.lock  (transient)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { withLock } from "./file-lock";
import type { CounterState } from "./episode-types";

const DEFAULT_REVIEW_EVERY = 20;

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function counterPath(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "state", "counter.json");
}

function lockPath(repoRoot: string): string {
  return path.join(repoRoot, ".claude", "eventpulse", "learning", "state", "counter.lock");
}

export function seedCounter(repoRoot: string, reviewEvery: number = DEFAULT_REVIEW_EVERY): CounterState {
  const initial: CounterState = {
    all_terminal_episodes: 0,
    review_eligible_episodes: 0,
    since_last_review: 0,
    review_every: reviewEvery,
    last_updated: new Date().toISOString(),
  };
  const p = counterPath(repoRoot);
  ensureDir(path.dirname(p));
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(initial, null, 2), "utf8");
  }
  return initial;
}

export function readCounter(repoRoot: string): CounterState {
  const p = counterPath(repoRoot);
  if (!fs.existsSync(p)) {
    return seedCounter(repoRoot);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as CounterState;
    return {
      all_terminal_episodes: Number(parsed.all_terminal_episodes ?? 0),
      review_eligible_episodes: Number(parsed.review_eligible_episodes ?? 0),
      since_last_review: Number(parsed.since_last_review ?? 0),
      review_every: Number(parsed.review_every ?? DEFAULT_REVIEW_EVERY),
      last_updated: String(parsed.last_updated ?? new Date().toISOString()),
    };
  } catch {
    return seedCounter(repoRoot);
  }
}

/**
 * Run mutator under exclusive lock. mutator receives current state and
 * returns the new state. Throws if mutator returns invalid state.
 */
export async function updateCounter(
  repoRoot: string,
  mutator: (current: CounterState) => CounterState,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<CounterState> {
  const p = counterPath(repoRoot);
  const lk = lockPath(repoRoot);
  ensureDir(path.dirname(p));
  seedCounter(repoRoot); // ensure file exists for mutate to read

  return withLock(
    lk,
    async () => {
      const current = readCounter(repoRoot);
      const next = mutator(current);
      // Sanity: numeric fields must be non-negative integers
      const fields: Array<keyof CounterState> = [
        "all_terminal_episodes",
        "review_eligible_episodes",
        "since_last_review",
        "review_every",
      ];
      for (const f of fields) {
        const v = (next as any)[f];
        if (typeof v !== "number" || v < 0 || !Number.isFinite(v)) {
          throw new Error(`counter field ${String(f)} must be a non-negative finite number, got ${v}`);
        }
      }
      next.last_updated = new Date().toISOString();
      const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
      fs.renameSync(tmp, p);
      return next;
    },
    opts,
  );
}