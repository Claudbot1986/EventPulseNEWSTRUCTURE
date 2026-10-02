// 2026-10-02 — Tester för geo-coordinate prioritering.
//
// Bakgrund: BUG A innebar att events.lat sattes från raw.lat istället för
// från venues.lat. När raw-data saknade lat/lng behölls fallback 59.3293
// även om venue hade riktig koordinat. ~261 events var drabbade.
//
// chooseGeoCoords() prioriterar nu:
//   1. raw.lat (om satt OCH ej fallback) — källan har riktig geo
//   2. venue.lat (om satt OCH ej fallback) — venues resolvaste koordinat
//   3. raw.lat (även om fallback, om venue är null)
//   4. venue.lat (även om fallback)
//   5. Sergels torg (sista fallback)
//
// Dessa tester pinnar prioriteringsordningen och regression-skyddar.

import { describe, it, expect } from 'vitest';
import {
  chooseGeoCoords,
  isGeoFallback,
  GEO_FALLBACK_LAT,
  GEO_FALLBACK_LNG,
} from './normalizer';

describe('isGeoFallback', () => {
  it('returnerar true för Sergels torg', () => {
    expect(isGeoFallback(59.3293, 18.0686)).toBe(true);
    expect(isGeoFallback(GEO_FALLBACK_LAT, GEO_FALLBACK_LNG)).toBe(true);
  });

  it('returnerar false för riktig geo', () => {
    expect(isGeoFallback(59.3371, 18.0675)).toBe(false); // Nalen
    expect(isGeoFallback(59.3382, 18.0984)).toBe(false); // Berwaldhallen
    expect(isGeoFallback(0, 0)).toBe(false);
  });

  it('returnerar false för null', () => {
    expect(isGeoFallback(null, null)).toBe(false);
    expect(isGeoFallback(null, 18.0686)).toBe(false);
    expect(isGeoFallback(59.3293, null)).toBe(false);
  });

  it('epsilon-tolerans', () => {
    expect(isGeoFallback(59.3293 + 1e-7, 18.0686 + 1e-7)).toBe(true);
    expect(isGeoFallback(59.3293 + 1e-5, 18.0686)).toBe(false);
  });
});

describe('chooseGeoCoords', () => {
  it('prioriterar raw med riktig geo över venue', () => {
    const result = chooseGeoCoords(59.40, 10.50, 59.33, 18.07);
    expect(result.lat).toBe(59.40);
    expect(result.lng).toBe(10.50);
  });

  it('propagerar venue.lat om raw är null', () => {
    const result = chooseGeoCoords(null, null, 59.3382, 18.0984);
    expect(result.lat).toBe(59.3382);
    expect(result.lng).toBe(18.0984);
  });

  it('propagerar venue.lat om raw är fallback (BUG A-fixet fallet)', () => {
    // 261 events hade venue med riktig geo (t.ex. Nalen = 59.3371) men
    // raw lat var fallback 59.3293. Fixet gör att venues.lat propageras.
    const result = chooseGeoCoords(59.3293, 18.0686, 59.3371, 18.0675);
    expect(result.lat).toBe(59.3371);
    expect(result.lng).toBe(18.0675);
  });

  it('propagerar venue.lat om raw.lat är null även om venue är fallback', () => {
    const result = chooseGeoCoords(null, null, 59.3293, 18.0686);
    expect(result.lat).toBe(59.3293);
    expect(result.lng).toBe(18.0686);
  });

  it('behåller raw med riktig geo även om venue är fallback', () => {
    const result = chooseGeoCoords(60.10, 12.50, 59.3293, 18.0686);
    expect(result.lat).toBe(60.10);
    expect(result.lng).toBe(12.50);
  });

  it('fallback till Sergels torg om inget finns', () => {
    const result = chooseGeoCoords(null, null, null, null);
    expect(result.lat).toBe(GEO_FALLBACK_LAT);
    expect(result.lng).toBe(GEO_FALLBACK_LNG);
  });

  it('fallback om raw.lat är null men rawLng finns', () => {
    const result = chooseGeoCoords(null, 18.07, null, null);
    expect(result.lat).toBe(GEO_FALLBACK_LAT);
    expect(result.lng).toBe(GEO_FALLBACK_LNG);
  });

  it('använd venue.lat om raw.lat är undefined men venue har riktig geo', () => {
    const result = chooseGeoCoords(undefined, undefined, 59.3318, 18.0940);
    expect(result.lat).toBe(59.3318);
    expect(result.lng).toBe(18.0940);
  });

  it('använd venue.lat även om venue.country = null', () => {
    const result = chooseGeoCoords(null, null, 59.40, 17.7);
    expect(result.lat).toBe(59.40);
    expect(result.lng).toBe(17.7);
  });

  it('real-world Nalen scenario (regression-skydd)', () => {
    const nalenLat = 59.3371;
    const nalenLng = 18.0675;
    const result = chooseGeoCoords(59.3293, 18.0686, nalenLat, nalenLng);
    expect(result.lat).toBe(nalenLat);
    expect(result.lng).toBe(nalenLng);
  });

  it('real-world Berwaldhallen scenario', () => {
    const berwaldLat = 59.3382;
    const berwaldLng = 18.0984;
    const result = chooseGeoCoords(null, null, berwaldLat, berwaldLng);
    expect(result.lat).toBe(berwaldLat);
    expect(result.lng).toBe(berwaldLng);
  });

  it('använder venue om raw är halv (lat utan lng)', () => {
    // raw.lat satt utan raw.lng — använd venues kompletta koordinat istället
    // för att hitta på en halv-koordinat (bättre att hoppa till venue än att
    // gissa lng via fallback).
    const result = chooseGeoCoords(59.40, null, 59.3382, 18.0984);
    expect(result.lat).toBe(59.3382);
    expect(result.lng).toBe(18.0984);
  });
});