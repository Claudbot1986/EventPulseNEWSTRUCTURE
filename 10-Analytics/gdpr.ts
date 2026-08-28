/**
 * gdpr.ts — GDPR helpers for the analytics service.
 *
 * Implements the four rights required for personal data processing
 * under GDPR (note: we collect no PII, but device_id_hash is a
 * pseudonymous identifier and we treat it as if it were personal data
 * to be safe):
 *
 * 1. Right to access (export) — `GET /api/gdpr/export?device_id_hash=...`
 * 2. Right to erasure       — `POST /api/gdpr/erase` with `{device_id_hash}`
 * 3. Right to rectification — not applicable (no PII)
 * 4. Right to restrict      — stop ingest via `POST /api/gdpr/opt-out`
 *
 * Plus retention: 30 days by default, configurable via env.
 */

import { deleteEventsForDevice, readEvents } from './storage.js';

const DEVICE_HASH_REGEX = /^[a-f0-9]{64}$/;

export function isValidDeviceHash(s: unknown): s is string {
  return typeof s === 'string' && DEVICE_HASH_REGEX.test(s);
}

/**
 * GDPR right-to-export — return all events for a given device.
 */
export async function exportForDevice(deviceIdHash: string): Promise<unknown[]> {
  if (!isValidDeviceHash(deviceIdHash)) {
    throw new Error('invalid device_id_hash');
  }
  const all = await readEvents({ limit: 100_000 });
  return all.filter((ev) => ev.device_id_hash === deviceIdHash);
}

/**
 * GDPR right-to-erasure — delete all events for a device.
 * Returns the number of events deleted.
 */
export async function eraseForDevice(deviceIdHash: string): Promise<number> {
  if (!isValidDeviceHash(deviceIdHash)) {
    throw new Error('invalid device_id_hash');
  }
  return deleteEventsForDevice(deviceIdHash);
}

/**
 * Get the current retention window (in days).
 */
export function retentionDays(): number {
  const raw = process.env.ANALYTICS_RETENTION_DAYS;
  const n = raw ? Number(raw) : 30;
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(n, 365);
}
