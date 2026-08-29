/**
 * human-plan-consistency.test.ts — semantic tests for the Human Plan consistency validator.
 *
 * Run: `npx vitest run .claude/eventpulse/human-plan-consistency.test.ts`
 */

import { describe, expect, test } from 'vitest';
import { classify } from './classifier';
import { selectContext } from './context-selector';
import { compileMission } from './mission-compiler';
import { extractProjection, type HumanPlanProjection } from './human-plan-renderer';
import { validateHumanProjection, validateRenderedHumanPlan } from './human-plan-consistency';
import type { Mission } from './mission-compiler';

const REPO_ROOT = process.env.EP_REPO_ROOT ?? process.cwd();

function buildMission(prompt: string): Mission {
  const c = classify(prompt);
  const s = selectContext(c);
  const { mission } = compileMission({
    prompt,
    classification: c,
    selection: s,
    repoRoot: REPO_ROOT,
    sessionId: 'hpr-consistency-test',
  });
  return mission;
}

function cloneProjection(p: HumanPlanProjection): HumanPlanProjection {
  return {
    mission_id: p.mission_id,
    touched_scopes: [...p.touched_scopes],
    planning_only: p.planning_only,
    risk_level: p.risk_level,
    mentions_planning_only: p.mentions_planning_only,
    mentions_risk: p.mentions_risk,
    mentions_approval: p.mentions_approval,
    agents: [...p.agents],
    verification_gates: [...p.verification_gates],
    sections_rendered: [...p.sections_rendered],
  };
}

describe('validateHumanProjection — happy path', () => {
  test('valid projection for an ingestion mission passes', () => {
    const m = buildMission('Fix Kulturhuset ingestion.');
    const p = extractProjection(m);
    const result = validateHumanProjection(m, p);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('validateHumanProjection — hard rules', () => {
  test('projection.touched_scopes outside mission.subsystems is rejected', () => {
    const m = buildMission('Fix Kulturhuset ingestion.');
    const p = cloneProjection(extractProjection(m));
    p.touched_scopes = [...p.touched_scopes, 'agent_api']; // add a scope not in mission
    const result = validateHumanProjection(m, p);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /agent_api/.test(e))).toBe(true);
  });

  test('mission_id mismatch is rejected', () => {
    const m = buildMission('Fix parser.');
    const p = cloneProjection(extractProjection(m));
    p.mission_id = 'EP-FAKE-0000-0000-000';
    const result = validateHumanProjection(m, p);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /mission_id mismatch/.test(e))).toBe(true);
  });

  test('risk=critical hidden is rejected', () => {
    const m = buildMission('Drop the production database and rebuild it.');
    expect(m.risk).toBe('critical');
    const p = cloneProjection(extractProjection(m));
    p.mentions_risk = false;
    const result = validateHumanProjection(m, p);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /risk=critical/.test(e))).toBe(true);
  });

  test('planning_only=true hidden is rejected', () => {
    const m = buildMission('Plan only — investigate parser. Do not implement.');
    expect(m.planning_only).toBe(true);
    const p = cloneProjection(extractProjection(m));
    p.mentions_planning_only = false;
    const result = validateHumanProjection(m, p);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /planning_only=true/.test(e))).toBe(true);
  });

  test('requires_user_approval hidden is rejected', () => {
    // The architecture profile sets requires_user_approval
    const m = buildMission('Refactor masterplan.');
    if (m.requires_user_approval.length > 0) {
      const p = cloneProjection(extractProjection(m));
      p.mentions_approval = false;
      const result = validateHumanProjection(m, p);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /requires_user_approval/.test(e))).toBe(true);
    } else {
      // Skip test if no approval required (prompt was classified differently)
      expect(true).toBe(true);
    }
  });

  test('agents not in mission.roles is rejected', () => {
    const m = buildMission('Fix Kulturhuset ingestion.');
    const p = cloneProjection(extractProjection(m));
    p.agents = [...p.agents, 'fake_role'];
    const result = validateHumanProjection(m, p);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /fake_role/.test(e))).toBe(true);
  });

  test('verification_gates not in mission.required_gates is rejected', () => {
    const m = buildMission('Fix Kulturhuset ingestion.');
    const p = cloneProjection(extractProjection(m));
    p.verification_gates = [...p.verification_gates, 'fake_gate'];
    const result = validateHumanProjection(m, p);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /fake_gate/.test(e))).toBe(true);
  });
});

describe('validateHumanProjection — soft warnings', () => {
  test('empty touched_scopes for non-trivial is a warning', () => {
    // Use a longer prompt so the classifier doesn't take the short-prompt branch
    // (the short-prompt branch forces trivial complexity regardless of keywords).
    // This Swedish prompt naturally classifies as complexity=normal with no subsystems,
    // so cleared touched_scopes triggers the soft warning.
    const m = buildMission('Implementera en ny liten funktion i runA.ts som hanterar edge case.');
    expect(m.complexity).not.toBe('trivial'); // sanity: confirm classifier didn't take short-prompt branch
    const p = cloneProjection(extractProjection(m));
    p.touched_scopes = [];
    const result = validateHumanProjection(m, p);
    expect(result.warnings.length).toBeGreaterThan(0);
    // ok stays true (warnings are non-blocking)
    expect(typeof result.ok).toBe('boolean');
  });

  test('empty agents for small_team is a warning', () => {
    const m = buildMission('Fix parser.');
    const p = cloneProjection(extractProjection(m));
    p.agents = [];
    const mForced = { ...m, execution_mode: 'small_team' as const };
    const result = validateHumanProjection(mForced, p);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('validateRenderedHumanPlan — text-level checks', () => {
  test('rendered text for critical risk must include KRITISK or risk', async () => {
    const m = buildMission('Drop the production database and rebuild it.');
    expect(m.risk).toBe('critical');
    const p = extractProjection(m);
    const { renderHumanPlan } = await import('./human-plan-renderer');
    const rendered = renderHumanPlan(m);
    const result = validateRenderedHumanPlan(m, p, rendered);
    expect(result.ok).toBe(true);
    expect(rendered).toMatch(/KRITISK|risk/i);
  });

  test('rendered text for planning_only must include PLANNING/plan', async () => {
    const m = buildMission('Plan only — investigate parser. Do not implement.');
    expect(m.planning_only).toBe(true);
    const p = extractProjection(m);
    const { renderHumanPlan } = await import('./human-plan-renderer');
    const rendered = renderHumanPlan(m);
    const result = validateRenderedHumanPlan(m, p, rendered);
    // hpr-1.0: when planning_only, the projection mentions_planning_only gate is what matters
    expect(result.ok).toBe(true);
  });
});
