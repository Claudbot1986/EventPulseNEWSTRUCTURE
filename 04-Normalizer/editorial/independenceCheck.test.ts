/**
 * independenceCheck.test.ts — verifierar likhets-detektering.
 */
import { describe, expect, it } from 'vitest';
import { checkIndependence, DEFAULT_SIMILARITY_THRESHOLD } from './independenceCheck';
import type { EditorialDraft } from './types';

function mkDraft(text: string): EditorialDraft {
  return {
    text,
    word_count: text.split(/\s+/).length,
    info_level: 'MEDIUM',
    meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
  };
}

describe('checkIndependence', () => {
  it('PASS om source är tom', () => {
    const r = checkIndependence({
      draft: mkDraft('En kort beskrivning av eventet.'),
      sourceDescription: null,
    });
    expect(r.pass).toBe(true);
    expect(r.max_similarity).toBe(0);
  });

  it('PASS när draft är substantiellt olik source', () => {
    const r = checkIndependence({
      draft: mkDraft('En kväll med levande toner och stämningsfull belysning.'),
      sourceDescription:
        'Vi på Konserthuset är glada att välkomna artister från hela världen till vår årliga festival med mat och dryck.',
    });
    expect(r.pass).toBe(true);
    expect(r.max_similarity).toBeLessThan(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it('FAIL när draft kopierar 4+ ord i rad från source', () => {
    const r = checkIndependence({
      draft: mkDraft(
        'Konserthuset är glada att välkomna artister från hela världen. Kvällen blir magisk.',
      ),
      sourceDescription:
        'Vi på Konserthuset är glada att välkomna artister från hela världen till vår årliga festival.',
    });
    expect(r.pass).toBe(false);
    expect(r.matched_phrases.length).toBeGreaterThan(0);
    expect(r.matched_phrases.some((p) => p.includes('konserthuset är glada'))).toBe(true);
  });

  it('FAIL när draft är parafras med hög unigram-likhet', () => {
    const source = 'Klassisk konsert med stråkar och piano. Kvällen bjuder på verk av Bach och Mozart.';
    const draft = 'Klassisk konsert med stråkar och piano. Kvällen bjuder på fina verk.';
    const r = checkIndependence({
      draft: mkDraft(draft),
      sourceDescription: source,
    });
    expect(r.matched_phrases.length).toBeGreaterThan(0);
  });

  it('max_similarity avrundas till 3 decimaler', () => {
    const r = checkIndependence({
      draft: mkDraft('Helt andra ord som inte finns i källan alls.'),
      sourceDescription: 'Konsert med artister på en scen i Stockholm.',
    });
    expect(Number.isInteger(r.max_similarity * 1000)).toBe(true);
  });
});