/**
 * Haversine great-circle distance — pure math, no I/O, no deps.
 *
 * Used by rank_events.ts to compute the distance between the user's
 * current location and each event venue. The result feeds the
 * `near` boost (<= 3 km, +0.1) and the `far` penalty (>10 km, linearly
 * down to -0.3 at 50+ km) — see RANK_WEIGHTS in rank_events.ts.
 *
 * Earth radius: 6371 km (mean radius, IUGG). The choice of mean vs
 * equatorial radius matters little at Stockholm latitudes (≈ 0.3% delta)
 * but mean is the standard for civilian distance work.
 *
 * Reference: R.W. Sinnott, "Virtues of the Haversine", Sky & Telescope
 * 68 (2), 1984. Pure function — exported so the test file can pin
 * behavior without touching rank_events.
 */

/** Mean Earth radius in km. Used for great-circle distance. */
export const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians.
 *
 * Exported because the haversine formula is more numerically stable
 * with the trig functions in radians, and the test suite wants to
 * round-trip known values.
 */
export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Validate a single latitude.
 *
 * Returns false for any of: NaN, +/-Infinity, out-of-range (<-90 or >90),
 * null, undefined, or non-number. Used by haversineKm to short-circuit
 * silently — the ranker treats missing coordinates as a no-op rather
 * than a hard error (a venue row without lat/lng should not break
 * the entire feed).
 */
export function isValidLat(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

/**
 * Validate a single longitude.
 *
 * Returns false for any of: NaN, +/-Infinity, out-of-range (<-180 or >180),
 * null, undefined, or non-number.
 */
export function isValidLng(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

/**
 * Backwards-compatible generic coord check. Defaults to the longitude
 * bound (more permissive). Prefer isValidLat/isValidLng at call sites
 * that know which axis they are checking.
 */
export function isValidCoord(value: unknown): value is number {
  return isValidLng(value);
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Great-circle distance in km between two lat/lng points.
 *
 * Pure function, no side effects. Returns:
 *   - 0 when the two points are identical (a == 0)
 *   - the antipodal distance (~20015 km) when the points are diametrically
 *     opposite on the sphere
 *   - NaN if ANY input is missing or out of range; the ranker treats
 *     NaN as "no distance known" and skips the geo feature without
 *     applying any boost/penalty.
 *
 * Argument order is (lat1, lon1, lat2, lon2) — flat positional for
 * speed inside the hot path of rankEvents (the function runs once per
 * candidate card per request).
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (
    !isValidLat(lat1) ||
    !isValidLng(lon1) ||
    !isValidLat(lat2) ||
    !isValidLng(lon2)
  ) {
    return NaN;
  }

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lon2 - lon1);

  const sinDPhi = Math.sin(dPhi / 2);
  const sinDLambda = Math.sin(dLambda / 2);

  const a =
    sinDPhi * sinDPhi +
    Math.cos(phi1) * Math.cos(phi2) * sinDLambda * sinDLambda;

  // Guard against floating-point drift past 1 (can happen at antipodes
  // before atan2 normalizes). Clamp to [0, 1] so sqrt stays real.
  const clampedA = a > 1 ? 1 : a < 0 ? 0 : a;

  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
  return EARTH_RADIUS_KM * c;
}
