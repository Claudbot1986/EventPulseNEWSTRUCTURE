/**
 * gdpr.test.ts — GDPR helpers (validation + retention).
 */

import { describe, it, expect } from 'vitest';
import { isValidDeviceHash, retentionDays } from '../gdpr.js';

describe('isValidDeviceHash', () => {
  it('accepts 64 lowercase hex chars', () => {
    expect(isValidDeviceHash('a'.repeat(64))).toBe(true);
  });

  it('rejects short', () => {
    expect(isValidDeviceHash('abc')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidDeviceHash('A'.repeat(64))).toBe(false);
  });

  it('rejects non-hex chars', () => {
    expect(isValidDeviceHash('g'.repeat(64))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidDeviceHash('')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidDeviceHash(123)).toBe(false);
    expect(isValidDeviceHash(null)).toBe(false);
    expect(isValidDeviceHash(undefined)).toBe(false);
    expect(isValidDeviceHash({})).toBe(false);
  });
});

describe('retentionDays', () => {
  it('returns 30 by default', () => {
    delete process.env.ANALYTICS_RETENTION_DAYS;
    expect(retentionDays()).toBe(30);
  });

  it('respects env override', () => {
    process.env.ANALYTICS_RETENTION_DAYS = '7';
    expect(retentionDays()).toBe(7);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });

  it('caps at 365', () => {
    process.env.ANALYTICS_RETENTION_DAYS = '999';
    expect(retentionDays()).toBe(365);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });

  it('falls back to 30 on invalid input', () => {
    process.env.ANALYTICS_RETENTION_DAYS = 'not-a-number';
    expect(retentionDays()).toBe(30);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });

  it('falls back to 30 when env is below 1', () => {
    process.env.ANALYTICS_RETENTION_DAYS = '0';
    expect(retentionDays()).toBe(30);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });
});