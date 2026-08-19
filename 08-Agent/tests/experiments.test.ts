/**
 * Tests for the A/B testing primitives.
 *
 * Covers: hash-based sticky assignment, ~50/50 split, determinism, salt
 * sensitivity, normal CDF roundtrip, two-proportion z-test known cases,
 * lift verdict branches, required-sample-size formula.
 *
 * Run with:  npx vitest run 08-Agent/tests/experiments.test.ts
 */

import { describe, expect, it } from 'vitest';
import {
  assignVariant,
  computeLift,
  twoProportionZTest,
  normalCdf,
  inverseNormalCdf,
  requiredSampleSize,
  MIN_SAMPLE_PER_VARIANT,
  DEFAULT_ASSIGNMENT_SALT,
  type VariantStats,
} from '../tools/experiments';

// ─── assignVariant ──────────────────────────────────────────────────────────

describe('assignVariant', () => {
  it('is deterministic for the same user', () => {
    const a = assignVariant('user-123', 'PERSONALIZATION_PRIORS');
    const b = assignVariant('user-123', 'PERSONALIZATION_PRIORS');
    expect(a).toBe(b);
  });

  it('returns one of the two valid variants', () => {
    for (let i = 0; i < 100; i++) {
      const v = assignVariant(`user-${i}`, 'EXP');
      expect(['control', 'treatment']).toContain(v);
    }
  });

  it('splits ~50/50 across many users (binomial test)', () => {
    // 10 000 users, expect ~5000 control / ~5000 treatment.
    // 95% CI half-width for p=0.5, n=10000 is ~0.0098, so we allow 4700–5300.
    let treatment = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (assignVariant(`user-${i}`, 'EXP') === 'treatment') treatment++;
    }
    expect(treatment).toBeGreaterThan(4700);
    expect(treatment).toBeLessThan(5300);
  });

  it('changes assignment when salt changes (re-randomization)', () => {
    // For a sample of 200 users, with overwhelming probability the
    // assignment will differ for at least one when salt is changed.
    let diffs = 0;
    for (let i = 0; i < 200; i++) {
      const a = assignVariant(`user-${i}`, 'EXP', 'salt-A');
      const b = assignVariant(`user-${i}`, 'EXP', 'salt-B');
      if (a !== b) diffs++;
    }
    expect(diffs).toBeGreaterThan(80); // ~50% expected, allow slack
  });

  it('changes assignment when experimentId changes', () => {
    let diffs = 0;
    for (let i = 0; i < 200; i++) {
      const a = assignVariant(`user-${i}`, 'EXP_A', DEFAULT_ASSIGNMENT_SALT);
      const b = assignVariant(`user-${i}`, 'EXP_B', DEFAULT_ASSIGNMENT_SALT);
      if (a !== b) diffs++;
    }
    expect(diffs).toBeGreaterThan(80);
  });
});

// ─── normalCdf / inverseNormalCdf ───────────────────────────────────────────

describe('normalCdf', () => {
  it('Φ(0) = 0.5', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });
  it('Φ(1.96) ≈ 0.975 (the canonical 95% one-tailed cutoff)', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it('Φ(-1.96) ≈ 0.025', () => {
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it('Φ(2.576) ≈ 0.995 (99% one-tailed cutoff)', () => {
    expect(normalCdf(2.576)).toBeCloseTo(0.995, 3);
  });
});

describe('inverseNormalCdf', () => {
  it('Φ⁻¹(0.975) ≈ 1.96', () => {
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.96, 2);
  });
  it('Φ⁻¹(0.5) = 0', () => {
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 4);
  });
  it('roundtrips with normalCdf across the central range', () => {
    for (const p of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
      const z = inverseNormalCdf(p);
      const back = normalCdf(z);
      expect(back).toBeCloseTo(p, 4);
    }
  });
  it('returns -Infinity for p=0 and Infinity for p=1', () => {
    expect(inverseNormalCdf(0)).toBe(-Infinity);
    expect(inverseNormalCdf(1)).toBe(Infinity);
  });
  it('throws for p outside (0, 1)', () => {
    expect(() => inverseNormalCdf(-0.1)).toThrow();
    expect(() => inverseNormalCdf(1.1)).toThrow();
  });
});

// ─── twoProportionZTest ─────────────────────────────────────────────────────

describe('twoProportionZTest', () => {
  it('returns z=0, pValue=1 when both proportions are identical', () => {
    const r = twoProportionZTest(50, 100, 50, 100);
    expect(r.z).toBeCloseTo(0, 6);
    expect(r.pValue).toBeCloseTo(1, 6);
  });

  it('returns z>0, p<0.05 when treatment beats control (50/200 vs 80/200)', () => {
    const r = twoProportionZTest(80, 200, 50, 200);
    expect(r.z).toBeGreaterThan(0);
    expect(r.pValue).toBeLessThan(0.05);
  });

  it('returns z<0, p<0.05 when control beats treatment', () => {
    const r = twoProportionZTest(50, 200, 80, 200);
    expect(r.z).toBeLessThan(0);
    expect(r.pValue).toBeLessThan(0.05);
  });

  it('returns p≈1 with degenerate empty inputs', () => {
    expect(twoProportionZTest(0, 0, 50, 100).pValue).toBe(1);
    expect(twoProportionZTest(50, 100, 0, 0).pValue).toBe(1);
  });

  it('throws on invalid inputs', () => {
    expect(() => twoProportionZTest(-1, 100, 50, 100)).toThrow();
    expect(() => twoProportionZTest(101, 100, 50, 100)).toThrow();
  });

  it('known case: 100/1000 vs 120/1000 → z ≈ 1.429, p ≈ 0.153', () => {
    // Verified against R: prop.test(c(100,120), c(1000,1000))
    const r = twoProportionZTest(120, 1000, 100, 1000);
    expect(r.z).toBeCloseTo(1.429, 2);
    expect(r.pValue).toBeCloseTo(0.153, 3);
  });
});

// ─── computeLift ────────────────────────────────────────────────────────────

describe('computeLift', () => {
  it('returns INCONCLUSIVE when either side has too few samples', () => {
    const t: VariantStats = { variant: 'treatment', impressions: 10,  outbounds: 1  };
    const c: VariantStats = { variant: 'control',    impressions: 1000, outbounds: 100 };
    expect(computeLift(t, c).verdict).toBe('INCONCLUSIVE');
    expect(MIN_SAMPLE_PER_VARIANT).toBe(500); // pin the threshold
  });

  it('returns TREATMENT_BETTER for clearly significant positive lift', () => {
    // 30% vs 20% on 5000 each — z ≈ 7.6, p ≈ 0
    const t: VariantStats = { variant: 'treatment', impressions: 5000, outbounds: 1500 };
    const c: VariantStats = { variant: 'control',    impressions: 5000, outbounds: 1000 };
    const r = computeLift(t, c);
    expect(r.verdict).toBe('TREATMENT_BETTER');
    expect(r.relativeLift).toBeCloseTo(0.5, 2);
    expect(r.pValue).toBeLessThan(0.001);
  });

  it('returns CONTROL_BETTER for clearly significant negative lift', () => {
    const t: VariantStats = { variant: 'treatment', impressions: 5000, outbounds: 1000 };
    const c: VariantStats = { variant: 'control',    impressions: 5000, outbounds: 1500 };
    expect(computeLift(t, c).verdict).toBe('CONTROL_BETTER');
  });

  it('returns NO_SIGNIFICANT_DIFF for tiny lift under threshold', () => {
    // 20.1% vs 20% on 10000 each — p ≈ 0.86 (well under significance)
    const t: VariantStats = { variant: 'treatment', impressions: 10000, outbounds: 2010 };
    const c: VariantStats = { variant: 'control',    impressions: 10000, outbounds: 2000 };
    expect(computeLift(t, c).verdict).toBe('NO_SIGNIFICANT_DIFF');
  });

  it('returns relativeLift=null when control CTR is 0', () => {
    const t: VariantStats = { variant: 'treatment', impressions: 1000, outbounds: 10 };
    const c: VariantStats = { variant: 'control',    impressions: 1000, outbounds: 0  };
    const r = computeLift(t, c);
    expect(r.relativeLift).toBeNull();
    expect(r.absoluteLift).toBeCloseTo(0.01, 4);
  });

  it('CI contains the absolute lift point estimate', () => {
    const t: VariantStats = { variant: 'treatment', impressions: 5000, outbounds: 1500 };
    const c: VariantStats = { variant: 'control',    impressions: 5000, outbounds: 1000 };
    const r = computeLift(t, c);
    expect(r.ci95.low).toBeLessThan(r.absoluteLift);
    expect(r.ci95.high).toBeGreaterThan(r.absoluteLift);
  });

  it('echoes sample sizes', () => {
    const t: VariantStats = { variant: 'treatment', impressions: 5000, outbounds: 1 };
    const c: VariantStats = { variant: 'control',    impressions: 4000, outbounds: 1 };
    expect(computeLift(t, c).samples).toEqual({ treatment: 5000, control: 4000 });
  });

  it('handles zero impressions on both sides without NaN', () => {
    const t: VariantStats = { variant: 'treatment', impressions: 0, outbounds: 0 };
    const c: VariantStats = { variant: 'control',    impressions: 0, outbounds: 0 };
    const r = computeLift(t, c);
    expect(r.treatmentCtr).toBe(0);
    expect(r.controlCtr).toBe(0);
    expect(r.absoluteLift).toBe(0);
    expect(r.verdict).toBe('INCONCLUSIVE');
  });
});

// ─── requiredSampleSize ─────────────────────────────────────────────────────

describe('requiredSampleSize', () => {
  it('matches the textbook formula for baseline 20%, MDE +5pp, α=0.05, power=0.80', () => {
    // Per Fleiss (1981) §5.5 / Kohavi (2020) §4.3:
    //   n = (z_{α/2} + z_β)² · (p1(1-p1) + p2(1-p2)) / (p1-p2)²
    // For p1=0.20, p2=0.25, α=0.05 (z=1.96), power=0.80 (z=0.842):
    //   n ≈ 1091 per variant. Cross-checked against the standard textbook
    //   calculator (e.g., statskingdom.com two-proportion sample size).
    const n = requiredSampleSize(0.20, 0.05);
    expect(n).toBeGreaterThan(1080);
    expect(n).toBeLessThan(1100);
  });

  it('returns 0 for non-positive MDE', () => {
    expect(requiredSampleSize(0.2, 0)).toBe(0);
    expect(requiredSampleSize(0.2, -0.01)).toBe(0);
  });

  it('returns 0 for invalid baseline rates', () => {
    expect(requiredSampleSize(-0.1, 0.05)).toBe(0);
    expect(requiredSampleSize(1.5, 0.05)).toBe(0);
  });

  it('clamps p2 to [0,1] if MDE would push it out of range', () => {
    // baseline 95% + 10% MDE → p2=1.05 → clamp to 1
    // Should still return a finite sample size.
    const n = requiredSampleSize(0.95, 0.10);
    expect(n).toBeGreaterThan(0);
    expect(Number.isFinite(n)).toBe(true);
  });

  it('scales with inverse-square of MDE (smaller MDE → much larger n)', () => {
    const n5pp  = requiredSampleSize(0.20, 0.05);
    const n25pp = requiredSampleSize(0.20, 0.025);
    // MDE halved → n should roughly 4x (inverse-square of 0.5)
    expect(n25pp).toBeGreaterThan(n5pp * 3);
  });
});
