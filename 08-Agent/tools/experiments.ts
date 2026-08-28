/**
 * experiments — A/B testing primitives for Phase 2 personalization lift.
 *
 * Research basis (2026-08-19):
 *
 *  - Kohavi, Longbotham, Sommerfield, Henne (2009).
 *    "Controlled experiments on the web: survey and practical guide."
 *    Data Mining and Knowledge Discovery 18(1). https://link.springer.com/article/10.1007/s10618-008-0114-1
 *    The canonical A/B-testing reference. Recommends:
 *      * Hash-based assignment: h = hash(user_id + experiment_name + global_salt)
 *        variant = h mod K — deterministic, sticky, no DB lookup needed.
 *      * One Overall Evaluation Criterion (OEC). For us: outbound CTR.
 *      * Pre-register the analysis plan BEFORE looking at data.
 *
 *  - Kohavi, Tang, Xu (2020). "Trustworthy Online Controlled Experiments:
 *    A Practical Guide to A/B Testing." Springer. https://experimentguide.com/
 *    Industry-standard methodology. Sample-size formula (Ch. 4) and
 *    variance-reduction techniques (Ch. 10) cited below.
 *
 *  - Deng, Lu, Chen (2017). "Improving the Sensitivity of Online Controlled
 *    Experiments by Utilizing Pre-Experiment Data." WSDM 2017.
 *    https://dl.acm.org/doi/10.1145/3018661.3018670
 *    CUPED variance reduction — skipped in v1 because we don't have
 *    pre-experiment baseline data on new users yet; revisit once we have
 *    ≥2 weeks of interaction history.
 *
 *  - Agresti (2002). "Categorical Data Analysis." Wiley. §3.2 — two-proportion
 *    z-test. The standard significance test for binary outcomes like CTR.
 *    z = (p̂1 − p̂2) / sqrt(p̂(1 − p̂)(1/n1 + 1/n2))
 *    where p̂ is the pooled proportion under H0.
 *
 * Design choices for EventPulse:
 *  - Sticky 50/50 split by SHA-256 hash of (user_id, experiment_id, salt).
 *    No DB row needed for assignment — recompute deterministically.
 *  - One experiment at v1: PERSONALIZATION_PRIORS (treatment = priors on,
 *    control = priors off).
 *  - Outbound CTR = outbound_events / impressions. This is the OEC for the
 *    personalization experiment — it's the closest proxy for "user acted on
 *    the recommendation" we can measure without ticket-purchase data.
 *  - Statistical guard: p < 0.05 AND ≥ MIN_SAMPLE_PER_VARIANT before
 *    declaring "lift detected". Below that, we report INCONCLUSIVE.
 *  - Sample-size formula exposed so future experiment design can plan MDE.
 *
 * Out of scope (v1):
 *  - Sequential testing / always-valid CIs (would need mSPRT, Howard et al. 2021)
 *  - CUPED variance reduction (needs baseline period)
 *  - Multi-arm bandits (we want clean lift measurement first)
 */

import { createHash } from 'node:crypto';

// ─── Tunable constants ──────────────────────────────────────────────────────

/** Salt for hash-based assignment. Override per experiment to re-randomize
 *  without changing the user_id space. */
export const DEFAULT_ASSIGNMENT_SALT = 'eventpulse-v1-2026-08-19';

/** Min impressions per variant before the lift estimate is meaningful.
 *  Below this we always report INCONCLUSIVE — Kohavi §4 warns about
 *  premature peeking. */
export const MIN_SAMPLE_PER_VARIANT = 500;

/** Default significance level (two-sided). */
export const DEFAULT_ALPHA = 0.05;

// ─── Types ──────────────────────────────────────────────────────────────────

export type Variant = 'control' | 'treatment';

/** Per-variant aggregate counters. The caller computes these from
 *  user_interactions rows (impressions, outbounds). */
export interface VariantStats {
  variant: Variant;
  impressions: number;
  /** Count of events the user actually tapped through to a ticket URL. */
  outbounds: number;
}

/** Computed CTR + z-test result. */
export interface LiftResult {
  /** Outbound CTR for each variant as a ratio in [0, 1]. */
  treatmentCtr: number;
  controlCtr: number;
  /** Absolute lift in CTR points (treatment_ctr - control_ctr). */
  absoluteLift: number;
  /** Relative uplift: (treatment - control) / control. null if control=0. */
  relativeLift: number | null;
  /** Two-sided p-value from the z-test. */
  pValue: number;
  /** 95% confidence interval for absolute lift (Wald interval). */
  ci95: { low: number; high: number };
  /** "INCONCLUSIVE" if either side < MIN_SAMPLE_PER_VARIANT, else
   *  "TREATMENT_BETTER" / "CONTROL_BETTER" / "NO_SIGNIFICANT_DIFF". */
  verdict: LiftVerdict;
  /** Sample sizes (echoed for downstream UI). */
  samples: { treatment: number; control: number };
}

export type LiftVerdict =
  | 'INCONCLUSIVE'         // too few samples
  | 'NO_SIGNIFICANT_DIFF'  // p >= alpha
  | 'TREATMENT_BETTER'     // significant positive lift
  | 'CONTROL_BETTER';      // significant negative lift (treatment worse)

// ─── Assignment ─────────────────────────────────────────────────────────────

/**
 * Sticky 50/50 assignment. Hashes (user_id, experiment_id, salt) with
 * SHA-256, takes the first 4 bytes as an unsigned int, mods by 2.
 *
 * Same (user_id, experiment_id, salt) → same variant. Deterministic.
 * Change `salt` to re-randomize without changing user_ids.
 */
export function assignVariant(
  userId: string,
  experimentId: string,
  salt: string = DEFAULT_ASSIGNMENT_SALT,
): Variant {
  const h = createHash('sha256');
  h.update(salt);
  h.update('\x00');
  h.update(experimentId);
  h.update('\x00');
  h.update(userId);
  const digest = h.digest();
  // Read first 4 bytes as uint32 (big-endian). Mod 2 gives 50/50.
  const n = digest.readUInt32BE(0);
  return (n & 1) === 0 ? 'control' : 'treatment';
}

// ─── Significance ───────────────────────────────────────────────────────────

/**
 * Two-proportion z-test (Agresti §3.2). Returns the test statistic z and
 * the two-sided p-value computed from the standard normal CDF.
 *
 * Pooled variance under H0 (proportions are equal):
 *   p̂ = (x1 + x2) / (n1 + n2)
 *   SE = sqrt(p̂(1 − p̂)(1/n1 + 1/n2))
 *
 * Pure function — exposed for tests and for callers that want raw stats.
 */
export function twoProportionZTest(
  success1: number, n1: number,
  success2: number, n2: number,
): { z: number; pValue: number } {
  if (n1 <= 0 || n2 <= 0) return { z: 0, pValue: 1 };
  if (success1 < 0 || success2 < 0) {
    throw new Error('success counts must be non-negative');
  }
  if (success1 > n1 || success2 > n2) {
    throw new Error('success counts cannot exceed sample sizes');
  }
  const p1 = success1 / n1;
  const p2 = success2 / n2;
  const pPool = (success1 + success2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) {
    // Both rates identical at the limit — no signal.
    return { z: 0, pValue: 1 };
  }
  const z = (p1 - p2) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { z, pValue };
}

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 approximation.
 *  Max error ≈ 7.5e-8 — plenty for p-values (we never need > 6 sig figs). */
export function normalCdf(z: number): number {
  // Φ(z) for any real z. Use symmetry: Φ(-z) = 1 - Φ(z).
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  // A&S 7.1.26
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  // Φ(z) = ½(1 + erf(z/√2))
  return 0.5 * (1 + sign * erf);
}

// ─── Lift computation ───────────────────────────────────────────────────────

/**
 * Compute the lift that treatment has over control on outbound CTR.
 *
 * Returns a verdict string so the UI can color the result:
 *   - INCONCLUSIVE       → not enough samples (< MIN_SAMPLE_PER_VARIANT)
 *   - NO_SIGNIFICANT_DIFF → p ≥ α
 *   - TREATMENT_BETTER    → significant positive lift (p < α, lift > 0)
 *   - CONTROL_BETTER      → significant negative lift (p < α, lift < 0)
 */
export function computeLift(
  treatment: VariantStats,
  control: VariantStats,
  alpha: number = DEFAULT_ALPHA,
): LiftResult {
  const tCtr = treatment.impressions > 0 ? treatment.outbounds / treatment.impressions : 0;
  const cCtr = control.impressions > 0 ? control.outbounds / control.impressions : 0;
  const absLift = tCtr - cCtr;
  const relLift = cCtr > 0 ? absLift / cCtr : null;

  // Significance: only meaningful when both sides have samples.
  let pValue = 1;
  if (treatment.impressions > 0 && control.impressions > 0) {
    pValue = twoProportionZTest(
      treatment.outbounds, treatment.impressions,
      control.outbounds, control.impressions,
    ).pValue;
  }

  let verdict: LiftVerdict;
  if (treatment.impressions < MIN_SAMPLE_PER_VARIANT || control.impressions < MIN_SAMPLE_PER_VARIANT) {
    verdict = 'INCONCLUSIVE';
  } else if (pValue >= alpha) {
    verdict = 'NO_SIGNIFICANT_DIFF';
  } else if (absLift > 0) {
    verdict = 'TREATMENT_BETTER';
  } else if (absLift < 0) {
    verdict = 'CONTROL_BETTER';
  } else {
    verdict = 'NO_SIGNIFICANT_DIFF';
  }

  // Wald 95% CI for the absolute difference. Conservative — fine for UI.
  const seDiff = Math.sqrt(
    (tCtr * (1 - tCtr)) / Math.max(treatment.impressions, 1) +
    (cCtr * (1 - cCtr)) / Math.max(control.impressions, 1),
  );
  const ci95 = {
    low: absLift - 1.96 * seDiff,
    high: absLift + 1.96 * seDiff,
  };

  return {
    treatmentCtr: tCtr,
    controlCtr: cCtr,
    absoluteLift: absLift,
    relativeLift: relLift,
    pValue,
    ci95,
    verdict,
    samples: { treatment: treatment.impressions, control: control.impressions },
  };
}

// ─── Power analysis ─────────────────────────────────────────────────────────

/**
 * Required sample size per variant to detect a given MDE at baseline rate
 * `p1` with significance α and power 1−β. Standard textbook formula
 * (Kohavi 2020 §4.3):
 *
 *   n = (z_{α/2} + z_β)² · (p1(1−p1) + p2(1−p2)) / (p2 − p1)²
 *
 * Defaults to α=0.05 (two-sided, z=1.96) and power=0.80 (z=0.84).
 *
 * Returns 0 if MDE is non-positive or rates are out of [0, 1].
 */
export function requiredSampleSize(
  baselineRate: number,
  mdeAbsolute: number,
  alpha: number = DEFAULT_ALPHA,
  power: number = 0.80,
): number {
  if (mdeAbsolute <= 0) return 0;
  if (baselineRate < 0 || baselineRate > 1) return 0;
  const p1 = baselineRate;
  const p2 = Math.min(1, Math.max(0, baselineRate + mdeAbsolute));
  if (p1 === p2) return 0;
  const zAlpha = inverseNormalCdf(1 - alpha / 2);
  const zBeta = inverseNormalCdf(power);
  const numerator = (zAlpha + zBeta) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2));
  const denominator = (p2 - p1) ** 2;
  return Math.ceil(numerator / denominator);
}

/** Inverse standard normal CDF (probit) via Beasley-Springer-Moro
 *  approximation. Accurate to ~1e-9 over the central range. */
export function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    throw new Error(`inverseNormalCdf: p must be in (0,1), got ${p}`);
  }
  // Beasley-Springer-Moro (1977). Coefficients from Wikipedia.
  const a = [
    -3.969683028665376e1,  2.209460984245205e2,
    -2.759285104469687e2,  1.383577518672690e2,
    -3.066479806614716e1,  2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1,  1.615858368580409e2,
    -1.556989798598866e2,  6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1,
    -2.400758277161838e0,  -2.549732539343734e0,
     4.374664141464968e0,   2.938163982698783e0,
  ];
  const d = [
     7.784695709041462e-3,  3.224671290700398e-1,
     2.445134137142996e0,   3.754408661907416e0,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}
