/**
 * Tests for haversineKm — pure-math, no DB.
 *
 * Run with:  npx vitest run 08-Agent/utils
 *
 * The cases below pin the four behaviours that matter for the ranker:
 *   1. A real, near-coast Stockholm↔Södermalm distance (~1.1 km) so we
 *      can assert the formula is wired correctly with real-world values.
 *   2. Antipodes: the geometric upper bound (≈ π * EARTH_RADIUS_KM).
 *   3. Equator: 1° of longitude is ≈ 111.32 km — useful regression
 *      for sign/latitude handling.
 *   4. Null/invalid handling: every missing or out-of-range input must
 *      return NaN so the ranker can skip the geo feature without
 *      throwing into the chat path.
 *   5. Identity: same point returns 0.
 *   6. Symmetry: d(a,b) === d(b,a).
 */

import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_KM,
  haversineKm,
  isValidCoord,
  toRadians,
} from './haversine';

describe('haversine — Stockholm landmarks', () => {
  // Stockholm central: 59.33 N, 18.07 E
  // Södermalm (Slussen area): 59.32 N, 18.07 E  → ≈ 1.11 km due south.
  it('Stockholm (59.33, 18.07) ↔ Södermalm (59.32, 18.07) ≈ 1.11 km', () => {
    const d = haversineKm(59.33, 18.07, 59.32, 18.07);
    expect(d).toBeGreaterThan(1.05);
    expect(d).toBeLessThan(1.20);
  });

  // Stockholm → Solna (Friends Arena): ~5.2 km. Sanity check that
  // the formula handles a multi-km distance correctly.
  it('Stockholm (59.33, 18.07) ↔ Solna (59.36, 18.00) ≈ 5.2 km', () => {
    const d = haversineKm(59.33, 18.07, 59.36, 18.00);
    expect(d).toBeGreaterThan(4.5);
    expect(d).toBeLessThan(6.0);
  });
});

describe('haversine — geometric boundaries', () => {
  it('antipodes (0,0) ↔ (0,180) ≈ π * EARTH_RADIUS_KM', () => {
    const d = haversineKm(0, 0, 0, 180);
    // atan2(1, 0) = π/2, so c = π, d = π * R. Allow 0.5 km slack.
    expect(d).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 0);
    expect(d).toBeGreaterThan(EARTH_RADIUS_KM * 3.0);
    expect(d).toBeLessThan(EARTH_RADIUS_KM * 3.2);
  });

  it('1° along the equator (0,0) ↔ (0,1) ≈ 111.32 km', () => {
    const d = haversineKm(0, 0, 0, 1);
    // 1° at the equator = π/180 * R = 111.195 km (mean radius).
    expect(d).toBeGreaterThan(110.5);
    expect(d).toBeLessThan(112.0);
  });

  it('identity returns 0', () => {
    expect(haversineKm(59.33, 18.07, 59.33, 18.07)).toBe(0);
  });

  it('symmetric: d(a,b) === d(b,a)', () => {
    const ab = haversineKm(59.33, 18.07, 59.32, 18.07);
    const ba = haversineKm(59.32, 18.07, 59.33, 18.07);
    expect(ab).toBe(ba);
  });
});

describe('haversine — null / invalid input handling', () => {
  it('returns NaN when lat1 is NaN', () => {
    expect(Number.isNaN(haversineKm(NaN, 18.07, 59.32, 18.07))).toBe(true);
  });

  it('returns NaN when lng2 is Infinity', () => {
    expect(Number.isNaN(haversineKm(59.33, 18.07, 59.32, Infinity))).toBe(true);
  });

  it('returns NaN when a coord is out of range (> 90 lat)', () => {
    expect(Number.isNaN(haversineKm(91, 0, 0, 0))).toBe(true);
  });

  it('returns NaN when a coord is out of range (> 180 lng)', () => {
    expect(Number.isNaN(haversineKm(0, 181, 0, 0))).toBe(true);
  });

  it('returns NaN when a coord is < -180', () => {
    expect(Number.isNaN(haversineKm(0, 0, 0, -181))).toBe(true);
  });
});

describe('haversine — helpers', () => {
  it('toRadians(0) === 0', () => {
    expect(toRadians(0)).toBe(0);
  });

  it('toRadians(180) === π', () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 10);
  });

  it('toRadians(360) === 2π', () => {
    expect(toRadians(360)).toBeCloseTo(2 * Math.PI, 10);
  });

  it('isValidCoord accepts in-range finite numbers', () => {
    expect(isValidCoord(59.33)).toBe(true);
    expect(isValidCoord(-180)).toBe(true);
    expect(isValidCoord(180)).toBe(true);
  });

  it('isValidCoord rejects NaN, Infinity, out-of-range, and non-numbers', () => {
    expect(isValidCoord(NaN)).toBe(false);
    expect(isValidCoord(Infinity)).toBe(false);
    expect(isValidCoord(-Infinity)).toBe(false);
    expect(isValidCoord(181)).toBe(false);
    expect(isValidCoord(-181)).toBe(false);
    expect(isValidCoord('59.33')).toBe(false);
    expect(isValidCoord(null)).toBe(false);
    expect(isValidCoord(undefined)).toBe(false);
  });
});
