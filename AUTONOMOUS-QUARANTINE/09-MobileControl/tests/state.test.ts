/**
 * state.test.ts — verify state parser against real Phase 1 data.
 *
 * Runs the parser functions against the actual project files. Catches
 * schema drift: if 23-Active-Task-Queue.md changes shape, this fails.
 */

import { describe, it, expect } from 'vitest';

import {
  readWrapperState,
  readTaskQueue,
  readSnapshot,
  wrapperStatePath,
  wrapperPidPath,
  loopLogPath,
  taskQueuePath,
  activityStreamPath,
  projectRoot,
} from '../state.ts';

const ROOT = projectRoot();

describe('state.ts — paths', () => {
  it('resolves Phase 1 paths relative to project root', () => {
    expect(wrapperStatePath()).toBe(`${ROOT}/runtime/autonomous-loop/state.json`);
    expect(wrapperPidPath()).toBe(`${ROOT}/runtime/autonomous-loop/wrapper.pid`);
    expect(loopLogPath()).toBe(`${ROOT}/runtime/autonomous-loop/loop.log`);
    expect(taskQueuePath()).toBe(`${ROOT}/00-Vault/01-Projects/EventPulse/02-Operations/23-Active-Task-Queue.md`);
    expect(activityStreamPath()).toBe(`${ROOT}/09-MobileControl/runtime/activity.jsonl`);
  });
});

describe('state.ts — readWrapperState', () => {
  it('returns sensible defaults when state file missing', () => {
    const s = readWrapperState();
    expect(s.max_restarts).toBeGreaterThan(0);
    expect(s.max_total_hours).toBeGreaterThan(0);
    expect(['running', 'stopped', 'unknown']).toContain(s.status);
  });

  it('parses real state.json if present', () => {
    const s = readWrapperState();
    if (s.iteration > 0) {
      expect(typeof s.started_at).toBe('string');
    }
  });
});

describe('state.ts — readTaskQueue', () => {
  it('parses real 23-Active-Task-Queue.md', () => {
    const tasks = readTaskQueue();
    expect(Array.isArray(tasks)).toBe(true);
    if (tasks.length > 0) {
      const t = tasks[0];
      expect(t.id).toMatch(/^T\d{4}$/);
      expect(['P0', 'P1', 'P2', 'P3']).toContain(t.priority);
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  // Regression: prior parser had an 8-line window which missed DONE markers
  // at 9-12 lines (T0048, T0050, T0051, T0052) and discarded bullet-line
  // DONE signals. Dashboard showed these as pending even though they were
  // done in vault. Verify the wider window + bullet-line scan catches them.
  it('parses tasks whose *Status:* is beyond line 8', () => {
    const tasks = readTaskQueue();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get('T0048')?.status).toBe('done');
    expect(byId.get('T0050')?.status).toBe('done');
    expect(byId.get('T0052')?.status).toBe('done');
  });

  it('captures DONE 2026 marker on the bullet line itself', () => {
    const tasks = readTaskQueue();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    // T0042 has **DONE 2026-08-21 → ...** on its bullet line.
    expect(byId.get('T0042')?.status).toBe('done');
    // T0054 has **DONE 2026-08-21 → ...** on its bullet line.
    expect(byId.get('T0054')?.status).toBe('done');
  });

  it('parses hyphenated statuses (done-phase4, needs_user_decision)', () => {
    const tasks = readTaskQueue();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get('T0053')?.status).toBe('done-phase4');
    expect(byId.get('T0055')?.status).toBe('needs_user_decision');
  });
});

describe('state.ts — readSnapshot composition', () => {
  it('returns all fields', () => {
    const snap = readSnapshot();
    expect(snap.wrapper).toBeDefined();
    expect(Array.isArray(snap.tasks)).toBe(true);
    expect(Array.isArray(snap.blocked)).toBe(true);
    expect(Array.isArray(snap.recent_commits)).toBe(true);
    expect(Array.isArray(snap.recent_activity)).toBe(true);
    expect(typeof snap.decisions_count).toBe('number');
    expect(typeof snap.discovered_count).toBe('number');
    expect(typeof snap.captured_at).toBe('string');
  });

  it('captured_at is recent ISO timestamp', () => {
    const snap = readSnapshot();
    const ts = Date.parse(snap.captured_at);
    expect(Number.isFinite(ts)).toBe(true);
    expect(Math.abs(Date.now() - ts)).toBeLessThan(5000);
  });
});