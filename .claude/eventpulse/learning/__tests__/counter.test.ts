/**
 * counter.test.ts — Phase L-H tester (5 tester)
 *
 * Verifierar att counter:
 *   1. seedar initial state korrekt (alla räknare = 0)
 *   2. inkrementerar since_last_review korrekt
 *   3. återställer since_last_review till 0 efter review
 *   4. förhindrar lost updates vid samtidiga uppdateringar (K2)
 *   5. validerar att mutator returnerar icke-negativa heltal
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const SMOKE = mkdtempSync(join(tmpdir(), "ep-counter-test-"));
const SCRIPTS = join(SMOKE, ".claude", "eventpulse", "learning", "scripts");
const REAL_SCRIPTS = join(process.cwd(), ".claude", "eventpulse", "learning", "scripts");

beforeAll(() => {
  mkdirSync(SCRIPTS, { recursive: true });
  for (const f of ["counter.ts", "file-lock.ts", "episode-types.ts"]) {
    writeFileSync(join(SCRIPTS, f), readFileSync(join(REAL_SCRIPTS, f), "utf8"));
  }
});

beforeEach(() => {
  const counterPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.json");
  if (existsSync(counterPath)) {
    try { execFileSync("rm", [counterPath], { stdio: "ignore" }); } catch { /* ignore */ }
  }
  const lockPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.lock");
  if (existsSync(lockPath)) {
    try { execFileSync("rm", [lockPath], { stdio: "ignore" }); } catch { /* ignore */ }
  }
});

afterAll(() => {
  try { execFileSync("rm", ["-rf", SMOKE], { stdio: "ignore" }); } catch { /* ignore */ }
});

async function loadCounter(): Promise<typeof import("../scripts/counter")> {
  return await import(join(SCRIPTS, "counter.ts"));
}

describe("counter", () => {
  it("1. seedar initial state: alla räknare = 0, review_every = 20", async () => {
    const { seedCounter, readCounter } = await loadCounter();
    const seeded = seedCounter(SMOKE);
    expect(seeded.all_terminal_episodes).toBe(0);
    expect(seeded.review_eligible_episodes).toBe(0);
    expect(seeded.since_last_review).toBe(0);
    expect(seeded.review_every).toBe(20);
    const read = readCounter(SMOKE);
    expect(read.all_terminal_episodes).toBe(0);
  });

  it("2. inkrementerar since_last_review korrekt vid updateCounter", async () => {
    const { seedCounter, updateCounter } = await loadCounter();
    seedCounter(SMOKE);
    const updated = await updateCounter(SMOKE, (c) => ({ ...c, since_last_review: c.since_last_review + 1 }));
    expect(updated.since_last_review).toBe(1);
    const updated2 = await updateCounter(SMOKE, (c) => ({ ...c, since_last_review: c.since_last_review + 1 }));
    expect(updated2.since_last_review).toBe(2);
  });

  it("3. återställer since_last_review till 0 efter review", async () => {
    const { seedCounter, updateCounter, readCounter } = await loadCounter();
    seedCounter(SMOKE);
    // Increment to 5
    for (let i = 0; i < 5; i++) {
      await updateCounter(SMOKE, (c) => ({ ...c, since_last_review: c.since_last_review + 1 }));
    }
    let s = readCounter(SMOKE);
    expect(s.since_last_review).toBe(5);
    // Reset
    await updateCounter(SMOKE, (c) => ({ ...c, since_last_review: 0 }));
    s = readCounter(SMOKE);
    expect(s.since_last_review).toBe(0);
  });

  it("4. förhindrar lost updates vid samtidiga uppdateringar (K2-krav)", async () => {
    const { seedCounter, updateCounter } = await loadCounter();
    seedCounter(SMOKE);
    // Kör 20 parallella uppdateringar — alla ska öka med 1, slutresultat = 20
    const updates = Array.from({ length: 20 }, () =>
      updateCounter(SMOKE, (c) => ({ ...c, since_last_review: c.since_last_review + 1 })),
    );
    await Promise.all(updates);
    const counterPath = join(SMOKE, ".claude", "eventpulse", "learning", "state", "counter.json");
    const final = JSON.parse(readFileSync(counterPath, "utf8"));
    expect(final.since_last_review).toBe(20); // inga lost updates
  });

  it("5. validerar att mutator returnerar icke-negativa heltal", async () => {
    const { seedCounter, updateCounter } = await loadCounter();
    seedCounter(SMOKE);
    await expect(
      updateCounter(SMOKE, (c) => ({ ...c, since_last_review: -1 })),
    ).rejects.toThrow(/non-negative finite number/);
    await expect(
      updateCounter(SMOKE, (c) => ({ ...c, since_last_review: NaN })),
    ).rejects.toThrow(/non-negative finite number/);
    await expect(
      updateCounter(SMOKE, (c) => ({ ...c, since_last_review: Infinity })),
    ).rejects.toThrow(/non-negative finite number/);
  });
});
