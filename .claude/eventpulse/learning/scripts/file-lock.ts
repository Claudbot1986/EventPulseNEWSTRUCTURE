#!/usr/bin/env node
/**
 * file-lock.ts — exklusiv fil-baserad låsning (Phase L-A preconditon)
 *
 * Bakgrund:
 *   POSIX-atomic rename är atomic för file-byte, men inte för hela
 *   read-modify-write-transaktionen. Två processer kan båda läsa counter=19
 *   och båda skriva 20 (lost update). Vi behöver en exklusiv lease runt
 *   hela transaktionen.
 *
 * Design:
 *   - Använd `fs.openSync(path, 'wx')` (exclusive create). Första processen
 *     vinner; andra får EEXIST och backar off + retry.
 *   - Stale lock-detect: om PID i lock-filen inte längre lever, ta över
 *     (med grace-period på staleLockMs).
 *   - `withLock<T>(lockPath, fn)` wrappar acquire/release med retry.
 *
 * Begränsningar:
 *   - Fungerar på macOS/Linux. NFS / Windows-nätverksfilsystem kan vara
 *     oförenliga (vi accepterar detta — alla våra writes är lokala).
 *   - Lock-filen får inte innehålla känslig data.
 */

import * as fs from "node:fs";
import * as os from "node:os";

export interface AcquireOpts {
  /** Max antal retries. Default 50. */
  retries?: number;
  /** Millisekunder mellan retries. Default 100. */
  retryDelayMs?: number;
  /** Lock anses som stale efter denna ålder (ms). Default 30s. */
  staleLockMs?: number;
  /** Ägarinfo — vem äger låset (för diagnostics). */
  owner?: string;
}

const DEFAULTS = {
  retries: 50,
  retryDelayMs: 100,
  staleLockMs: 30_000,
};

interface LockContent {
  pid: number;
  owner: string;
  acquired_at: string;
  hostname: string;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function writeLockContent(path: string, owner: string): void {
  const content: LockContent = {
    pid: process.pid,
    owner,
    acquired_at: new Date().toISOString(),
    hostname: os.hostname(),
  };
  fs.writeFileSync(path, JSON.stringify(content), { encoding: "utf8", mode: 0o600 });
}

function readLockContent(path: string): LockContent | null {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8")) as LockContent;
  } catch {
    return null;
  }
}

/**
 * Try to acquire exclusive lock. Returns true on success.
 * Returns false if lock could not be acquired after retries.
 */
export async function acquireLock(
  lockPath: string,
  opts: AcquireOpts = {},
): Promise<boolean> {
  const { retries, retryDelayMs, staleLockMs, owner } = { ...DEFAULTS, ...opts };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // O_EXCL — exclusive create
      const fd = fs.openSync(lockPath, "wx", 0o600);
      // write content + close
      fs.writeSync(fd, JSON.stringify({
        pid: process.pid,
        owner: owner ?? "unknown",
        acquired_at: new Date().toISOString(),
        hostname: os.hostname(),
      }));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        // Lock finns — kolla om stale
        const existing = readLockContent(lockPath);
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > staleLockMs && existing && !isPidAlive(existing.pid)) {
          // Stale — ta över
          try {
            fs.unlinkSync(lockPath);
            continue;
          } catch {
            // someone else took it; retry
          }
        }
        await sleep(retryDelayMs);
        continue;
      }
      throw err;
    }
  }
  return false;
}

/**
 * Release lock (idempotent).
 */
export function releaseLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // Best-effort release
    }
  }
}

/**
 * Convenience wrapper: acquire, run fn, release. Throws if lock cannot be acquired.
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  opts: AcquireOpts = {},
): Promise<T> {
  const acquired = await acquireLock(lockPath, opts);
  if (!acquired) {
    throw new Error(`Failed to acquire lock ${lockPath} after retries`);
  }
  try {
    return await fn();
  } finally {
    releaseLock(lockPath);
  }
}