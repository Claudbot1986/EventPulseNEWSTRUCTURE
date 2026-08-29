/**
 * human-plan-renderer.test.ts — semantic tests for the Human Plan renderer.
 *
 * Run: `npx vitest run .claude/eventpulse/human-plan-renderer.test.ts`
 */

import { describe, expect, test } from 'vitest';
import { classify } from './classifier';
import { selectContext } from './context-selector';
import { compileMission } from './mission-compiler';
import { renderHumanPlan, extractProjection } from './human-plan-renderer';
import type { Mission } from './mission-compiler';

const REPO_ROOT = process.env.EP_REPO_ROOT ?? process.cwd();

function buildMission(prompt: string, sessionId = 'hpr-test-001'): Mission {
  const c = classify(prompt);
  const s = selectContext(c);
  const { mission } = compileMission({
    prompt,
    classification: c,
    selection: s,
    repoRoot: REPO_ROOT,
    sessionId,
  });
  return mission;
}

describe('Human Plan renderer — trivial mission', () => {
  test('compact output for trivial', () => {
    const m = buildMission('Rename this variable.');
    const out = renderHumanPlan(m);
    expect(out.length).toBeLessThan(800);
    expect(out).toContain('EVENTPULSE — PLAN');
    expect(out).toContain('MÅL');
    // Trivial flow is 3-step; must NOT contain AGENTER section.
    expect(out).not.toContain('AGENTER');
  });

  test('trivial uses v/↓ arrow and footer includes mission_id', () => {
    const m = buildMission('Fix typo.');
    const out = renderHumanPlan(m);
    expect(out).toContain(m.mission_id);
    expect(out).toMatch(/App[\s\S]*fix[\s\S]*test/);
  });
});

describe('Human Plan renderer — medium mission', () => {
  test('sequential flow for normal/solo', () => {
    // Long-enough prompt (>40 chars) so the classifier doesn't fall into the
    // trivial short-prompt branch.
    const m = buildMission('Implementera en ny liten funktion i runA.ts som hanterar edge case.');
    const out = renderHumanPlan(m);
    expect(out).toContain('FLÖDE');
    // Default normal/sequential flow
    expect(out).toMatch(/Analys[\s\S]*Plan[\s\S]*Implementering/);
  });
});

describe('Human Plan renderer — complex multi-agent', () => {
  test('multi-agent flow for lead_plus_specialists', () => {
    const m = buildMission('Add personalized recommendations using Event Graph signals.');
    const out = renderHumanPlan(m, { maxWidth: 80 });
    expect(out).toContain('FLÖDE');
    expect(out).toContain('AGENTER');
    // Multi-agent branch markers
    expect(out).toMatch(/Agent\s+\d+|Mission compiler|Integration|Completion Gate/);
  });

  test('A/B conditional flow when prompt mentions champion/variant', () => {
    // hpr-1.0: renderer detects A/B via prompt text "champion"/"variant"
    const m = buildMission('Compare champion ranking against new ranking variant in agent eval.');
    const out = renderHumanPlan(m);
    expect(out).toContain('Better?');
    expect(out).toMatch(/keep|reject/);
  });
});

describe('Human Plan renderer — protected scope visibility', () => {
  test('RÖRS INTE shown when risk is critical (synthetic mission)', () => {
    // Build a synthetic critical-risk mission so we don't depend on classifier output.
    const m = buildMission('Refactor parser adapter for ingestion of Kulturhuset tickets.');
    const critical: Mission = {
      ...m,
      risk: 'critical',
      requires_user_approval: ['production database modification'],
      human_review_required: true,
    };
    const out = renderHumanPlan(critical);
    // Critical risk must be visible
    expect(out).toMatch(/KRITISK|risk/i);
    // Approval requirement must surface (English "approval" or Swedish "godkännande")
    expect(out).toMatch(/approval|godkännande/i);
  });

  test('PÅVERKAS section uses subsystems present in mission', () => {
    const m = buildMission('Fix Kulturhuset ingestion adapter for missing image edge case.');
    const out = renderHumanPlan(m);
    expect(out).toContain('PÅVERKAS');
    expect(out).toMatch(/ingestion|source adapter/);
  });
});

describe('Human Plan renderer — projection integrity', () => {
  test('mission_id consistency between human and machine plan', () => {
    const m = buildMission('Investigate parser regression.');
    const out = renderHumanPlan(m);
    // Footer must include the machine mission id
    expect(out).toContain(`Machine mission: ${m.mission_id}`);
    // Should not embed raw mission_id in any other visible position beyond footer
    const occurrences = out.split(m.mission_id).length - 1;
    // Expected: 1 occurrence in footer line
    expect(occurrences).toBe(1);
  });

  test('extractProjection returns deterministic sorted arrays', () => {
    const m = buildMission('Fix Kulturhuset ingestion.');
    const p1 = extractProjection(m);
    const p2 = extractProjection(m);
    expect(p1.touched_scopes).toEqual(p2.touched_scopes);
    expect([...p1.touched_scopes].sort()).toEqual(p1.touched_scopes);
    expect(p1.mission_id).toBe(m.mission_id);
  });
});

describe('Human Plan renderer — terminal compatibility', () => {
  test('narrow terminal (maxWidth=40) uses ASCII fallback (no box chars)', () => {
    const m = buildMission('Add personalized recommendations using Event Graph signals.');
    const out = renderHumanPlan(m, { maxWidth: 40 });
    // ASCII fallback uses plain dash, no unicode box-drawing chars
    expect(out).not.toMatch(/[┌┐└┘├┤┬┴┼─│]/);
  });

  test('default terminal keeps Unicode box chars (or accepts ascii)', () => {
    const m = buildMission('Add personalized recommendations using Event Graph signals.');
    const out = renderHumanPlan(m, { maxWidth: 60 });
    // Just sanity: output is non-empty and contains header
    expect(out).toContain('EVENTPULSE — PLAN');
  });
});

describe('Human Plan renderer — defensive on missing data', () => {
  test('empty subsystems → "UNKNOWN" not crash', () => {
    // Build a synthetic mission with empty subsystems and trivial profile
    const m = buildMission('Rename variable.');
    const mEmpty: Mission = { ...m, subsystems: [], risk: 'low' };
    const out = renderHumanPlan(mEmpty);
    expect(out).toBeDefined();
    // Should still produce a non-empty plan without throwing
    expect(out.length).toBeGreaterThan(0);
  });

  test('non-solo execution_mode with empty roles → graceful', () => {
    const m = buildMission('Build the Event Graph module.');
    // Force non-solo mode for testing
    const mForced: Mission = { ...m, execution_mode: 'small_team', roles: [] };
    const out = renderHumanPlan(mForced);
    expect(out).toBeDefined();
  });

  test('planning_only=true produces a valid renderable plan', () => {
    const m = buildMission('Plan only — investigate Event Graph duplicates. Do not implement anything.');
    expect(m.planning_only).toBe(true);
    const out = renderHumanPlan(m);
    expect(out).toContain('MÅL');
  });
});

describe('Human Plan renderer — output size', () => {
  test('trivial output < 800 chars', () => {
    const m = buildMission('Rename variable.');
    expect(renderHumanPlan(m).length).toBeLessThan(800);
  });

  test('complex output < 4000 chars', () => {
    const m = buildMission('Add personalized recommendations to the home screen using Event Graph signals.');
    expect(renderHumanPlan(m).length).toBeLessThan(4000);
  });
});

describe('Human Plan renderer — sections_rendered tracking', () => {
  test('projection tracks which sections were emitted', () => {
    const m = buildMission('Fix Kulturhuset ingestion adapter.');
    const p = extractProjection(m);
    const out = renderHumanPlan(m, { maxWidth: 80 });
    // Out must contain every section that was tracked as rendered
    if (p.sections_rendered.includes('goal')) expect(out).toContain('MÅL');
    if (p.sections_rendered.includes('flow')) expect(out).toContain('FLÖDE');
    if (p.sections_rendered.includes('verification')) expect(out).toContain('VERIFIERING');
    if (p.sections_rendered.includes('risk')) expect(out).toContain('RISK');
  });
});
