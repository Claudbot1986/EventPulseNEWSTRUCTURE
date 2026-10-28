/**
 * Köfelsamling — 2026-10-28.
 *
 * Nattet 26 okt skrev importen 583 KB identiska felrader (en rad per event)
 * och avslutade med exit 0. Två fel samman: ingen övre gräns på antalet
 * felrader, och exit 0 trots att INGENTING kunde köas.
 *
 * Negativa kontroller i den här filen:
 *   - loggen växer INTE med antalet fel (bounded)
 *   - exit ≠ 0 när inget kunde köas
 *   - exit = 0 när något kunde köas (delvis lyckad körning är inte trasig)
 *   - den värsta felklassen vinner (transport slår logic)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createQueueErrorTracker, MAX_SAMPLES } from './queue-errors.mjs';
import { classifyMessage, isDegradedLine, splitDegraded } from './net-error.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fånga console.error och returnera raderna. */
function captureStderr(): { lines: string[] } {
  const lines: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines };
}

describe('createQueueErrorTracker — gräns på loggen', () => {
  it('räknar felen', () => {
    const tracker = createQueueErrorTracker();
    expect(tracker.count).toBe(0);
    tracker.record(new Error('a'), 'rad 1');
    tracker.record(new Error('b'), 'rad 2');
    expect(tracker.count).toBe(2);
  });

  it('skriver högst MAX_SAMPLES rader — loggen växer INTE med antalet fel', () => {
    const { lines } = captureStderr();
    const tracker = createQueueErrorTracker();
    for (let i = 0; i < 500; i += 1) tracker.record(new Error(`fel ${i}`), `rad ${i}`);

    tracker.printSummary('test');

    // 1 sammanfattningsrad + MAX_SAMPLES provrader + 1 rad om resten.
    expect(lines.length).toBeLessThanOrEqual(MAX_SAMPLES + 2);
    expect(lines.join('\n')).toContain('500 köfel');
    expect(lines.join('\n')).toContain('497 till fel inte utskrivna');
  });

  it('skriver ingenting när inget gick fel', () => {
    const { lines } = captureStderr();
    const tracker = createQueueErrorTracker();
    tracker.printSummary('test');
    expect(lines).toHaveLength(0);
  });
});

describe('createQueueErrorTracker — ärlig exitkod', () => {
  it('exit 0 när inget gick fel', () => {
    const tracker = createQueueErrorTracker();
    expect(tracker.exitCode(0)).toBe(0);
    expect(tracker.exitCode(10)).toBe(0);
  });

  it('exit 69 (transport) när inget kunde köas', () => {
    const tracker = createQueueErrorTracker();
    tracker.record(new Error('connect ECONNREFUSED 127.0.0.1:6379'), 'rad 1');
    expect(tracker.errorClass).toBe('transport');
    expect(tracker.exitCode(0)).toBe(69);
  });

  it('exit 70 (kodfel) när inget kunde köas och felet inte är ett nätverksfel', () => {
    const tracker = createQueueErrorTracker();
    tracker.record(new Error('cannot read property of undefined'), 'rad 1');
    expect(tracker.errorClass).toBe('logic');
    expect(tracker.exitCode(0)).toBe(70);
  });

  it('exit 0 när NÅGOT kunde köas — delvis lyckad körning är inte trasig', () => {
    // Kedjan läser stderr och klassar själv; här ska skriptet inte dö.
    const tracker = createQueueErrorTracker();
    tracker.record(new Error('connect ECONNREFUSED 127.0.0.1:6379'), 'rad 1');
    expect(tracker.exitCode(10)).toBe(0);
  });

  it('den värsta felklassen vinner — transport slår logic', () => {
    const tracker = createQueueErrorTracker();
    tracker.record(new Error('cannot read property of undefined'), 'rad 1');
    tracker.record(new Error('connect ECONNREFUSED 127.0.0.1:6379'), 'rad 2');
    expect(tracker.errorClass).toBe('transport');
    expect(tracker.exitCode(0)).toBe(69);
  });

  it('NEGATIV KONTROLL — en kedja av fel ska inte ge exit 0 när inget köades', () => {
    // Det gamla beteendet: 583 felrader och exit 0 = "klar".
    const tracker = createQueueErrorTracker();
    for (let i = 0; i < 100; i += 1) tracker.record(new Error('fetch failed'), `rad ${i}`);
    expect(tracker.exitCode(0)).toBe(69);
  });
});

describe('createQueueErrorTracker — feltext', () => {
  it('skriver ut felmeddelandet, inte [object Object]', () => {
    const { lines } = captureStderr();
    const tracker = createQueueErrorTracker();
    tracker.record({ code: '42501', message: 'fetch failed' }, 'rad 1');
    tracker.printSummary('test');
    expect(lines.join('\n')).toContain('fetch failed');
    expect(lines.join('\n')).not.toContain('[object Object]');
  });
});

describe('createQueueErrorTracker — DEGRADED-markören', () => {
  it('logikfel ⇒ DEGRADED (kedjan: grön med noterad försämring)', () => {
    const { lines } = captureStderr();
    const tracker = createQueueErrorTracker();
    tracker.record(new Error('cannot read property of undefined'), 'rad 1');
    tracker.printSummary('test');
    expect(lines.join('\n')).toContain('DEGRADED');
    expect(isDegradedLine(lines[0])).toBe(true);
  });

  it('transportfel ⇒ INGEN DEGRADED (kedjan ska gå röd)', () => {
    const { lines } = captureStderr();
    const tracker = createQueueErrorTracker();
    tracker.record(new Error('connect ECONNREFUSED 127.0.0.1:6379'), 'rad 1');
    tracker.printSummary('test');
    expect(lines.join('\n')).not.toContain('DEGRADED');
    expect(isDegradedLine(lines[0])).toBe(false);
  });

  it('auth-fel ⇒ INGEN DEGRADED', () => {
    const { lines } = captureStderr();
    const tracker = createQueueErrorTracker();
    tracker.record(new Error('HTTP 401 unauthorized'), 'rad 1');
    tracker.printSummary('test');
    expect(lines.join('\n')).not.toContain('DEGRADED');
  });

  it('NEGATIV KONTROLL — ett transportfel får inte döljas av DEGRADED', () => {
    // Provraderna bär feltexten som kedjan klassar. Om markören satt på
    // provraderna skulle splitDegraded lyfta bort just den texten.
    const { lines } = captureStderr();
    const tracker = createQueueErrorTracker();
    tracker.record(new Error('connect ECONNREFUSED 127.0.0.1:6379'), 'rad 1');
    tracker.printSummary('test');
    const { degraded, rest } = splitDegraded(lines.join('\n'));
    expect(degraded).toHaveLength(0);
    expect(classifyMessage(rest)).toBe('transport');
  });
});
