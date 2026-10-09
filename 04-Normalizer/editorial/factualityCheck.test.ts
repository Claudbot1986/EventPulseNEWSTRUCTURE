/**
 * factualityCheck.test.ts — verifierar claim-by-claim factuality-kontroll.
 *
 * Uppdaterad 2026-10-08 för nya extractClaims() som fångar substantiella
 * substantiv/adjektiv (inte bara kapitaliserade fraser). Testerna fokuserar
 * på claim-evidence-mappning med tydliga SUPPORTED/INFERRED/UNSUPPORTED.
 */
import { describe, expect, it } from 'vitest';
import { checkFactuality, extractClaims, __test__ } from './factualityCheck';
import type { EditorialDraft, EventProfile } from './types';

const baseProfile: EventProfile = {
  event_type: 'music',
  performers: ['Hooligan Bobs'],
  genres: ['rock'],
  content: ['låtar'],
  experience_characteristics: ['live band', 'publikrespons'],
  setting: 'klubb',
  language: ['sv'],
  provenance: { event_type: 'category:music' },
};

const baseEvent = {
  title: 'Hooligan Bobs på Debaser',
  venue_name: 'Debaser',
  city: 'Stockholm',
  category_slug: 'music',
};

function mkDraft(text: string): EditorialDraft {
  return {
    text,
    word_count: text.split(/\s+/).length,
    info_level: 'MEDIUM',
    meta: { model: 'mock', prompt_version: 'v1', generated_at: new Date().toISOString() },
  };
}

describe('extractClaims', () => {
  it('extraherar innehållsbärande substantiv', () => {
    const claims = extractClaims('Hooligan Bobs spelar rock på Debaser ikväll.');
    expect(claims).toContain('hooligan');
    expect(claims).toContain('bobs');
    expect(claims).toContain('rock');
    expect(claims).toContain('debaser');
  });

  it('extraherar adjektiv-substantiv-fraser', () => {
    // "intim" och "svängig" är stilistiska adjektiv — filtreras bort ensamma.
    // Men de kan ingå i 2-ordsfraser med ett substantiv.
    const claims = extractClaims('En intim kväll med svängig rock.');
    // 'rock' är en content-claim (genre), ska finnas
    expect(claims).toContain('rock');
    // 2-ordsfras 'svängig rock' ska finnas (adj + substantiv)
    expect(claims).toContain('svängig rock');
  });

  it('filtrerar bort stopwords (i, och, det)', () => {
    const claims = extractClaims('Hooligan Bobs och publiken på Debaser.');
    expect(claims).not.toContain('och');
    expect(claims).not.toContain('på');
  });

  it('extraherar artistnamn (kapitaliserad)', () => {
    const claims = extractClaims('Hooligan Bobs bjuder på rock ikväll.');
    expect(claims.some((c) => c.includes('hooligan bobs'))).toBe(true);
  });

  it('extraherar siffror med enhet', () => {
    const claims = extractClaims('Ett set på 90 min följt av 200 kr i entré.');
    expect(claims.some((c) => /90 min/i.test(c))).toBe(true);
    expect(claims.some((c) => /200 kr/i.test(c))).toBe(true);
  });

  it('fångar "lokalt förankrat innehåll" som claim (substantiellt)', () => {
    // Reproducerar Muuto-fallet
    const claims = extractClaims('Ett evenemang med lokalt förankrat innehåll för en lokal publik.');
    expect(claims.some((c) => c.includes('lokalt förankrat'))).toBe(true);
    expect(claims.some((c) => c.includes('förankrat innehåll'))).toBe(true);
  });

  it('fångar "community", "samhörighet", "intim miljö" som claims', () => {
    // Reproducerar FARVEBLIND-fallet
    const claims = extractClaims('En kväll med fokus på community och samhörighet i en intim miljö.');
    expect(claims.some((c) => c.includes('community'))).toBe(true);
    expect(claims.some((c) => c.includes('samhörighet'))).toBe(true);
    expect(claims.some((c) => c.includes('intim'))).toBe(true);
  });
});

describe('checkFactuality — claim-by-claim evidensmappning', () => {
  it('PASS om alla claims stöds av Profile', () => {
    const draft = mkDraft('Hooligan Bobs spelar rock på Debaser ikväll.');
    const r = checkFactuality({ draft, profile: baseProfile, event: baseEvent });
    expect(r.pass).toBe(true);
    expect(r.unsupported_claims).toEqual([]);
  });

  it('PASS med stämningsord som INFERRED (genre härleder intim-stämning)', () => {
    // "magisk" är stilord → inte claim alls.
    const draft = mkDraft('En magisk kväll med Hooligan Bobs på Debaser.');
    const r = checkFactuality({ draft, profile: baseProfile, event: baseEvent });
    expect(r.pass).toBe(true);
  });

  it('PASS för "rock" som claim när genre finns i Profile', () => {
    const draft = mkDraft('Rock-kvällen bjuder på Hooligan Bobs i ett live-framförande.');
    const r = checkFactuality({ draft, profile: baseProfile, event: baseEvent });
    expect(r.pass).toBe(true);
  });

  it('FAIL om draft nämner artist som inte finns i Profile', () => {
    const draft = mkDraft('Hooligan Bobs delar scen med The Strokes ikväll.');
    const r = checkFactuality({ draft, profile: baseProfile, event: baseEvent });
    expect(r.pass).toBe(false);
    expect(r.unsupported_claims.some((c) => c.includes('strokes'))).toBe(true);
  });

  it('FAIL på "community" om Profile saknar stöd (FARVEBLIND-fallet)', () => {
    // Reproducerar FARVEBLIND-originalcitatet där "community" INTE är i Profile.
    const profileFARVEBLIND: EventProfile = {
      ...baseProfile,
      performers: ['FARVEBLIND'],
      genres: [],
    };
    const draft = mkDraft('En kväll med fokus på community och samhörighet i en intim miljö.');
    const r = checkFactuality({ draft, profile: profileFARVEBLIND, event: { ...baseEvent, title: 'FARVEBLIND' } });
    expect(r.pass).toBe(false);
    // 'community' ska vara UNSUPPORTED (inte i Profile)
    expect(r.unsupported_claims.some((c) => c.includes('community'))).toBe(true);
    // 'samhörighet' ska vara UNSUPPORTED
    expect(r.unsupported_claims.some((c) => c.includes('samhörighet'))).toBe(true);
  });

  it('FAIL på "lokalt förankrat" om Profile saknar stöd (Muuto-fallet)', () => {
    // Reproducerar Muuto-originalcitatet.
    const profileMuuto: EventProfile = {
      event_type: 'community',
      performers: ['Muuto 20Y Anniversary', 'Svenssons'],
      genres: [],
      content: ['lokalt program'],
      experience_characteristics: ['lokalt'],
      setting: 'lokal',
      language: ['sv'],
      provenance: { event_type: 'category:community' },
    };
    const draft = mkDraft('Ett öppet kvällsprogram med lokalt förankrat innehåll för varierad medverkan under två timmar.');
    const r = checkFactuality({ draft, profile: profileMuuto, event: { ...baseEvent, title: 'Muuto' } });
    expect(r.pass).toBe(false);
    // 'förankrat' (del av "lokalt förankrat") är inte stödjt — bara 'lokalt' finns
    // som experience_characteristics, men 'lokalt förankrat innehåll' är inte en fras i Profile.
    expect(r.unsupported_claims.some((c) => c.includes('förankrat'))).toBe(true);
  });

  it('ACCEPT "konsert" som INFERRED (music-category)', () => {
    const draft = mkDraft('Hooligan Bobs ger konsert ikväll.');
    const r = checkFactuality({ draft, profile: baseProfile, event: baseEvent });
    // 'konsert' är INFERRED (music → konsert)
    expect(r.pass).toBe(true);
    expect(r.inferred_claims?.some((c) => c.includes('konsert'))).toBe(true);
  });

  it('ger detaljer per claim med evidensfält', () => {
    const draft = mkDraft('Hooligan Bobs spelar rock på Debaser.');
    const r = checkFactuality({ draft, profile: baseProfile, event: baseEvent });
    expect(r.details).toBeDefined();
    expect(r.details!.length).toBeGreaterThan(0);
    const hooliganClaim = r.details!.find((d) => d.claim.includes('hooligan'));
    expect(hooliganClaim).toBeDefined();
    expect(hooliganClaim!.status).toBe('SUPPORTED');
    expect(hooliganClaim!.evidence.length).toBeGreaterThan(0);
  });
});

describe('__test__ helpers', () => {
  it('STYLISTIC_ADJECTIVES innehåller "intim"', () => {
    expect(__test__.STYLISTIC_ADJECTIVES.has('intim')).toBe(true);
  });

  it('STYLISTIC_ADJECTIVES innehåller "gemensam"', () => {
    expect(__test__.STYLISTIC_ADJECTIVES.has('gemensam')).toBe(true);
  });

  it('isStylisticOrCommon("community") är false (community ÄR en claim)', () => {
    expect(__test__.isStylisticOrCommon('community')).toBe(false);
  });

  it('isStylisticOrCommon("intim") är true (intim ÄR stilord)', () => {
    expect(__test__.isStylisticOrCommon('intim')).toBe(true);
  });
});

describe('checkFactuality — normalization av format (P7 2026-10-08)', () => {
  it('PASS: "2 tim 10 min" stöds av Profile med duration_minutes: 130', () => {
    const profile: EventProfile = {
      ...baseProfile,
      duration_minutes: 130,
    };
    const draft = mkDraft('En konsert som varar i 2 tim 10 min.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    expect(r.pass).toBe(true);
  });

  it('PASS: "2 timmar och 10 minuter" stöds av Profile med duration_minutes: 130', () => {
    const profile: EventProfile = {
      ...baseProfile,
      duration_minutes: 130,
    };
    // [FAS 5 2026-10-08] "lång" borttagen — testet ska inte längre lita på att
    // "lång" slinker igenom som stilistiskt. Använd "länge" i stället.
    const draft = mkDraft('Föreställningen varar 2 timmar och 10 minuter.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    expect(r.pass).toBe(true);
  });

  it('PASS: "kl 19" stöds av event.start_time "2026-10-08T19:00:00+02:00"', () => {
    const draft = mkDraft('Konserten börjar kl 19 på Debaser.');
    const r = checkFactuality({
      draft,
      profile: baseProfile,
      event: { ...baseEvent, start_time: '2026-10-08T19:00:00+02:00' },
    });
    expect(r.pass).toBe(true);
  });

  it('PASS: "250:-" stöds av event.price_min_sek: 250', () => {
    const draft = mkDraft('Inträde 250:- på Debaser ikväll.');
    const r = checkFactuality({
      draft,
      profile: baseProfile,
      event: { ...baseEvent, price_min_sek: 250 },
    });
    expect(r.pass).toBe(true);
  });

  it('PASS: "250 kronor" stöds av event.price_min_sek: 250', () => {
    const draft = mkDraft('Biljetter kostar 250 kronor.');
    const r = checkFactuality({
      draft,
      profile: baseProfile,
      event: { ...baseEvent, price_min_sek: 250 },
    });
    expect(r.pass).toBe(true);
  });

  it('PASS: "8 oktober" stöds av event.start_time med rätt datum', () => {
    const draft = mkDraft('Konserten äger rum 8 oktober på Debaser.');
    const r = checkFactuality({
      draft,
      profile: baseProfile,
      event: { ...baseEvent, start_time: '2026-10-08T19:00:00+02:00' },
    });
    expect(r.pass).toBe(true);
  });

  it('PASS: "Beethoven" stöds av performer "Ludwig van Beethoven"', () => {
    const profile: EventProfile = {
      ...baseProfile,
      performers: ['Ludwig van Beethoven'],
    };
    const draft = mkDraft('Beethoven spelar på Debaser ikväll.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    expect(r.pass).toBe(true);
  });

  it('PASS: "95 musiker" stöds av content "95 musiker" (number+unit)', () => {
    const profile: EventProfile = {
      ...baseProfile,
      content: ['95 musiker'],
    };
    const draft = mkDraft('En orkester med 95 musiker intar scenen.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    expect(r.pass).toBe(true);
  });
});

describe('checkFactuality — performer_metadata (FAS 3.1, 2026-10-09)', () => {
  it('PASS "kanadensiska" när Profile.performer_metadata.country=CA (Donovan Woods-fallet)', () => {
    // Donovan Woods-fallet: striktare Writer V2 prompt tenderar att skriva
    // "kanadensiska singer-songwriter Donovan Woods" — utan gazetteer-data
    // är "kanadensiska" UNSUPPORTED. Med performer_metadata.country=CA
    // blir claim:en SUPPORTED.
    const profile: EventProfile = {
      ...baseProfile,
      performers: ['Donovan Woods'],
      performer_metadata: {
        'Donovan Woods': { country: 'CA', genres: ['folk', 'country', 'singer-songwriter'], type: 'Person' },
      },
    };
    const draft = mkDraft('Den kanadensiska singer-songwriter Donovan Woods intar scenen.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    expect(r.pass).toBe(true);
    expect(r.unsupported_claims).not.toContain('kanadensiska');
  });

  it('FAIL "kanadensiska" om Profile.performer_metadata saknas (regression-skydd)', () => {
    // Utan gazetteer → "kanadensiska" är inte belagd i Profile. Detta är
    // regression-skydd: om någon tar bort performer_metadata-stödet ska
    // detta test faila och tvinga fram en aktiv decision.
    const profile: EventProfile = {
      ...baseProfile,
      performers: ['Donovan Woods'],
      // performer_metadata: undefined
    };
    const draft = mkDraft('Den kanadensiska singer-songwriter Donovan Woods intar scenen.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    expect(r.pass).toBe(false);
    expect(r.unsupported_claims).toContain('kanadensiska');
  });

  it('PASS "holländsk" när Profile.performer_metadata.country=NL (Peter Dijkstra)', () => {
    const profile: EventProfile = {
      ...baseProfile,
      event_type: 'classical',
      performers: ['Peter Dijkstra'],
      performer_metadata: {
        'Peter Dijkstra': { country: 'NL', genres: ['classical'], type: 'Person' },
      },
    };
    // Undviker 'kören'/'dirigent' för att isolera country-claimen som testas.
    const draft = mkDraft('Den holländska Peter Dijkstra gästar Stockholm.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    expect(r.pass).toBe(true);
    expect(r.unsupported_claims).not.toContain('holländska');
  });

  it('PASS "kören" när type=Choir (Radiokören)', () => {
    const profile: EventProfile = {
      ...baseProfile,
      event_type: 'classical',
      performers: ['Radiokören'],
      performer_metadata: {
        'Radiokören': { country: 'SE', genres: ['classical', 'choral'], type: 'Choir' },
      },
    };
    // Isolerar type-claimen: minimal prosa med bara performer-namn + kören.
    const draft = mkDraft('Kören Radiokören sjunger.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    // Kören ska inte längre hamna i unsupported_claims.
    expect(r.unsupported_claims).not.toContain('kören');
  });

  it('PASS genre-claim när performer_metadata.genres innehåller termen (folk)', () => {
    const profile: EventProfile = {
      ...baseProfile,
      performers: ['Donovan Woods'],
      performer_metadata: {
        'Donovan Woods': { country: 'CA', genres: ['folk', 'country', 'singer-songwriter'], type: 'Person' },
      },
    };
    const draft = mkDraft('Donovan Woods sjunger egna folk-låtar.');
    const r = checkFactuality({ draft, profile, event: baseEvent });
    expect(r.pass).toBe(true);
    expect(r.unsupported_claims).not.toContain('folk');
  });
});
