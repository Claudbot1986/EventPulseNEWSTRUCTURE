/**
 * semanticExtractor.test.ts — tester för semantisk extraktion från raw_description.
 *
 * Säkrar att:
 *   - Zurich-pattern extraherar orkester, solist, kompositörer, verk, längd
 *   - raw_description ALDRIG når Profile i fritext (bara entiteter)
 *   - textualFirewall fortsatt blockerar raw_description från Writer
 *   - Edge cases (null, tom, kort text) hanteras
 */
import { describe, expect, it } from 'vitest';
import { extractSemantics, applySemanticExtraction } from './semanticExtractor';
import { buildEventProfile } from './eventUnderstanding';
import { compileWriterInputs, assertFirewallClean } from './textualFirewall';

const ZURICH_RAW = `En kväll med symfoniska mästerverk i Linköping Konsert & Kongress 8 oktober Rachmaninovs andra pianokonsert -- samt Berwald och Sibelius Med en av Europas främsta ungdomssymfoniorkestrar, Zürich Youth Orchestra, som spelar på en fullständigt professionell nivå. Det är en fullstor symfoniorkester med 95 musiker. Före konserten underhåller virtuosa kammarmusikensembler ur orkestern i entréhallen till Linköping Konsert & Kongress. Programmet är rena önskekonserten. Först uvertyren till Estrella de Soria av Franz Berwald, vår store svenske symfoniker -- musik fylld av energi, dramatik och oväntade vändningar, personlig och omisskännligt Berwald. Därefter en av romantikens mest älskade verk: Rachmaninovs andra pianokonsert. Musik som går rakt in i hjärtat, med stora känslor, svepande melodier och ett piano som både sjunger och brusar. Många känner igen teman, även om de inte vet varifrån. Mer romantiskt än så blir det knappast. Slutligen Jean Sibelius första symfoni. Här öppnar sig ett nordiskt landskap, mörkt skimrande och samtidigt fullt av kraft och liv -- en symfoni som griper tag och håller lyssnaren i ett fast grepp från första ton till sista. Pianosolist är den unge stjärnpianisten Ilya Shmukler, nyligen vinnare av den internationella pianotävlingen Concours Géza Anda. Presenteras av: Specialised Travel Concert Touring ltd Insläpp: kl 18:30 Showstart: kl 19:00 Längd: ca 2 timmar & 10 minuter Paus: Ja Lokal: Crusellhallen Rullstolsplatser bokas bokas via Ticketmasters tillgä`;

describe('extractSemantics — Zurich pattern', () => {
  it('extraherar orkester från "Youth Symphony Orchestra"-mönster', () => {
    const r = extractSemantics(ZURICH_RAW);
    // Texten säger "Zürich Youth Orchestra" (ej Symphony) — vi accepterar båda.
    expect(r.ensemble).toMatch(/Z(u|ü)rich/);
    expect(r.ensemble).toMatch(/Orchestra/);
  });

  it('extraherar orkesterstorlek (95 musiker)', () => {
    const r = extractSemantics(ZURICH_RAW);
    expect(r.orchestra_size).toBe(95);
  });

  it('extraherar pianist/soloist (Ilya Shmukler)', () => {
    const r = extractSemantics(ZURICH_RAW);
    expect(r.soloist_name).toBe('Ilya Shmukler');
    expect(r.soloist_role).toBe('pianosolist');
  });

  it('extraherar alla 3 kompositörer (Berwald, Rachmaninov, Sibelius)', () => {
    const r = extractSemantics(ZURICH_RAW);
    expect(r.composers).toContain('Berwald');
    expect(r.composers).toContain('Rachmaninov');
    expect(r.composers).toContain('Sibelius');
    expect(r.composers.length).toBe(3);
  });

  it('extraherar verk med kompositörs-attribution', () => {
    const r = extractSemantics(ZURICH_RAW);
    expect(r.works.length).toBeGreaterThan(0);
    const titles = r.works.map((w) => w.title.toLowerCase());
    expect(titles.some((t) => t.includes('estrella'))).toBe(true);
    const rachWork = r.works.find((w) => w.composer === 'Rachmaninov');
    expect(rachWork).toBeDefined();
    const sibeliusWork = r.works.find((w) => w.composer === 'Sibelius');
    expect(sibeliusWork).toBeDefined();
  });

  it('extraherar längd från "ca 2 timmar & 10 minuter"', () => {
    const r = extractSemantics(ZURICH_RAW);
    expect(r.duration_minutes_from_text).toBe(130);
  });

  it('returnerar ALDRIG meningar i något fält', () => {
    const r = extractSemantics(ZURICH_RAW);
    // Sätt verifiering att ta varje fält och kolla att det inte är en hel mening.
    const fields = [
      r.ensemble,
      r.soloist_name,
      r.ensemble_type,
      ...(r.composers ?? []),
      ...r.works.map((w) => `${w.title} (${w.composer})`),
    ].filter((s): s is string => typeof s === 'string');
    for (const field of fields) {
      // Inga meningar = max 1 punkt/tecken för sig, ingen punkt i slutet, längd < 100.
      expect(field).not.toMatch(/[.!?]\s/); // ingen punkt följt av mellanslag (mening)
      expect(field.length).toBeLessThan(100);
    }
  });
});

describe('extractSemantics — edge cases', () => {
  it('tomt input → tomt resultat', () => {
    const r = extractSemantics(null);
    expect(r.composers).toEqual([]);
    expect(r.works).toEqual([]);
    expect(r.ensemble).toBeUndefined();
  });

  it('undefined input → tomt resultat', () => {
    const r = extractSemantics(undefined);
    expect(r.composers).toEqual([]);
    expect(r.works).toEqual([]);
  });

  it('tom sträng → tomt resultat', () => {
    const r = extractSemantics('');
    expect(r.composers).toEqual([]);
  });

  it('kort text utan entiteter → tomt resultat', () => {
    const r = extractSemantics('En konsert.');
    expect(r.ensemble).toBeUndefined();
    expect(r.composers).toEqual([]);
  });

  it('okänd kompositör ignoreras', () => {
    const r = extractSemantics('Ett verk av någon okänd kompositör 1980.');
    expect(r.composers).toEqual([]);
  });
});

describe('applySemanticExtraction', () => {
  it('uppdaterar Profile.ensemble med orkester-namn', () => {
    const base = {
      event_type: 'music' as const,
      performers: [] as string[],
      genres: [] as string[],
      content: [] as string[],
      experience_characteristics: [] as string[],
      language: ['sv'],
      provenance: {} as Record<string, string[]>,
    };
    const extraction = {
      ensemble: 'Zurich Youth Symphony Orchestra',
      orchestra_size: 95,
      composers: ['Berwald', 'Rachmaninov', 'Sibelius'],
      works: [
        { title: 'Estrella de Soria', composer: 'Berwald' },
        { title: 'Pianokonsert nr 2', composer: 'Rachmaninov' },
      ],
      duration_minutes_from_text: 130,
      evidence: [],
    };
    const updated = applySemanticExtraction(base, extraction);
    expect(updated.ensemble).toBe('Zurich Youth Symphony Orchestra');
    expect(updated.experience_characteristics).toContain('95 musiker');
    expect(updated.repertoire).toContain('Estrella de Soria (Berwald)');
    expect(updated.duration_minutes).toBe(130);
    expect(updated.provenance['ensemble']).toBeDefined();
  });

  it('muterar INTE ursprunglig profile (immutability)', () => {
    const base = {
      event_type: 'music' as const,
      performers: ['existing performer'] as string[],
      genres: [] as string[],
      content: [] as string[],
      experience_characteristics: [] as string[],
      language: ['sv'],
      provenance: {} as Record<string, string[]>,
    };
    const extraction = {
      solo: 'no',
      composers: [],
      works: [],
      evidence: [],
      soloist_name: 'New Soloist',
    } as any;
    const updated = applySemanticExtraction(base, extraction);
    expect(updated).not.toBe(base);
    expect(base.performers).toEqual(['existing performer']);
    expect(updated.performers).toContain('New Soloist');
  });

  it('returnerar profile oförändrad om inget extraherat', () => {
    const base = {
      event_type: 'music' as const,
      performers: [] as string[],
      genres: [] as string[],
      content: [] as string[],
      experience_characteristics: [] as string[],
      language: ['sv'],
      provenance: {} as Record<string, string[]>,
    };
    const empty = { composers: [], works: [], evidence: [] };
    const r = applySemanticExtraction(base, empty);
    expect(r).toBe(base); // samma referens om inget ändras
  });
});

describe('buildEventProfile med raw_description', () => {
  it('Zurich-pattern → Profile innehåller orkester, solist, kompositörer', () => {
    const profile = buildEventProfile({
      category_slug: 'classical',
      venue_name: 'Linköping Konsert & Kongress',
      city: 'Stockholm',
      start_time: '2026-10-08T19:00:00+02:00',
      title: 'The Zurich Youth Symphony Orchestra',
      source: 'ticketmaster-se',
      raw_description: ZURICH_RAW,
    });
    expect(profile.ensemble).toMatch(/Z(u|ü)rich/); // tolerera både "Zurich" och "Zürich"
    // orchestra_size → experience_characteristics (immutable spread)
    expect(profile.experience_characteristics).toContain('95 musiker');
    expect(profile.performers).toContain('Ilya Shmukler');
    expect(profile.repertoire).toBeDefined();
    expect(profile.repertoire?.length).toBeGreaterThan(0);
    expect(profile.duration_minutes).toBe(130); // från text, inte start+end
    expect(profile.provenance['semantic_extraction']).toBeDefined();
  });

  it('utan raw_description → Profile som tidigare', () => {
    const profile = buildEventProfile({
      category_slug: 'rock',
      venue_type: 'club',
      venue_name: 'Debaser',
      title: 'Hooligan Bobs live',
      performers: ['Hooligan Bobs'],
    });
    expect(profile.ensemble).toBeUndefined();
    expect(profile.repertoire).toBeUndefined();
  });
});

describe('textualFirewall — raw_description blockeras', () => {
  it('compileWriterInputs kastar om raw_description finns i event-input', () => {
    const profile = {
      event_type: 'music',
      performers: [],
      genres: [],
      content: [],
      experience_characteristics: [],
      language: ['sv'],
      provenance: {},
    };
    expect(() =>
      compileWriterInputs({
        profile,
        event: {
          title: 'T',
          start_time: '2026-10-15T20:00:00+02:00',
          // @ts-expect-error — testar att runtime-brandväggen fångar detta
          raw_description: 'should not pass',
        },
      }),
    ).toThrow(/raw_description/);
  });

  it('assertFirewallClean fångar raw_description', () => {
    expect(() =>
      assertFirewallClean({ raw_description: 'leakage' }),
    ).toThrow(/raw_description/);
  });

  it('raw_description i Profile flätas inte med text som når Writer', () => {
    // Vi kontrollerar att Profile (som når Writer) inte innehåller meningar.
    const profile = buildEventProfile({
      category_slug: 'classical',
      title: 'Zurich',
      raw_description: ZURICH_RAW,
    });
    // Profile är ett objekt — vi serialiserar det och kontrollerar att
    // originaltext-fraser inte finns med.
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain('symfoniska mästerverk'); // mening från raw
    expect(serialized).not.toContain('Före konserten'); // mening från raw
    // Däremot FÅR entiteter (korta namn) finnas:
    expect(serialized).toMatch(/Z(u|ü)rich/);
    expect(serialized).toContain('Ilya Shmukler');
  });
});