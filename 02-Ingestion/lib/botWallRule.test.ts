import { describe, it, expect } from 'vitest';
import { detectBotWall } from './botWallRule';

/**
 * Bot-vägg-regeln (2026-10-24).
 *
 * Negativ kontroll: 404 och 5xx får INTE räknas som bot-vägg — där är felet
 * verkligt och källan ska begravas, inte routas till D-renderGate.
 */

describe('detectBotWall', () => {
  it('känner igen klient-blockeringar', () => {
    expect(detectBotWall('HTTP 401')).toBe(401);
    expect(detectBotWall('HTTP 403')).toBe(403);
    expect(detectBotWall('HTTP 406')).toBe(406);
    expect(detectBotWall('HTTP 429')).toBe(429);
  });

  it('känner igen blockeringen när den är inbäddad i ett längre meddelande', () => {
    expect(detectBotWall('fetchHtml failed: HTTP 429')).toBe(429);
    expect(detectBotWall('fetch failed: HTTP 403')).toBe(403);
    expect(detectBotWall('Fetch failed: HTTP 429')).toBe(429);
  });

  it('NEGATIV KONTROLL — 404 är ett verkligt fel, inte en bot-vägg', () => {
    expect(detectBotWall('HTTP 404')).toBeNull();
  });

  it('NEGATIV KONTROLL — 5xx är serverns fel, inte en bot-vägg', () => {
    expect(detectBotWall('HTTP 500')).toBeNull();
    expect(detectBotWall('HTTP 503')).toBeNull();
  });

  it('NEGATIV KONTROLL — nätverksfel och tomma fel är inte bot-väggar', () => {
    expect(detectBotWall('timeout of 15000ms exceeded')).toBeNull();
    expect(detectBotWall('getaddrinfo ENOTFOUND')).toBeNull();
    expect(detectBotWall('')).toBeNull();
    expect(detectBotWall(undefined)).toBeNull();
    expect(detectBotWall(null)).toBeNull();
  });
});
