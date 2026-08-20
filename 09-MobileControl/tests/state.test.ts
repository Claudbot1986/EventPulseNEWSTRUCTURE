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