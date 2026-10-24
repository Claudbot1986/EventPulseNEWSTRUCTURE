import { describe, it, expect } from 'vitest';
import { classifyRoutingHandoff } from './handoffRule';

describe('A-gatens handoff-regel', () => {
  it('behandlar "sidan svarade men saknar JSON-LD" som handoff', () => {
    expect(classifyRoutingHandoff(false, 'no-jsonld-or-no-events')).toBe(true);
  });

  it('behandlar bot-vägg som handoff — sajten lever, plain HTTP vägras', () => {
    // Mätt 2026-10-24: momentsapp.no svarade 429 fem gånger i A-gaten och
    // blev auto-karantänad, samtidigt som D-gatens browser hämtade samma
    // sida med 1 904 events. Bot-väggen är inte ett fel.
    expect(classifyRoutingHandoff(false, 'Fetch failed: HTTP 429')).toBe(true);
    expect(classifyRoutingHandoff(false, 'Fetch failed: HTTP 403')).toBe(true);
    expect(classifyRoutingHandoff(false, 'Fetch failed: HTTP 401')).toBe(true);
    expect(classifyRoutingHandoff(false, 'Fetch failed: HTTP 406')).toBe(true);
  });

  it('behandlar transportfel som fel, inte handoff', () => {
    const transportErrors = [
      'Fetch failed: HTTP 404',
      'Fetch failed: timeout of 20000ms exceeded',
      'Fetch failed: Hostname/IP does not match certificate',
      'Fetch failed: getaddrinfo ENOTFOUND example.se',
      "adapter 'confetti' finns inte i registret",
      "adapter 'confetti' kastade: boom",
      'source not found in sources/',
    ];
    for (const error of transportErrors) {
      expect(classifyRoutingHandoff(false, error), error).toBe(false);
    }
  });

  it('NEGATIV KONTROLL — 404 och 5xx är inte bot-väggar', () => {
    //Serverfel är verkliga fel — källan ska kunna begravas.
    expect(classifyRoutingHandoff(false, 'Fetch failed: HTTP 404')).toBe(false);
    expect(classifyRoutingHandoff(false, 'Fetch failed: HTTP 500')).toBe(false);
    expect(classifyRoutingHandoff(false, 'Fetch failed: HTTP 503')).toBe(false);
  });

  it('behandlar framgång som inte-handoff', () => {
    expect(classifyRoutingHandoff(true, undefined)).toBe(false);
    expect(classifyRoutingHandoff(true, 'no-jsonld-or-no-events')).toBe(false);
  });

  it('behandlar en tom felsträng som inte-handoff', () => {
    // Utan felmeddelande vet vi inte om det är routing eller fel — antag fel,
    // så att källan kan begravas.
    expect(classifyRoutingHandoff(false, undefined)).toBe(false);
    expect(classifyRoutingHandoff(false, '')).toBe(false);
  });
});
