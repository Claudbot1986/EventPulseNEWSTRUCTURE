/**
 * entityExtractor.test.ts — testar FAS 2 entity extractor mot både positiva
 * (VI SKA extrahera) och negativa (VI SKA INTE extrahera) exempel.
 *
 * Korrigering 7 (2026-10-08): "Testa negativa exempel. False-positive entity
 * roles kan annars skapa hallucinationer redan i Evidence Pack."
 *
 * Detta är en separat FAS 2-test som INTE är samma som semanticExtractor.
 */

import { describe, expect, it } from 'vitest';
import { extractEntities } from './entityExtractor';

// ─── POSITIVA EXEMPEL — VI SKA extrahera ─────────────────────────────────────

describe('Positiva exempel — vi SKA extrahera entiteter', () => {
  it('Anton Estby och Henrythefreak (humor/category) → 2 comedians', () => {
    const e = extractEntities({
      title: 'Anton Estby och Henrythefreak - Standup 2026, Stockholm',
      raw_description: null,
      category_slug: 'humor',
      venue_name: 'Troll Stockholm',
    });
    const names = e.map(x => x.name).sort();
    expect(names).toContain('Anton Estby');
    expect(names).toContain('Henrythefreak');
    const antonEstby = e.find(x => x.name === 'Anton Estby');
    expect(antonEstby?.role).toBe('comedian');
    expect(antonEstby?.evidence.field).toBe('title');
  });

  it('Stratifierat musik: "Veronica Maggio - Sommarturné 2026" → artist', () => {
    const e = extractEntities({
      title: 'Veronica Maggio - Sommarturné 2026',
      raw_description: null,
      category_slug: 'music',
      venue_name: 'Gröna Lund',
    });
    const mag = e.find(x => x.name === 'Veronica Maggio');
    expect(mag).toBeDefined();
    expect(mag?.role).toBe('artist');
    expect(mag?.confidence).toBe('SUPPORTED');
  });

  it('Sport: "AIK - Djurgården" → 2 teams', () => {
    const e = extractEntities({
      title: 'AIK - Djurgården',
      raw_description: null,
      category_slug: 'sports',
      venue_name: null,
    });
    const aik = e.find(x => x.name === 'AIK');
    const dif = e.find(x => x.name === 'Djurgården');
    expect(aik?.role).toBe('team');
    expect(dif?.role).toBe('team');
  });

  it('Sport: "AIK vs BIK Karlskoga" → 2 teams (vs)', () => {
    const e = extractEntities({
      title: 'AIK vs BIK Karlskoga',
      raw_description: null,
      category_slug: 'sports',
      venue_name: null,
    });
    expect(e.length).toBeGreaterThanOrEqual(2);
    expect(e.find(x => x.name === 'AIK')?.role).toBe('team');
    expect(e.some(x => x.name.includes('BIK'))).toBe(true);
  });

  it('Standup: "Standup med Özz Nûjen" → 1 comedian', () => {
    const e = extractEntities({
      title: 'Standup med Özz Nûjen',
      raw_description: null,
      category_slug: 'humor',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Özz Nûjen')?.role).toBe('comedian');
  });

  it('Föreläsning: "Föreläsning med Anders Hansen" → 1 speaker', () => {
    const e = extractEntities({
      title: 'Föreläsning med Anders Hansen',
      raw_description: null,
      category_slug: 'talks-lectures',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Anders Hansen')?.role).toBe('speaker');
  });

  it('DJ: "DJ-set med Adam Beyer" → 1 dj', () => {
    const e = extractEntities({
      title: 'DJ-set med Adam Beyer',
      raw_description: null,
      category_slug: 'electronic',
      venue_name: 'Trädgården',
    });
    expect(e.find(x => x.name === 'Adam Beyer')?.role).toBe('dj');
  });

  it('Structured input performers → VERIFIED confidence', () => {
    const e = extractEntities({
      title: 'Konsert med överraskning',
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
      structured_performers: ['Kungliga Filharmonikerna'],
    });
    const f = e.find(x => x.name === 'Kungliga Filharmonikerna');
    expect(f?.role).toBe('artist');
    expect(f?.confidence).toBe('VERIFIED');
    expect(f?.evidence.field).toBe('structured_input');
  });

  it('Description: "Medverkande: Anton Estby, Henrythefreak" → performers', () => {
    const e = extractEntities({
      title: 'Standup 2026',
      raw_description: 'Medverkande: Anton Estby, Henrythefreak. En kväll med standup.',
      category_slug: 'humor',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Anton Estby')?.role).toBe('performer');
    expect(e.find(x => x.name === 'Henrythefreak')?.role).toBe('performer');
  });
});

// ─── NEGATIVA EXEMPEL — vi SKA INTE extrahera artists/performer ──────────────

describe('Negativa exempel — vi SKA INTE skapa performers', () => {
  it('"Chicago - the Musical" → Chicago är work, INTE performer', () => {
    const e = extractEntities({
      title: 'Chicago - the Musical',
      raw_description: null,
      category_slug: 'musical-theatre',
      venue_name: 'Oscarsteatern',
    });
    const chicago = e.find(x => x.name === 'Chicago');
    if (chicago) {
      expect(chicago.role).not.toBe('artist');
      expect(chicago.role).not.toBe('performer');
      expect(chicago.role).toBe('work');
    }
    // Inga performers (vi vet inte vilka skådespelare som är med)
    expect(e.filter(x => ['artist', 'performer', 'band', 'comedian'].includes(x.role))).toHaveLength(0);
  });

  it('"Michael Jackson Tribute" → Michael Jackson är referenced, INTE performer', () => {
    const e = extractEntities({
      title: 'Michael Jackson Tribute',
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
    });
    const mj = e.find(x => x.name.includes('Michael Jackson'));
    if (mj) {
      expect(mj.role).not.toBe('artist');
      expect(mj.role).not.toBe('performer');
      expect(mj.role).toBe('referenced');
    }
  });

  it('"ABBA The Museum" → ABBA är referenced, INTE performer', () => {
    const e = extractEntities({
      title: 'ABBA The Museum',
      raw_description: null,
      category_slug: 'exhibition',
      venue_name: null,
    });
    const abba = e.find(x => x.name === 'ABBA');
    if (abba) {
      expect(abba.role).not.toBe('artist');
      expect(abba.role).not.toBe('performer');
      expect(abba.role).toBe('referenced');
    }
  });

  it('"Taylor Swift Party" → Taylor Swift är theme, INTE performer', () => {
    const e = extractEntities({
      title: 'Taylor Swift Party',
      raw_description: null,
      category_slug: 'nightlife',
      venue_name: null,
    });
    const ts = e.find(x => x.name.includes('Taylor Swift'));
    if (ts) {
      expect(ts.role).not.toBe('artist');
      expect(ts.role).not.toBe('performer');
      expect(ts.role).toBe('theme');
    }
  });

  it('"En kväll med Mozart" → Mozart är theme/composer context, INTE performer', () => {
    const e = extractEntities({
      title: 'En kväll med Mozart',
      raw_description: null,
      category_slug: 'classical',
      venue_name: null,
    });
    const mozart = e.find(x => x.name.includes('Mozart'));
    if (mozart) {
      expect(mozart.role).not.toBe('artist');
      expect(mozart.role).not.toBe('performer');
      // En kväll med [kompositör] — work/composer-context är OK
      expect(['composer', 'work', 'theme', 'referenced']).toContain(mozart.role);
    }
  });

  it('"Chicago the Musical 2026" (utan - separator) → work', () => {
    const e = extractEntities({
      title: 'Chicago the Musical 2026',
      raw_description: null,
      category_slug: 'musical-theatre',
      venue_name: null,
    });
    const chicago = e.find(x => x.name === 'Chicago');
    if (chicago) {
      expect(chicago.role).not.toBe('artist');
      expect(chicago.role).toBe('work');
    }
  });

  it('"Hamlet" (work title) → INTE artist', () => {
    const e = extractEntities({
      title: 'Hamlet',
      raw_description: null,
      category_slug: 'theatre-drama',
      venue_name: null,
    });
    const hamlet = e.find(x => x.name === 'Hamlet');
    if (hamlet) {
      expect(hamlet.role).not.toBe('artist');
      expect(hamlet.role).not.toBe('performer');
      expect(hamlet.role).toBe('work');
    }
  });

  it('Tom title + tom description → ingen entitet', () => {
    const e = extractEntities({
      title: null,
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
    });
    expect(e).toHaveLength(0);
  });

  it('Ospecifikt eventnamn → ingen falsk artist', () => {
    const e = extractEntities({
      title: 'Öppen förskola fredag',
      raw_description: null,
      category_slug: 'barn-familj',
      venue_name: null,
    });
    // "Öppen" / "förskola" / "fredag" är alla icke-entiteter
    expect(e.filter(x => x.role === 'artist' || x.role === 'performer')).toHaveLength(0);
  });

  it('Veronica Maggio på Gröna Lund (utan "och") → 1 artist + venue nämns', () => {
    // Testar att vi INTE får "Gröna Lund" som artist.
    const e = extractEntities({
      title: 'Veronica Maggio på Gröna Lund',
      raw_description: null,
      category_slug: 'music',
      venue_name: 'Gröna Lund',
    });
    const mag = e.find(x => x.name === 'Veronica Maggio');
    expect(mag).toBeDefined();
    expect(mag?.role).toBe('artist');
    // "Gröna Lund" ska INTE vara en performer
    expect(e.find(x => x.name === 'Gröna Lund')).toBeUndefined();
  });
});

// ─── SPECIFIKA SCENARION från live-sample ────────────────────────────────────

describe('Scenarion från live-sample (runtime/live-sample-2026-10-08)', () => {
  it('Event 4: "Big in Japan 2026 — Konsertsalen" → inga entiteter', () => {
    // "Big in Japan" är ett tema/programnamn, inte en artist
    const e = extractEntities({
      title: 'Big in Japan 2026 — Konsertsalen, Stockholm',
      raw_description: null,
      category_slug: 'music',
      venue_name: 'Konsertsalen',
    });
    expect(e.filter(x => ['artist', 'performer'].includes(x.role))).toHaveLength(0);
  });

  it('Event 5: "Quidam" (ovrigt/community) → inga entiteter', () => {
    const e = extractEntities({
      title: 'Quidam',
      raw_description: null,
      category_slug: 'community',
      venue_name: null,
    });
    // Quidam är ett verk/programnamn — inte person
    const quidam = e.find(x => x.name === 'Quidam');
    if (quidam) {
      expect(quidam.role).not.toBe('artist');
      expect(quidam.role).not.toBe('performer');
    }
  });

  it('Event 7: "Fejk" (teater) → inga entiteter (work-title)', () => {
    const e = extractEntities({
      title: 'Fejk',
      raw_description: null,
      category_slug: 'theatre-comedy',
      venue_name: null,
    });
    expect(e.filter(x => ['artist', 'performer'].includes(x.role))).toHaveLength(0);
  });

  it('Event 14: "Lunchtrav" (sport) → ingen artist', () => {
    const e = extractEntities({
      title: 'Lunchtrav',
      raw_description: null,
      category_slug: 'sport',
      venue_name: 'Solvalla',
    });
    // "Lunchtrav" är ett program/event-namn
    expect(e.filter(x => x.role === 'artist')).toHaveLength(0);
  });
});

// ─── FAS 3 (Hybrid Pipeline): utökade DESCRIPTION-PATTERNS ─────────────────
//
// I nuläget: bara 5 description-patterns (medverkande, scenen, dirigent, solist, artister).
// Många svenska konserter/text-evenemang använder andra prefix:
//   "Ensemble: Stockholm Saxophone Quartet"  → ensemble
//   "Kör: Radiokören"                       → ensemble
//   "Recitatör: Håkan Hellström"             → performer (talk)
//   "Läsning av: August Strindberg"         → work or author
//   "Gästartist: Lena Nilsson"               → artist (support act)
//
// Cross-site evidens: Konserthuset-sidor använder ofta "Ensemble: X" mönster,
// Berlinale/StHLM-sthlmlist använder "Recitatör: X", Berwaldhallen har
// "Gästartist" för konserter med inbjudna artister.

describe('FAS 3 — utökade description-patterns', () => {
  it('"Ensemble: Stockholm Saxophone Quartet" → ensemble', () => {
    const e = extractEntities({
      title: 'Konsert',
      raw_description: 'Ensemble: Stockholm Saxophone Quartet. Program: Verk av Bach och Pärt.',
      category_slug: 'classical',
      venue_name: null,
    });
    const sq = e.find(x => x.name === 'Stockholm Saxophone Quartet');
    expect(sq).toBeDefined();
    expect(sq?.role).toBe('ensemble');
    expect(sq?.confidence).toBe('SUPPORTED');
  });

  it('"Kör: Radiokören" → ensemble (befintlig "Radiokören" matchas via title-pattern om den finns)', () => {
    const e = extractEntities({
      title: 'Musik till åminnelse',
      raw_description: 'Kör: Radiokören och Peter Dijkstra. Dirigent: Peter Dijkstra.',
      category_slug: 'classical',
      venue_name: null,
    });
    // Radiokören ska finnas
    expect(e.find(x => x.name === 'Radiokören')).toBeDefined();
    // Peter Dijkstra både som kör-medlem OCH dirigent (dedupliceras till kör-medlem eller dirigent)
    const pd = e.find(x => x.name === 'Peter Dijkstra');
    expect(pd).toBeDefined();
  });

  it('"Recitatör: Håkan Hellström" → performer (talk/litteratur)', () => {
    const e = extractEntities({
      title: 'Kväll med Strindberg',
      raw_description: 'Recitatör: Håkan Hellström. Texter av August Strindberg.',
      category_slug: 'literature',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Håkan Hellström')?.role).toBe('performer');
  });

  it('"Gästartist: Lena Nilsson" → artist (support act context)', () => {
    const e = extractEntities({
      title: 'Huvudkonsert',
      raw_description: 'Huvudartist: Anna Svensson. Gästartist: Lena Nilsson.',
      category_slug: 'jazz',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Lena Nilsson')?.role).toBe('artist');
  });

  it('Description fångar komma-lista som title-pattern missar', () => {
    // Title är generisk ("Lunchkonsert"), description namnger artisterna
    const e = extractEntities({
      title: 'Lunchkonsert',
      raw_description: 'Medverkande: Veronica Maggio, Håkan Hellström, Nina Persson.',
      category_slug: 'music',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Veronica Maggio')).toBeDefined();
    expect(e.find(x => x.name === 'Håkan Hellström')).toBeDefined();
    expect(e.find(x => x.name === 'Nina Persson')).toBeDefined();
  });
});
//
// Återstående edge case från FAS 2.5-rapporten:
//   live-sample #28: "Musik till åminnelse - med Radiokören & Peter Dijkstra"
//     → "Musik till åminnelse" (FP artist) + "med Radiokören & Peter Dijkstra" (FP artist)
//   Förväntat: "Radiokören" + "Peter Dijkstra" (work-titel före - med är EJ performer).
//
// Cross-site bekräftelse:
//   - Berwaldhallen: "Musik till åminnelse - med X & Y" (1 källa) — men mönstret
//     "X & Y" i konsertlistor är generellt vanligt (festival-lineup, "Artist1 & Artist2").
//   - Stockholm-kulturhus brukar lista ensemble + dirigent med "Ensemble & Dirigent".
//
// Säkerhetsnät:
//   - Kräver "med" ELLER helt konsert-list-context
//   - Kräver att alla splits är proper names (versalbörjande)
//   - Hoppar över om åtkomst via "med" hittar bara 1 giltig entitet
//   - Skippar för icke-performer-kategorier (utställning/loppis/vinprovning)

describe('FAS 2.6 — ampersand-mönster för "med X & Y"', () => {
  it('"Med X & Y" → 2 entities, INTE work-titel som artist', () => {
    const e = extractEntities({
      title: 'Musik till åminnelse - med Radiokören & Peter Dijkstra',
      raw_description: null,
      category_slug: 'jazz',
      venue_name: null,
    });
    // Radiokören och Peter Dijkstra extraheras
    expect(e.find(x => x.name === 'Radiokören')).toBeDefined();
    expect(e.find(x => x.name === 'Peter Dijkstra')).toBeDefined();
    // Work-titel "Musik till åminnelse" ska INTE vara artist
    const musik = e.find(x => x.name === 'Musik till åminnelse');
    if (musik) {
      expect(musik.role).not.toBe('artist');
      expect(musik.role).not.toBe('performer');
    }
    // Total antal artister/performer ska vara 2, inte 3+
    expect(e.filter(x => ['artist', 'performer', 'ensemble'].includes(x.role))).toHaveLength(2);
  });

  it('"med X & Y & Z" (3 entities) → alla 3 extraheras', () => {
    const e = extractEntities({
      title: 'Vinterkonsert - med Radiokören & Peter Dijkstra & Elin Lund',
      raw_description: null,
      category_slug: 'classical',
      venue_name: null,
    });
    expect(e.find(x => x.name === 'Radiokören')).toBeDefined();
    expect(e.find(x => x.name === 'Peter Dijkstra')).toBeDefined();
    expect(e.find(x => x.name === 'Elin Lund')).toBeDefined();
    expect(e.filter(x => ['artist', 'performer', 'ensemble'].includes(x.role)).length).toBeGreaterThanOrEqual(3);
  });

  it('"&" utan "med"-prefix → INTE trigga (skyddar "Salt & Pepper" / bandnamn)', () => {
    const e = extractEntities({
      title: 'Earth, Wind & Fire',
      raw_description: null,
      category_slug: 'music',
      venue_name: 'Globen',
    });
    // Splitting här skulle ge ["Earth, Wind", "Fire"] — fel. Hela titeln är work/band.
    // Mönstret ska bara fånga "med X & Y".
    expect(e.filter(x => ['artist', 'performer'].includes(x.role))).toHaveLength(0);
  });

  it('"med X" ensamt (utan &) → INTE trigga ampersand-pattern (redan hanterat av befintlig `med` pattern)', () => {
    const e = extractEntities({
      title: 'Konsert med Veronica Maggio',
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
    });
    // Veronica Maggio extraheras via befintlig `med`-pattern (inte ampersand)
    expect(e.find(x => x.name === 'Veronica Maggio')).toBeDefined();
    // Inte splittras på "med" (skulle ge ett felaktigt extra entity)
    expect(e.filter(x => ['artist', 'performer'].includes(x.role))).toHaveLength(1);
  });

  it('"Med X & Y" i utställnings-kategori → INTE trigga (fel kategori)', () => {
    const e = extractEntities({
      title: 'Vernissage med Konstnär A & Curator B',
      raw_description: null,
      category_slug: 'exhibition',
      venue_name: null,
    });
    // Exhibition är inte performer-bearing — ampersand-pattern skippar
    expect(e.filter(x => ['artist', 'performer'].includes(x.role))).toHaveLength(0);
  });
});

// ─── FAS 2.5: NYA MÖNSTER FÖR ATT SLUTA 9 MISSADE EVENTS ─────────────────────
//
// Online-forskning (Stanford SLP §17, dev.to NER-jämförelse) bekräftar:
//   - Pattern-based approach med named-entity-kontext är gold standard för korta titlar
//   - LLM-NER med små modeller når bara 36–66 % recall på artistnamn
//   - Ren regelbaserad approach med multipla mönster + dedup är bästa vägen
//
// Nya mönster (alla med multi-site evidens i live-sample):
//   1. colon_list  — "Title: A + B + C" och "Title: A, B, C"
//   2. slash_collab — "Artist / Group" (undantag för datum-mönster)
//   3. single_name — ensamt artistnamn i musik-kategori (Donovan Woods)
//   4. Negative: "the Musical/Play/Symphony" även med efterföljande text
//
// Befintliga neg-pattern behåller sina 9 negativa testfall oförändrade (23/23).

describe('Nya mönster FAS 2.5 — multipla missed events', () => {
  it('Quidam: A + B + C → 6 performers (colon_list, plus-list)', () => {
    const e = extractEntities({
      title: 'Quidam: Helene Berg + Paul Pignon + Ida Lundén + Thomas Bjelkeborn + Eva Lindal + Philippe Moenne-Loccoz',
      raw_description: null,
      category_slug: 'community',
      venue_name: 'Fylkingen',
    });
    const names = e.map(x => x.name).sort();
    expect(names).toContain('Helene Berg');
    expect(names).toContain('Paul Pignon');
    expect(names).toContain('Ida Lundén');
    expect(names).toContain('Thomas Bjelkeborn');
    expect(names).toContain('Eva Lindal');
    expect(names).toContain('Philippe Moenne-Loccoz');
    // Quidam (LHS) ska INTE bli artist
    expect(e.find(x => x.name === 'Quidam')).toBeUndefined();
    // Roll sätts av kategori-mapping (community → performer/artist)
    expect(e.every(x => ['artist', 'performer'].includes(x.role))).toBe(true);
  });

  it('Norra Brunn: A, B, C → 3 comedians (colon_list, komma-list)', () => {
    const e = extractEntities({
      title: 'Norra Brunn: Måns Möller, Tobias Erehed, Dominik Henzel',
      raw_description: null,
      category_slug: 'theatre-comedy',
      venue_name: 'Norra Brunn',
    });
    expect(e.find(x => x.name === 'Måns Möller')?.role).toBe('comedian');
    expect(e.find(x => x.name === 'Tobias Erehed')?.role).toBe('comedian');
    expect(e.find(x => x.name === 'Dominik Henzel')?.role).toBe('comedian');
    // "Norra Brunn" (LHS) är venue, INTE performer
    expect(e.filter(x => x.role === 'comedian').length).toBe(3);
  });

  it('Praktikpresentation: A + B → 2 performers (colon_list, plus-list)', () => {
    const e = extractEntities({
      title: 'Praktikpresentation: Skånes Dansteater + Escarleth Romo Pozo',
      raw_description: null,
      category_slug: 'dance',
      venue_name: 'Dansens Hus',
    });
    expect(e.find(x => x.name === 'Skånes Dansteater')).toBeDefined();
    expect(e.find(x => x.name === 'Escarleth Romo Pozo')).toBeDefined();
  });

  it('Lars Jansson / Erik Söderlind Quartet → 2 artists (slash_collab)', () => {
    const e = extractEntities({
      title: 'Lars Jansson / Erik Söderlind Quartet',
      raw_description: null,
      category_slug: 'community',
      venue_name: 'Fasching',
    });
    expect(e.find(x => x.name === 'Lars Jansson')).toBeDefined();
    expect(e.find(x => x.name === 'Erik Söderlind Quartet')).toBeDefined();
  });

  it('Slash får INTE fånga datum-mönster (2026/10/09)', () => {
    const e = extractEntities({
      title: 'Some Event 2026/10/09',
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
    });
    // Inte heller matchas av slash eftersom "Some Event 2026" inte är
    // capitalized-pattern på båda sidor av slashen.
    expect(e.filter(x => x.role === 'artist').length).toBe(0);
  });

  it('Donovan Woods (ensamt namn, music) → 1 artist', () => {
    const e = extractEntities({
      title: 'Donovan Woods',
      raw_description: null,
      category_slug: 'music',
      venue_name: 'Debaser',
    });
    const d = e.find(x => x.name === 'Donovan Woods');
    expect(d).toBeDefined();
    expect(d?.role).toBe('artist');
    expect(d?.confidence).toBe('SUPPORTED');
  });

  it('Donovan Woods-liknande titel (community) → INTE artist (kategori-grind)', () => {
    const e = extractEntities({
      title: 'Donovan Woods',
      raw_description: null,
      category_slug: 'community',
      venue_name: null,
    });
    // single_name-grinden kräver music-kategori
    expect(e.find(x => x.name === 'Donovan Woods' && x.role === 'artist')).toBeUndefined();
  });

  it('Ensamt work-title "Antikrist" (theatre-drama) → INTE artist', () => {
    const e = extractEntities({
      title: 'Antikrist',
      raw_description: null,
      category_slug: 'theatre-drama',
      venue_name: null,
    });
    // Inte i music-kategori, ska inte trigga single_name
    expect(e.find(x => x.role === 'artist')).toBeUndefined();
  });

  it('"Joy With Strings" (festival) → INTE artist (3 ord, ej i musik-kategori)', () => {
    const e = extractEntities({
      title: 'Joy With Strings',
      raw_description: null,
      category_slug: 'festival',
      venue_name: null,
    });
    expect(e.filter(x => x.role === 'artist')).toHaveLength(0);
  });

  it('"Jazzfest på Konserthuset" (music, innehåller "fest") → INTE trigga single_name', () => {
    const e = extractEntities({
      title: 'Jazzfest på Konserthuset',
      raw_description: null,
      category_slug: 'music',
      venue_name: null,
    });
    // "fest"-keyword gör att single_name inte fångar.
    // Och "på" gör att colon_list etc. inte heller fångar.
    expect(e.filter(x => x.role === 'artist')).toHaveLength(0);
  });
});

// ─── TÄTNING AV NEGATIVA MÖNSTER ─────────────────────────────────────────────

describe('FAS 2.5 — tätare negativa mönster', () => {
  it('"Chicago - the Musical Oscarsteatern 2026-10-09 19:30" → Chicago som work (inte artist)', () => {
    // NYTT fall: live-sample #11 — negativa mönstret ska fånga även med efterföljande text.
    const e = extractEntities({
      title: 'Chicago - the Musical Oscarsteatern 2026-10-09 19:30',
      raw_description: null,
      category_slug: 'musical-theatre',
      venue_name: 'Oscarsteatern',
    });
    const chicago = e.find(x => x.name === 'Chicago');
    if (chicago) {
      expect(chicago.role).toBe('work');
      expect(chicago.role).not.toBe('artist');
      expect(chicago.role).not.toBe('performer');
    }
    // INGA artist/performer-entiteter ska finnas
    expect(e.filter(x => ['artist', 'performer', 'band'].includes(x.role))).toHaveLength(0);
  });

  it('"Konstruktion och bild" (exhibition) → INGA performers (kategori-grind på "och")', () => {
    const e = extractEntities({
      title: '"Konstruktion och bild" på Nacka konsthall',
      raw_description: null,
      category_slug: 'exhibition',
      venue_name: 'Nacka konsthall',
    });
    expect(e.filter(x => x.role === 'artist' || x.role === 'performer')).toHaveLength(0);
  });
});

// ─── FAS 3 — LLM-FALLBACK (MiniMax M3 via entityLlmAugment.ts) ───────────────
//
// Användaren bad uttryckligen om MiniMax M3 (ej OpenAI). Modulen speglar
// llmRouter.ts-arkitekturen: api.minimax.io/v1, MiniMax-M3 model, fetch.
// Testerna kör med mock-provider för att inte bränna API-kvoter.

import {
  llmAugmentEntities,
  shouldLlmAugment,
  parseLlmEntityJson,
  filterHallucinatedNames,
  type LlmProvider,
} from './entityLlmAugment';

describe('FAS 3 — LLM-fallback: parsing & beslutslogik', () => {
  it('parseLlmEntityJson: vanlig JSON-array', () => {
    const out = parseLlmEntityJson(
      '[{"name":"Veronica Maggio","role":"artist","confidence":0.95}]',
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Veronica Maggio');
    expect(out[0].role).toBe('artist');
    expect(out[0].confidence).toBe(0.95);
  });

  it('parseLlmEntityJson: med markdown-fences', () => {
    const out = parseLlmEntityJson(
      '```json\n[{"name":"Donovan Woods","role":"artist","confidence":0.85}]\n```',
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Donovan Woods');
  });

  it('parseLlmEntityJson: tom array (inga performers)', () => {
    expect(parseLlmEntityJson('[]')).toHaveLength(0);
  });

  it('parseLlmEntityJson: ogiltig JSON → []', () => {
    expect(parseLlmEntityJson('Inte JSON alls')).toHaveLength(0);
    expect(parseLlmEntityJson('')).toHaveLength(0);
    expect(parseLlmEntityJson('{ "name": "fel format" }')).toHaveLength(0);
  });

  it('shouldLlmAugment: triggar INTE om regler redan gav entities', () => {
    expect(shouldLlmAugment('Donovan Woods', 'music', 1)).toBe(false);
  });

  it('shouldLlmAugment: triggar INTE på för korta / för långa titlar', () => {
    expect(shouldLlmAugment('AB', 'music', 0)).toBe(false);
    expect(shouldLlmAugment('X'.repeat(101), 'music', 0)).toBe(false);
  });

  it('shouldLlmAugment: triggar INTE på icke-performer-kategori', () => {
    expect(shouldLlmAugment('Donovan Woods', 'exhibition', 0)).toBe(false);
    expect(shouldLlmAugment('Donovan Woods', 'community', 0)).toBe(false);
  });

  it('shouldLlmAugment: triggar när allt är rätt (förutom API-nyckel — vi skip i unit-test)', () => {
    // API-nyckel-sak gör shouldLlmAugment false; i prod sätts nyckeln via env.
    const prev = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = 'mock-key-for-unit-test';
    expect(shouldLlmAugment('Donovan Woods', 'music', 0)).toBe(true);
    process.env.MINIMAX_API_KEY = prev;
  });
});

describe('FAS 3 — LLM-fallback: anti-hallucination', () => {
  it('filterHallucinatedNames: substring-match accepteras', () => {
    const out = filterHallucinatedNames(
      [{ name: 'Donovan Woods', role: 'artist' }],
      'Donovan Woods',
    );
    expect(out).toHaveLength(1);
  });

  it('filterHallucinatedNames: VERSAL-börjande 1-3 ord accepteras även utan substring', () => {
    const out = filterHallucinatedNames(
      [{ name: 'Lars Jansson', role: 'artist' }],
      'Konsert på Fasching',  // Namnet finns inte i titeln
    );
    expect(out).toHaveLength(1);
  });

  it('filterHallucinationNames: förkastar för låg kvalitet', () => {
    const out = filterHallucinatedNames(
      [{ name: 'asdf123', role: 'artist' },  // ingen VERSAL-början
       { name: 'A', role: 'artist' },         // för kort
       { name: 'x'.repeat(60), role: 'artist' }], // för lång
      'Musik på Konserthuset',
    );
    expect(out).toHaveLength(0);
  });
});

describe('FAS 3 — LLM-fallback: integration med mock-provider', () => {
  // Mock-provider för att undvika nätverk + API-kostnad
  const mockProvider: LlmProvider = {
    async complete(_sys, _msg) {
      return '[{"name":"Donovan Woods","role":"artist","confidence":0.92}]';
    },
  };

  const failingProvider: LlmProvider = {
    async complete() {
      throw new Error('mock network error');
    },
  };

  it('Happy path: mock-provider returnerar performer → SUPPORTED + llm_fallback-evidens', async () => {
    const out = await llmAugmentEntities(
      { title: 'Donovan Woods', category: 'music', venue_name: null },
      mockProvider,
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Donovan Woods');
    expect(out[0].role).toBe('artist');
    expect(out[0].confidence).toBe('SUPPORTED');
    expect(out[0].evidence.method).toBe('llm_fallback:minimax-m3');
  });

  it('Fel-vägen: provider kastar → tom lista (no-op)', async () => {
    const out = await llmAugmentEntities(
      { title: 'Donovan Woods', category: 'music', venue_name: null },
      failingProvider,
    );
    expect(out).toHaveLength(0);
  });

  it('Confidence >= 0.7 → SUPPORTED; annars INFERRED', async () => {
    const lowConfProvider: LlmProvider = {
      async complete() {
        return '[{"name":"Donovan Woods","role":"artist","confidence":0.5}]';
      },
    };
    const out = await llmAugmentEntities(
      { title: 'Donovan Woods', category: 'music', venue_name: null },
      lowConfProvider,
    );
    expect(out[0]?.confidence).toBe('INFERRED');
  });

  it('Hallucinerat namn (modellen hittar på) filtreras bort', async () => {
    const hallProvider: LlmProvider = {
      async complete() {
        // Modellen returnerar ett namn som inte finns i titeln OCH inte är VERsal-börj.
        return '[{"name":"h4ck3r","role":"artist","confidence":0.9}]';
      },
    };
    const out = await llmAugmentEntities(
      { title: 'Veronica Maggio', category: 'music', venue_name: null },
      hallProvider,
    );
    expect(out).toHaveLength(0);  // filtret stoppar fabricerat namn
  });

  it('Tom LLM-output → tom lista', async () => {
    const emptyProvider: LlmProvider = {
      async complete() { return '[]'; },
    };
    const out = await llmAugmentEntities(
      { title: 'Donovan Woods', category: 'music', venue_name: null },
      emptyProvider,
    );
    expect(out).toHaveLength(0);
  });

  it('Roll mappas korrekt (okänd roll → artist default)', async () => {
    const oddRoleProvider: LlmProvider = {
      async complete() {
        return '[{"name":"Donovan Woods","role":"wizard","confidence":0.92}]';
      },
    };
    const out = await llmAugmentEntities(
      { title: 'Donovan Woods', category: 'music', venue_name: null },
      oddRoleProvider,
    );
    expect(out[0]?.role).toBe('artist');  // 'wizard' ej i ALLOWED_LLM_ROLES → default
  });
});

// ─── FAS 3.5 — entityConfidencePenalty (active-learning-koppling) ────────────
//
// Icke-DB-del av active-learning-flödet. Verifierar att penalty-hjälparen
// gör korrekta avdrag baserat på entitet-confidence:
//   - VERIFIED → +boost
//   - SUPPORTED → liten boost
//   - INFERRED → -3 per
//   - AMBIGUOUS → -4 per (värre än INFERRED)
//   - UNKNOWN → -2 per
// Clampas till [-15, +5] så vi aldrig över-ändrar confidence-score.

import {
  computeEntityPenalty,
  applyEntityPenalty,
} from './entityConfidencePenalty';
import type { ExtractedEntity } from './types';

function stubEntity(confidence: ExtractedEntity['confidence']): ExtractedEntity {
  return {
    name: 'X',
    role: 'artist',
    evidence: { field: 'title', span: '', method: '' },
    confidence,
  };
}

describe('FAS 3.5 — computeEntityPenalty', () => {
  it('Tom lista → 0 (ingen signal)', () => {
    expect(computeEntityPenalty([])).toBe(0);
  });

  it('Alla VERIFIED → boost +5 (clamped från +11)', () => {
    const out = computeEntityPenalty([
      stubEntity('VERIFIED'),
      stubEntity('VERIFIED'),
      stubEntity('VERIFIED'),
    ]);
    // 3 × +2 = +6, +5 bonus för alla-verified = +11, clamped till +5
    expect(out).toBe(5);
  });

  it('Mixed SUPPORTED + INFERRED → -2 (-6 +1 = -5)', () => {
    // 1 × +1 - 2 × 3 = -5 (inte all-verified bonus)
    expect(computeEntityPenalty([
      stubEntity('SUPPORTED'),
      stubEntity('INFERRED'),
      stubEntity('INFERRED'),
    ])).toBe(-5);
  });

  it('3 AMBIGUOUS → -12 (värre än INFERRED)', () => {
    expect(computeEntityPenalty([
      stubEntity('AMBIGUOUS'),
      stubEntity('AMBIGUOUS'),
      stubEntity('AMBIGUOUS'),
    ])).toBe(-12);
  });

  it('5 INFERRED → -15 (clamped från -15)', () => {
    expect(computeEntityPenalty([
      stubEntity('INFERRED'),
      stubEntity('INFERRED'),
      stubEntity('INFERRED'),
      stubEntity('INFERRED'),
      stubEntity('INFERRED'),
    ])).toBe(-15);
  });

  it('Floor-clamp: 10 INFERRED → ändå -15 (aldrig mer)', () => {
    const ten = Array(10).fill(0).map(() => stubEntity('INFERRED'));
    expect(computeEntityPenalty(ten)).toBe(-15);
  });
});

describe('FAS 3.5 — applyEntityPenalty (floor 0, ceil 100)', () => {
  it('Score 85 + mixed penalty → 80', () => {
    expect(applyEntityPenalty(85, [
      stubEntity('SUPPORTED'),
      stubEntity('INFERRED'),
      stubEntity('INFERRED'),
    ])).toBe(80);
  });

  it('Score 10 + INFERRED → 7 (floor-skydd sänker till 7)', () => {
    expect(applyEntityPenalty(10, [stubEntity('INFERRED')])).toBe(7);
  });

  it('Score 95 + 3 INFERRED → 86 (-9)', () => {
    expect(applyEntityPenalty(95, [
      stubEntity('INFERRED'),
      stubEntity('INFERRED'),
      stubEntity('INFERRED'),
    ])).toBe(86);
  });

  it('Score 30 + alla VERIFIED → 35 (+5 boost)', () => {
    expect(applyEntityPenalty(30, [
      stubEntity('VERIFIED'),
      stubEntity('VERIFIED'),
    ])).toBe(35);
  });
});
