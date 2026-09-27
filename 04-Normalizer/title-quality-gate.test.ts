import { describe, it, expect } from 'vitest';
import { evaluateTitle, checkBlockB, _resetBlockB } from './title-quality-gate';

describe('evaluateTitle', () => {
  describe('rejects', () => {
    it('empty / whitespace', () => {
      expect(evaluateTitle('', 'billetto').ok).toBe(false);
      expect(evaluateTitle('   ', 'billetto').ok).toBe(false);
      expect(evaluateTitle(undefined, 'billetto').ok).toBe(false);
    });
    it('too short (< 3 chars)', () => {
      expect(evaluateTitle('ab', 'billetto').ok).toBe(false);
      expect(evaluateTitle('x', 'billetto').ok).toBe(false);
    });
    it('placeholder text', () => {
      expect(evaluateTitle('TBD', 'billetto').ok).toBe(false);
      expect(evaluateTitle('Coming soon', 'billetto').ok).toBe(false);
      expect(evaluateTitle('TODO', 'billetto').ok).toBe(false);
      expect(evaluateTitle('Placeholder', 'billetto').ok).toBe(false);
      expect(evaluateTitle('Test', 'billetto').ok).toBe(false);
      expect(evaluateTitle('Lorem ipsum', 'billetto').ok).toBe(false);
      expect(evaluateTitle('Untitled', 'billetto').ok).toBe(false);
      expect(evaluateTitle('Okänd', 'billetto').ok).toBe(false);
    });
    it('pure punctuation', () => {
      expect(evaluateTitle('...', 'billetto').ok).toBe(false);
      expect(evaluateTitle('— —', 'billetto').ok).toBe(false);
      expect(evaluateTitle('###', 'billetto').ok).toBe(false);
    });
    it('date-only', () => {
      expect(evaluateTitle('2026-09-27', 'billetto').ok).toBe(false);
      expect(evaluateTitle('27/9 2026', 'billetto').ok).toBe(false);
      expect(evaluateTitle('27.09.2026', 'billetto').ok).toBe(false);
    });
    it('title equals source id (case-insensitive, dash variants)', () => {
      expect(evaluateTitle('Folkoperan', 'folkoperan').ok).toBe(false);
      expect(evaluateTitle('Folkoperan', 'Folkoperan').ok).toBe(false);
      expect(evaluateTitle('billetto stockholm', 'billetto-stockholm').ok).toBe(false);
      expect(evaluateTitle('billetto', 'billetto').ok).toBe(false);
    });
    it('title equals a single token of hyphenated source id', () => {
      // source="billetto-stockholm", title="billetto" — page-title leak from
      // a billetto subdomain that doesn't set its own title.
      expect(evaluateTitle('billetto', 'billetto-stockholm').ok).toBe(false);
      expect(evaluateTitle('stockholm', 'billetto-stockholm').ok).toBe(false);
    });
  });

  describe('accepts', () => {
    it('real show titles', () => {
      const cases: Array<[string, string]> = [
        ['Nietzsche kontra Wagner', 'folkoperan'],
        ['Die Stadt ohne Juden', 'folkoperan'],
        ['Jag är Ulla Winblad', 'folkoperan'],
        ['Café & opera – gala', 'folkoperan'],
        ['SOMMART 2026', 'billetto'],
        ['Kodak Black', 'billetto'],
        ['Opeth', 'billetto'],
      ];
      for (const [title, source] of cases) {
        const r = evaluateTitle(title, source);
        expect(r.ok, `expected "${title}" to pass for source="${source}"; reason=${r.reason ?? 'none'}`).toBe(true);
      }
    });
    it('titles containing source name as substring are still real titles', () => {
      // "Folkoperan Foajé: Carmen med jazztrio och berättare" — "Folkoperan" appears
      // as a real sub-venue identifier, not a generic page title. Must NOT be rejected.
      const r = evaluateTitle('Folkoperan Foajé: Carmen med jazztrio och berättare', 'folkoperan');
      expect(r.ok).toBe(true);
      const r2 = evaluateTitle('La Bohème (Folkoperan Talang)', 'folkoperan');
      expect(r2.ok).toBe(true);
    });
    it('short but valid titles pass', () => {
      // 3-char titles aren't always bad — e.g. "ABBA", "MAM"
      expect(evaluateTitle('ABBA', 'billetto').ok).toBe(true);
      expect(evaluateTitle('Pixies', 'billetto').ok).toBe(true);
    });
    it('returns normalised form for logging on success', () => {
      const r = evaluateTitle('  Nietzsche kontra Wagner  ', 'folkoperan');
      expect(r.ok).toBe(true);
      expect(r.normalised).toBe('nietzsche kontra wagner');
    });
    it('returns reason on rejection', () => {
      const r = evaluateTitle('Folkoperan', 'folkoperan');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('title-equals-source');
    });
  });

  describe('checkBlockB (bulk-pollution detector)', () => {
    it('accepts first occurrences', () => {
      _resetBlockB();
      const r = checkBlockB('Konsert i parken', 'billetto');
      expect(r.ok).toBe(true);
      expect(r.count).toBe(1);
      expect(r.rejected).toBe(false);
    });

    it('counts repeats and rejects past the threshold', () => {
      _resetBlockB();
      // 49 should pass
      for (let i = 0; i < 49; i++) {
        const r = checkBlockB('Spam konsert', 'spammy');
        expect(r.ok).toBe(true);
        expect(r.rejected).toBe(false);
      }
      // 50th must reject
      const r50 = checkBlockB('Spam konsert', 'spammy');
      expect(r50.ok).toBe(false);
      expect(r50.count).toBe(50);
      expect(r50.rejected).toBe(true);
    });

    it('tracks each (source, title) pair independently', () => {
      _resetBlockB();
      // Same title, different source — both should pass without interference
      for (let i = 0; i < 30; i++) {
        expect(checkBlockB('Shared title', 'source-a').ok).toBe(true);
        expect(checkBlockB('Shared title', 'source-b').ok).toBe(true);
      }
      _resetBlockB();
    });

    it('reset clears all counters', () => {
      _resetBlockB();
      for (let i = 0; i < 49; i++) checkBlockB('Foo', 'bar');
      _resetBlockB();
      expect(checkBlockB('Foo', 'bar').count).toBe(1);
    });
  });
});