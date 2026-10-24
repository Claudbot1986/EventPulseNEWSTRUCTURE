/**
 * Klassificering av nollradskällor — 2026-10-25.
 *
 * Censusen ska skilja på "fastnar" och "verifierat tom". Går den inte att
 * göra, är listan operatören jobbar ifrån antingen tom eller full av
 * falska larm — båda lika dåliga.
 *
 * Negativa kontroller: en ofullständig audit räknas INTE som audit. Ett
 * tomt fält är lika bra som inget — annars kan metadata som fyllts i av
 * en halvfärdig genomlöpning dölja en trasig källa.
 */

import { describe, it, expect } from 'vitest';
import { isVerifiedEmptySource, classifyZeroRowSource } from './sourceAudit.mjs';

const FULL_AUDIT = {
  audit_status: 'adapter_wired',
  audit_reason: 'säsong_slut',
  audit_evidence: 'Mätt 2026-10-24: /api/concerts ger 331 rader, alla i det förflutna.',
};

describe('isVerifiedEmptySource', () => {
  it('en fullständig audit räknas som verifierad', () => {
    expect(isVerifiedEmptySource(FULL_AUDIT)).toBe(true);
  });

  it('NEGATIV KONTROLL — saknad audit_evidence är inte en audit', () => {
    expect(isVerifiedEmptySource({ audit_status: 'adapter', audit_reason: 'x' })).toBe(false);
  });

  it('NEGATIV KONTROLL — saknad audit_reason är inte en audit', () => {
    expect(isVerifiedEmptySource({ audit_status: 'adapter', audit_evidence: 'x' })).toBe(false);
  });

  it('NEGATIV KONTROLL — saknad audit_status är inte en audit', () => {
    expect(isVerifiedEmptySource({ audit_reason: 'x', audit_evidence: 'x' })).toBe(false);
  });

  it('NEGATIV KONTROLL — tomma fält är inte en audit', () => {
    expect(
      isVerifiedEmptySource({ audit_status: '', audit_reason: '', audit_evidence: '' }),
    ).toBe(false);
  });

  it('NEGATIV KONTROLL — saknad metadata allsihär inte verifierad', () => {
    expect(isVerifiedEmptySource(undefined)).toBe(false);
    expect(isVerifiedEmptySource(null)).toBe(false);
    expect(isVerifiedEmptySource({})).toBe(false);
  });
});

describe('classifyZeroRowSource', () => {
  it('en fullständig audit ger verifierat-tom och auditen medföljer', () => {
    const r = classifyZeroRowSource({ id: 'x', metadata: FULL_AUDIT });
    expect(r.state).toBe('verifierat-tom');
    expect(r.audit?.status).toBe('adapter_wired');
    expect(r.audit?.reason).toBe('säsong_slut');
  });

  it('NEGATIV KONTROLL — en källa utan audit ger fastnar', () => {
    const r = classifyZeroRowSource({ id: 'x', metadata: { httpStatus: 200 } });
    expect(r.state).toBe('fastnar');
    expect(r.audit).toBeNull();
  });

  it('NEGATIV KONTROLL — en källa utan metadata alls ger fastnar', () => {
    expect(classifyZeroRowSource({ id: 'x' }).state).toBe('fastnar');
  });
});
