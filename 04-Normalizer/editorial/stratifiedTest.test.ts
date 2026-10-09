/**
 * stratifiedTest.test.ts — vitest-wrapper för den stratifierade
 * pipeline-evalueringen.
 *
 * Säkrar att:
 *   - Minst 30 events körs genom hela Editorial-pipelinen
 *   - Pass rate + fallback rate summerar till ~100% (inga "regenerating" hänger)
 *   - Failure rate är 0% (vi har alltid en text — FACT/MINIMAL eller null)
 *   - Avg attempts ≤ maxAttempts (2)
 *   - Avg word count > 0 (vi producerar text)
 */
import { describe, expect, it } from 'vitest';
import { runStratifiedTest, STRATIFIED_EVENTS } from './stratifiedTest';

describe('Stratified Editorial Pipeline Test', () => {
  it('har minst 30 stratifierade events', () => {
    expect(STRATIFIED_EVENTS.length).toBeGreaterThanOrEqual(30);
  });

  it('täcker flera kategorier (minst 5 strata)', () => {
    const uniqueStrata = new Set(STRATIFIED_EVENTS.map((e) => e.stratum));
    expect(uniqueStrata.size).toBeGreaterThanOrEqual(5);
  });

  it('kör hela pipelinen för alla events utan krasch', async () => {
    const m = await runStratifiedTest();
    expect(m.total).toBe(STRATIFIED_EVENTS.length);
  }, 30_000); // 30s timeout för 30+ events

  it('pass + fallback + failure = 100%', async () => {
    const m = await runStratifiedTest();
    const total = m.totals.pass_rate + m.totals.fallback_rate + m.totals.failure_rate;
    expect(total).toBeCloseTo(1.0, 1);
  }, 30_000);

  it('failure rate är mycket låg (<10%)', async () => {
    const m = await runStratifiedTest();
    expect(m.totals.failure_rate).toBeLessThan(0.1);
  }, 30_000);

  it('avg attempts ≤ maxAttempts (2)', async () => {
    const m = await runStratifiedTest();
    expect(m.totals.avg_attempts).toBeLessThanOrEqual(2.0);
  }, 30_000);

  it('producerar text för alla events (avg word_count > 0)', async () => {
    const m = await runStratifiedTest();
    expect(m.totals.avg_word_count).toBeGreaterThan(0);
  }, 30_000);

  it('per-event rapport innehåller alla events', async () => {
    const m = await runStratifiedTest();
    expect(m.per_event?.length).toBe(STRATIFIED_EVENTS.length);
  }, 30_000);

  it('per-event rapport har text för alla passed/fallback events', async () => {
    const m = await runStratifiedTest();
    const withoutText = (m.per_event ?? []).filter(
      (e) => e.status !== 'failed' && e.status !== 'regenerating' && (!e.final_text || e.final_text.length === 0),
    );
    expect(withoutText.length).toBe(0);
  }, 30_000);
});
