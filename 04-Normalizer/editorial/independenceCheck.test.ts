/**
 * independenceCheck.test.ts — semantisk jämförelse draft vs source.
 *
 * Uppdaterad 2026-10-08 för nya independence-algoritmen som:
 *   - Tillåter factual terms (artist-namn, venues, genrer, "50-årsjubileum",
 *     "turné", "bandet", "konsert", "scen", etc.) att förekomma i båda.
 *   - Flaggar bara creative phrase overlap (≥3 content-ord i rad) som
 *     inte är Profile-fakta.
 */
import { describe, expect, it } from 'vitest';
import { checkIndependence, DEFAULT_SIMILARITY_THRESHOLD } from './independenceCheck';
import type { EditorialDraft, EventProfile } from './types';

function mkDraft(text: string): EditorialDraft {
  return {
    text,
    word_count: text.split(/\s+/).length,
    info_level: 'MEDIUM',
    meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
  };
}

const profileBase: EventProfile = {
  event_type: 'music',
  performers: ['Hooligan Bobs'],
  genres: ['rock'],
  content: ['låtar'],
  experience_characteristics: ['live'],
  setting: 'klubb',
  language: ['sv'],
  provenance: {},
};

describe('checkIndependence — semantisk kontroll', () => {
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
  });

  it('PASS när draft upprepar artist-namn + fakta-ord (HAWK-exemplet)', () => {
    // Reproducerar HAWK-fallet som tidigare felaktigt failade.
    const draft = mkDraft('Hawk on Flight firar sitt 50-årsjubileum med en turné som stannar till på Makeriet i Stockholm. Kvällen samlar bandet i en gemensam konsertupplevelse med fokus på gemenskap och musik.');
    const source = `<p>HAWK ON FLIGHT – 50-ÅRSJUBILEUMSTURNÉ 2026</p>
<p>Hawk On Flight bildades 1976 och firar 50 år som ett av Sveriges mest långlivade jazzrock/fusionband. Under hösten 2026 ger sig bandet ut på en efterlängtad 50-årsjubileumsturné. Basist och primus motor Matz Nilsson har varit med sedan starten.</p>`;
    const profile: EventProfile = {
      ...profileBase,
      performers: ['Hawk on Flight'],
      tour: '50-årsjubileumsturné 2026',
      experience_characteristics: ['gemensam konsertupplevelse', 'gemenskap', 'musik'],
    };
    const r = checkIndependence({
      draft,
      sourceDescription: source,
      profile,
      event: { title: 'HAWK ON FLIGHT', venue_name: 'Makeriet', city: 'Stockholm' },
    });
    // "hawk on flight" är artist-namn (Profile.performers) → skyddad
    // "50-årsjubileum" och "turné" är factual vocabulary → skyddad
    // "bandet" är pronomen → skyddad
    // "gemensam konsertupplevelse" är från experience_characteristics → skyddad
    expect(r.pass).toBe(true);
    expect(r.matched_phrases).toEqual([]);
  });

  it('FAIL när draft kopierar en längre kreativ fras från source (content-Jaccard)', () => {
    // Phrase som INTE är i PROTECTED_VOCABULARY och inte i Profile.
    const source = 'Konserthuset bjuder in till en afton med raffinerade smakprov från det franska köket.';
    const draft = mkDraft('Konserthuset bjuder in till en afton med raffinerade smakprov från det franska köket.');
    const r = checkIndependence({ draft, sourceDescription: source });
    // Identical text → Jaccard similarity 1.0 → fail
    expect(r.pass).toBe(false);
    expect(r.max_similarity).toBeGreaterThan(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it('FAIL när draft är parafras med hög content-likhet', () => {
    const source = 'Stråkar och piano fyller salen med vemodig vinterstämning. Konserten öppnar med ett stilla adagio.';
    const draft = mkDraft('Stråkar och piano fyller hela rummet med vemodig vinterstämning. Konserten öppnar med ett stilla adagio.');
    const r = checkIndependence({ draft, sourceDescription: source });
    // Tunga content-ord delas (stråkar, piano, fyller, vemodig, vinterstämning,
    // konserten, öppnar, stilla, adagio) — similarity > 0.5 → fail
    expect(r.pass).toBe(false);
    expect(r.max_similarity).toBeGreaterThan(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it('max_similarity avrundas till 3 decimaler', () => {
    const r = checkIndependence({
      draft: mkDraft('Helt andra ord som inte finns i källan alls.'),
      sourceDescription: 'Konsert med artister på en scen i Stockholm.',
    });
    expect(Number.isInteger(r.max_similarity * 1000)).toBe(true);
  });

  it('PASS för ren faktarepetition (artister, datum, support)', () => {
    // Realistiskt editorial-citat: en parafraserad konserttext.
    const source = `Hooligan Bobs spelar på Debaser den 14 november.
Support: The Strokes. Genre: rock. Biljett från 200 kr. Konsertlokal med bar.`;
    const draft = mkDraft('Hooligan Bobs intar Debaser för en rockkonsert. Med support från The Strokes och 200 kr i entré blir kvällen ett måste för den lokala rockscenen.');
    const profile: EventProfile = {
      ...profileBase,
      performers: ['Hooligan Bobs', 'The Strokes'],
    };
    const r = checkIndependence({
      draft,
      sourceDescription: source,
      profile,
      event: { title: 'Hooligan Bobs', venue_name: 'Debaser' },
    });
    expect(r.pass).toBe(true);
  });
});
