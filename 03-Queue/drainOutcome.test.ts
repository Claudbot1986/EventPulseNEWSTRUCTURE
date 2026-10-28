/**
 * drainOutcome.test.ts — avslutandets regler för dräneringen.
 *
 * Negativa kontroller:
 *   - tom kö + 0 fel → exit 0, ledger får flippa
 *   - terminala fel → exit 69/77/70, och ledger får bara flippa de
 *     källor som faktiskt täcks (täckningen prövas i markPersisted)
 *   - kön inte tom (maxMs/SIGTERM) → exit 75, ledger får INTE flippa
 *   - ett enda terminalt fel bland 5 000 → kedjan får INTE se grön ut
 */

import { describe, it, expect } from 'vitest';
import { drainOutcome } from './drainOutcome.mjs';

describe('drainOutcome — avslutande', () => {
  it('tom kö, inga fel → exit 0 och ledger får flippa', () => {
    const o = drainOutcome({ queueEmpty: true, terminalFailures: 0 });
    expect(o.exitCode).toBe(0);
    expect(o.ledgerEligible).toBe(true);
  });

  it('kön INTE tom → exit 75 (EX_TEMPFAIL), ledger får inte flippa', () => {
    // Avslutades på maxMs eller SIGTERM: dräneringen är ofullständig och
    // ska köras igen. exit 0 vore en lögn.
    const o = drainOutcome({ queueEmpty: false, terminalFailures: 0 });
    expect(o.exitCode).toBe(75);
    expect(o.ledgerEligible).toBe(false);
  });

  it('ett enda terminalt fel → inte exit 0', () => {
    // 5 000 jobb, varav ett dog slutligt. Kedjan ska se det.
    const o = drainOutcome({ queueEmpty: true, terminalFailures: 1, errorClass: 'logic' });
    expect(o.exitCode).not.toBe(0);
    expect(o.exitCode).toBe(70);
  });

  it('terminala transportfel → exit 69', () => {
    const o = drainOutcome({ queueEmpty: true, terminalFailures: 4, errorClass: 'transport' });
    expect(o.exitCode).toBe(69);
  });

  it('terminala auth-fel → exit 77', () => {
    const o = drainOutcome({ queueEmpty: true, terminalFailures: 2, errorClass: 'auth' });
    expect(o.exitCode).toBe(77);
  });

  it('terminala fel → ledger får flippa, men bara de källor som täcks', () => {
    // 2026-10-28 — det globala villkoret "ledger får INTE flippa vid
    // misslyckanden" togs BORT. Det höll hela importen från att någons
    // bli 'persisted', så varje natt importerades samma ~5 000 jobb igen
    // — samma symptom som den ursprungliga buggen.
    //
    // Beviset ligger i stället PER KÄLLA: markPersisted() flippar bara
    // de rader vars körda jobb täcker det importeraren köade. En källa med
    // ett terminalt misslyckat jobb täcker INTE sitt antal och stannar i
    // 'queued' → den importeras om. Se importLedger.test.ts.
    const o = drainOutcome({ queueEmpty: true, terminalFailures: 1, errorClass: 'logic' });
    expect(o.ledgerEligible).toBe(true);
  });

  it('NEGATIV KONTROLL — 0 misslyckade + tom kö får INTE ge 75', () => {
    const o = drainOutcome({ queueEmpty: true, terminalFailures: 0 });
    expect(o.exitCode).not.toBe(75);
    expect(o.exitCode).not.toBe(69);
    expect(o.exitCode).not.toBe(77);
  });

  it('NEGATIV KONTROLL — kön inte tom + 0 fel ger INTE exit 0', () => {
    const o = drainOutcome({ queueEmpty: false, terminalFailures: 0 });
    expect(o.exitCode).not.toBe(0);
  });

  it('terminala fel vinner över "kön inte tom" (alltid fel, inte tempfail)', () => {
    const o = drainOutcome({ queueEmpty: false, terminalFailures: 3, errorClass: 'transport' });
    expect(o.exitCode).toBe(69);
    expect(o.ledgerEligible).toBe(false);
  });

  it('undefined terminalFailures räknas som 0 (ingen krasch)', () => {
    const o = drainOutcome({ queueEmpty: true });
    expect(o.exitCode).toBe(0);
    expect(o.ledgerEligible).toBe(true);
  });
});
