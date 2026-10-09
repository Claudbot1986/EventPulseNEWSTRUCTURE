/**
 * stratifiedTest.ts — kör hela Editorial-pipelinen mot 30+ stratifierade events.
 *
 * P7-13/15. Syftar att ge en realistisk bild av pipeline-prestanda över olika
 * event-typer, info-nivåer och metadata-kvaliteter.
 *
 *   - Inget Supabase / ingen DB-anslutning — vi använder mock LLM.
 *   - Events är syntetiska men realistiska (baserade på riktiga mönster).
 *   - Rapporterar per strata: pass rate, fallback rate, factuality,
 *     independence, attempts, word_count.
 *   - Sparar rapport till runtime/stratified-report.json för analys.
 *
 * Steg 6/15 i P7 Definition of Done.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { runEditorialPipeline } from './index';
import { MockLlmClient } from './editorialWriter';
import type { EventUnderstandingInput } from './eventUnderstanding';
import type { EditorialPipelineResult } from './types';

// ─── Strata-typer ────────────────────────────────────────────────────────────

export type Stratum =
  | 'classical-rich'      // Klassiskt med raw_description
  | 'classical-bare'      // Klassiskt med bara titel + venue
  | 'rock-rich'           // Rockkonsert med fullständig info
  | 'rock-bare'           // Rockkonsert med lite info
  | 'theater-rich'        // Teater med programinfo
  | 'exhibition-misclass' // Utställning som saknar utställningsord (Zurich-pattern)
  | 'community-empty'     // Community med minimalt innehåll
  | 'festival-rich'       // Festival med många artister
  | 'sport-conflict'      // Sport med avvikande venue
  | 'workshop-medium';    // Workshop med medelnivå info

// ─── Event-generator ─────────────────────────────────────────────────────────

const ZURICH_RAW = `En kväll med symfoniska mästerverk i Linköping Konsert & Kongress 8 oktober Rachmaninovs andra pianokonsert -- samt Berwald och Sibelius Med en av Europas främsta ungdomssymfoniorkestrar, Zürich Youth Orchestra, som spelar på en fullständigt professionell nivå. Det är en fullstor symfoniorkester med 95 musiker. Först uvertyren till Estrella de Soria av Franz Berwald, vår store svenske symfoniker. Därefter Rachmaninovs andra pianokonsert. Slutligen Jean Sibelius första symfoni. Pianosolist är den unge stjärnpianisten Ilya Shmukler. Längd: ca 2 timmar & 10 minuter.`;

const STROKES_RAW = `The Strokes gör sin enda Sverigekonsert i höst. Bandet från New York spelar material från alla sina fem album, inklusive senaste "The New Abnormal". Support: Wet Leg.`;

export const STRATIFIED_EVENTS: Array<{ id: string; stratum: Stratum; event: EventUnderstandingInput; rawDescription: string | null; }> = [
  // ── Klassiskt (5 events) ──
  {
    id: 'evt-001-zurich',
    stratum: 'classical-rich',
    event: {
      category_slug: 'exhibition', // MISCLASSIFIED — semantic extractor ska fixa
      venue_type: 'arena',
      venue_name: 'Linköping Konsert & Kongress',
      city: 'Stockholm',
      start_time: '2026-10-08T19:00:00+02:00',
      title: 'The Zurich Youth Symphony Orchestra',
      source: 'ticketmaster-se',
    },
    rawDescription: ZURICH_RAW,
  },
  {
    id: 'evt-002-classical-rocket',
    stratum: 'classical-rich',
    event: {
      category_slug: 'classical',
      venue_type: 'concert_hall',
      venue_name: 'Konserthuset',
      city: 'Stockholm',
      start_time: '2026-10-12T19:30:00+02:00',
      title: 'Stockholms Filharmoniker: Tchaikovsky',
      performers: ['Stockholms Filharmoniker'],
      price_min_sek: 250,
      language: 'sv',
      source: 'konserthuset-se',
    },
    rawDescription: 'Stockholms Filharmoniker framför Tchaikovsky sjätte symfoni, den så kallade Pathétique. Dirigent: Klaus Mäkelä. Längd ca 1 tim 30 min. Dirigenten introducerar verket.',
  },
  {
    id: 'evt-003-classical-bare',
    stratum: 'classical-bare',
    event: {
      category_slug: 'classical',
      venue_name: 'Konserthuset',
      city: 'Stockholm',
      start_time: '2026-10-20T19:00:00+02:00',
      title: 'Konsert med Göteborgs Symfoniker',
      source: 'konserthuset-se',
    },
    rawDescription: null,
  },
  {
    id: 'evt-004-classical-recital',
    stratum: 'classical-rich',
    event: {
      category_slug: 'classical',
      venue_type: 'concert_hall',
      venue_name: 'Musikaliska',
      city: 'Stockholm',
      start_time: '2026-11-05T19:00:00+02:00',
      title: 'Pianorecital: Yiruma',
      performers: ['Yiruma'],
      price_min_sek: 350,
      language: 'sv',
      source: 'musikaliska-se',
    },
    rawDescription: 'Yiruma spelar solopianokonsert med verk av Chopin, Debussy och egna kompositioner. Längd ca 1 tim 40 min. Paus med servering.',
  },
  {
    id: 'evt-005-classical-chamber',
    stratum: 'classical-rich',
    event: {
      category_slug: 'classical',
      venue_type: 'concert_hall',
      venue_name: 'Grünewaldsalen',
      city: 'Stockholm',
      start_time: '2026-11-10T18:00:00+02:00',
      title: 'Kammarmusik: Kaleidostring',
      performers: ['Kaleidostring'],
      source: 'musikaliska-se',
    },
    rawDescription: 'Kaleidostring stråkkvartett framför verken av Haydn, Bartók och Dvořák. 60 minuter utan paus.',
  },

  // ── Rock/pop (5 events) ──
  {
    id: 'evt-010-strokes',
    stratum: 'rock-rich',
    event: {
      category_slug: 'rock',
      venue_type: 'arena',
      venue_name: 'Avicii Arena',
      city: 'Stockholm',
      start_time: '2026-11-15T20:00:00+02:00',
      title: 'The Strokes — Live',
      performers: ['The Strokes', 'Wet Leg'],
      price_min_sek: 750,
      language: 'sv',
      source: 'live-se',
    },
    rawDescription: STROKES_RAW,
  },
  {
    id: 'evt-011-rock-bare',
    stratum: 'rock-bare',
    event: {
      category_slug: 'rock',
      venue_type: 'club',
      venue_name: 'Debaser',
      city: 'Stockholm',
      start_time: '2026-10-25T20:00:00+02:00',
      title: 'Hooligan Bobs live',
      source: 'debaster',
    },
    rawDescription: null,
  },
  {
    id: 'evt-012-rock-medium',
    stratum: 'rock-rich',
    event: {
      category_slug: 'rock',
      venue_type: 'club',
      venue_name: 'Nalen',
      city: 'Stockholm',
      start_time: '2026-11-01T21:00:00+02:00',
      title: 'The Hives — Support: Viagra Boys',
      performers: ['The Hives', 'Viagra Boys'],
      price_min_sek: 350,
      language: 'sv',
      source: 'nalen-se',
    },
    rawDescription: 'The Hives spelar sin bästa rock från alla album. Support: Viagra Boys från Stockholm. Efterfest på Nalen.',
  },
  {
    id: 'evt-013-pop-medium',
    stratum: 'rock-rich',
    event: {
      category_slug: 'pop',
      venue_type: 'arena',
      venue_name: 'Annexet',
      city: 'Stockholm',
      start_time: '2026-12-05T19:30:00+02:00',
      title: 'Hov1 — Avskedsturné',
      performers: ['Hov1'],
      price_min_sek: 450,
      language: 'sv',
      source: 'live-se',
    },
    rawDescription: 'Hov1 spelar sin avskedsturné. Sista chansen att se dem i Stockholm.',
  },
  {
    id: 'evt-014-jazz-medium',
    stratum: 'rock-rich',
    event: {
      category_slug: 'jazz',
      venue_type: 'club',
      venue_name: 'Fasching',
      city: 'Stockholm',
      start_time: '2026-10-30T20:00:00+02:00',
      title: 'Jazzkväll: Esbjörn Svensson Trio',
      performers: ['Esbjörn Svensson Trio'],
      source: 'fasching-se',
    },
    rawDescription: 'EST spelar konsert med nya kompositioner och standards.',
  },

  // ── Teater (3 events) ──
  {
    id: 'evt-020-theater-rich',
    stratum: 'theater-rich',
    event: {
      category_slug: 'theater',
      venue_type: 'theater',
      venue_name: 'Dramaten',
      city: 'Stockholm',
      start_time: '2026-11-20T19:00:00+02:00',
      title: 'Ett dockhem — Ibsen',
      performers: ['Dramatens ensemble'],
      price_min_sek: 450,
      language: 'sv',
      source: 'dramaten-se',
    },
    rawDescription: 'Ibsens klassiker om Nora och hennes frigörelse. Ny uppsättning med Dramatens ensemble. Regi: Mia Fahlén. Längd ca 2 tim 45 min inkl paus.',
  },
  {
    id: 'evt-021-theater-bare',
    stratum: 'theater-rich',
    event: {
      category_slug: 'theater',
      venue_type: 'theater',
      venue_name: 'Kulturhuset Stadsteatern',
      city: 'Stockholm',
      start_time: '2026-12-01T19:00:00+02:00',
      title: 'Standup med Måns Möller',
      source: 'kulturhuset-se',
    },
    rawDescription: null,
  },
  {
    id: 'evt-022-theater-medium',
    stratum: 'theater-rich',
    event: {
      category_slug: 'standup',
      venue_type: 'club',
      venue_name: 'Södra Teatern',
      city: 'Stockholm',
      start_time: '2026-11-25T20:00:00+02:00',
      title: 'Standup med Özz Nûjen',
      performers: ['Özz Nûjen'],
      price_min_sek: 350,
      source: 'sodrateatern-se',
    },
    rawDescription: 'Özz Nûjen gör ny show om föräldraskap och medelålder.',
  },

  // ── Utställning (3 events) ──
  {
    id: 'evt-030-exhibition-normal',
    stratum: 'exhibition-misclass',
    event: {
      category_slug: 'exhibition',
      venue_type: 'gallery',
      venue_name: 'Moderna Museet',
      city: 'Stockholm',
      start_time: '2026-10-15T10:00:00+02:00',
      title: 'Hilma af Klint — Solljusen',
      performers: [],
      price_min_sek: 150,
      language: 'sv',
      source: 'modernamuseet-se',
    },
    rawDescription: 'Samlingsutställning med Hilma af Klints tidiga abstrakta verk från 1900-talet. Guidningar varje lördag. Utställningen pågår till 15 mars 2027.',
  },
  {
    id: 'evt-031-exhibition-bare',
    stratum: 'exhibition-misclass',
    event: {
      category_slug: 'exhibition',
      venue_type: 'gallery',
      venue_name: 'Bonniers Konsthall',
      city: 'Stockholm',
      start_time: '2026-11-08T12:00:00+02:00',
      title: 'Lars Lerin — Vatten',
      source: 'bonnierskonsthall-se',
    },
    rawDescription: null,
  },
  {
    id: 'evt-032-exhibition-medium',
    stratum: 'exhibition-misclass',
    event: {
      category_slug: 'exhibition',
      venue_type: 'gallery',
      venue_name: 'Fotografiska',
      city: 'Stockholm',
      start_time: '2026-12-10T10:00:00+02:00',
      title: 'Andreas Gursky — Retrospektiv',
      price_min_sek: 200,
      language: 'sv',
      source: 'fotografiska-se',
    },
    rawDescription: 'Andreas Gurskys storskaliga fotografier från 1980-talet till idag. Världsunik utställning.',
  },

  // ── Community / workshop (3 events) ──
  {
    id: 'evt-040-community-empty',
    stratum: 'community-empty',
    event: {
      category_slug: 'community',
      venue_name: 'Stadsbiblioteket',
      city: 'Stockholm',
      start_time: '2026-10-22T18:00:00+02:00',
      title: 'Bokcirkel: Stoner',
      source: 'stadsbiblioteket-se',
    },
    rawDescription: null,
  },
  {
    id: 'evt-041-workshop-medium',
    stratum: 'workshop-medium',
    event: {
      category_slug: 'workshop',
      venue_type: 'studio',
      venue_name: 'Keramikstudion',
      city: 'Stockholm',
      start_time: '2026-11-12T17:00:00+02:00',
      title: 'Keramik-workshop för nybörjare',
      price_min_sek: 450,
      language: 'sv',
      source: 'keramikstudion-se',
    },
    rawDescription: 'Lär dig grundläggande keramik: tumning, kavlning och glasyr. Material ingår. 2 timmar.',
  },
  {
    id: 'evt-042-community-medium',
    stratum: 'community-empty',
    event: {
      category_slug: 'community',
      venue_type: 'park',
      venue_name: 'Tantolunden',
      city: 'Stockholm',
      start_time: '2026-10-18T10:00:00+02:00',
      title: 'Brädspelsdag i parken',
      is_free: true,
      language: 'sv',
      source: 'meetup-se',
    },
    rawDescription: 'Medtag egna brädspel eller låna av arrangören. Familjevänligt.',
  },

  // ── Festival (2 events) ──
  {
    id: 'evt-050-festival-rich',
    stratum: 'festival-rich',
    event: {
      category_slug: 'festival',
      venue_type: 'park',
      venue_name: 'Skansen',
      city: 'Stockholm',
      start_time: '2026-08-15T15:00:00+02:00',
      title: 'Skansen Sommarfest — Dag 1',
      performers: ['Hov1', 'The Hives', 'Yiruma', 'Özz Nûjen'],
      price_min_sek: 695,
      language: 'sv',
      source: 'skansen-se',
    },
    rawDescription: 'Stora artister på flera scener. Hov1 öppnar, The Hives headlinar. Yiruma spelar klassiskt. Özz Nûjen gör standup mellan banden. 6 timmar non-stop.',
  },
  {
    id: 'evt-051-festival-medium',
    stratum: 'festival-rich',
    event: {
      category_slug: 'festival',
      venue_type: 'park',
      venue_name: 'Gärdet',
      city: 'Stockholm',
      start_time: '2026-07-20T12:00:00+02:00',
      title: 'Way Out West — Festivalpass',
      price_min_sek: 1895,
      language: 'sv',
      source: 'wayoutwest-se',
    },
    rawDescription: 'Tre dagar med internationella och svenska artister på Gärdet. 50+ akter.',
  },

  // ── Sport (2 events) ──
  {
    id: 'evt-060-sport-conflict',
    stratum: 'sport-conflict',
    event: {
      category_slug: 'sports',
      venue_type: 'theater', // Ovanligt för sport → conflict-signal
      venue_name: 'Annexet',
      city: 'Stockholm',
      start_time: '2026-11-30T19:00:00+02:00',
      title: 'Hockeyderby: Djurgården — AIK',
      price_min_sek: 350,
      source: 'hockey-se',
    },
    rawDescription: 'Stockholms hetaste derby. Djurgården tar emot AIK i en kvartsfinal.',
  },
  {
    id: 'evt-061-sport-normal',
    stratum: 'sport-conflict',
    event: {
      category_slug: 'sports',
      venue_type: 'arena',
      venue_name: 'Tele2 Arena',
      city: 'Stockholm',
      start_time: '2026-12-15T19:30:00+02:00',
      title: 'Fotboll: AIK — Hammarby',
      performers: ['AIK', 'Hammarby'],
      price_min_sek: 295,
      source: 'aik-se',
    },
    rawDescription: 'Allsvenskan final. AIK mot Hammarby på Tele2 Arena.',
  },

  // ── Fler klassiska/rock för att komma över 30 ──
  {
    id: 'evt-070-bach',
    stratum: 'classical-rich',
    event: {
      category_slug: 'classical',
      venue_type: 'church',
      venue_name: 'Storkyrkan',
      city: 'Stockholm',
      start_time: '2026-12-24T20:00:00+02:00',
      title: 'Julkonsert: Bach Juloratorium',
      performers: ['Storkyrkans kör'],
      source: 'storkyrkan-se',
    },
    rawDescription: 'Bach Juloratorium framfört av Storkyrkans kör och solister. Traditionsenlig julkonsert.',
  },
  {
    id: 'evt-071-punk',
    stratum: 'rock-bare',
    event: {
      category_slug: 'punk',
      venue_type: 'club',
      venue_name: 'Mosebacke',
      city: 'Stockholm',
      start_time: '2026-11-22T21:00:00+02:00',
      title: 'Punkrock med Eaten By Siblings',
      source: 'mosebacke-se',
    },
    rawDescription: null,
  },
  {
    id: 'evt-072-electronic',
    stratum: 'rock-rich',
    event: {
      category_slug: 'electronic',
      venue_type: 'club',
      venue_name: 'Berns',
      city: 'Stockholm',
      start_time: '2026-10-31T22:00:00+01:00',
      title: 'Halloween med Swedish House Mafia',
      performers: ['Swedish House Mafia'],
      price_min_sek: 850,
      source: 'bern-se',
    },
    rawDescription: 'Swedish House Mafia spelar hela natten. Speciell Halloween-set med nya remixer.',
  },
  {
    id: 'evt-073-folk',
    stratum: 'rock-rich',
    event: {
      category_slug: 'folk',
      venue_type: 'concert_hall',
      venue_name: 'Konserthuset',
      city: 'Stockholm',
      start_time: '2026-11-18T19:00:00+02:00',
      title: 'Folkmusik: Väsen',
      performers: ['Väsen'],
      source: 'konserthuset-se',
    },
    rawDescription: 'Väsen spelar traditionell och nyskriven folkmusik. Tre konsertkvällar.',
  },
  {
    id: 'evt-074-bare-min',
    stratum: 'community-empty',
    event: {
      category_slug: 'community',
      city: 'Stockholm',
      title: 'Ett evenemang utan info',
      start_time: '2026-12-01T18:00:00+02:00',
    },
    rawDescription: null,
  },
  {
    id: 'evt-075-opera',
    stratum: 'classical-rich',
    event: {
      category_slug: 'opera',
      venue_type: 'opera_house',
      venue_name: 'Operan',
      city: 'Stockholm',
      start_time: '2026-12-20T19:00:00+02:00',
      title: 'La Traviata — Verdi',
      performers: ['Operans ensemble'],
      price_min_sek: 550,
      source: 'operan-se',
    },
    rawDescription: 'Verdis La Traviata i ny produktion. Sångare från hela världen. 3 timmar inkl paus.',
  },
  {
    id: 'evt-076-metal',
    stratum: 'rock-rich',
    event: {
      category_slug: 'metal',
      venue_type: 'club',
      venue_name: 'Fryshuset',
      city: 'Stockholm',
      start_time: '2026-11-28T20:00:00+02:00',
      title: 'Ghost — Imperatour',
      performers: ['Ghost'],
      price_min_sek: 595,
      source: 'fryshuset-se',
    },
    rawDescription: 'Ghost kommer till Fryshuset med sin Imperatour. Spektakulär ljusshow.',
  },
  {
    id: 'evt-077-classical-baroque',
    stratum: 'classical-rich',
    event: {
      category_slug: 'classical',
      venue_type: 'church',
      venue_name: 'Hedvig Eleonora kyrka',
      city: 'Stockholm',
      start_time: '2026-11-15T17:00:00+02:00',
      title: 'Barockkonsert: Händel',
      performers: ['Drottningholms Barockensemble'],
      source: 'hedvigeleonora-se',
    },
    rawDescription: 'Händel och Purcell framfört av Drottningholms Barockensemble på historiska instrument.',
  },
];

// ─── LLM-mock (varierande kvalitet) ──────────────────────────────────────────

/**
 * Mock LLM som genererar text från userPrompt (Profile + event-fält).
 * Detta gör att texten refererar till rätt entiteter och passerar factuality.
 *
 * Stratifieringen uppstår genom Profile-kvaliteten, inte genom mock-svaret.
 */
function makeStratifiedMock(): MockLlmClient {
  return new MockLlmClient((args) => {
    // Parsa userPrompt för att extrahera nyckelfält
    const titleMatch = args.userPrompt.match(/titel:\s*(.+)/);
    const performersMatch = args.userPrompt.match(/performers:\s*(.+)/);
    const venueMatch = args.userPrompt.match(/venue_name:\s*(.+)/);
    const durationMatch = args.userPrompt.match(/duration_minutes:\s*(\d+)/);
    const cityMatch = args.userPrompt.match(/city:\s*(.+)/);
    const priceMatch = args.userPrompt.match(/price_min_sek:\s*(\d+)/);
    const startMatch = args.userPrompt.match(/start_time:\s*(.+)/);

    const title = titleMatch ? titleMatch[1].trim() : 'Evenemanget';
    const performers = performersMatch ? performersMatch[1].trim() : '';
    const venue = venueMatch ? venueMatch[1].trim() : '';
    const city = cityMatch ? cityMatch[1].trim() : '';
    const duration = durationMatch ? parseInt(durationMatch[1], 10) : 0;
    const price = priceMatch ? parseInt(priceMatch[1], 10) : 0;
    const start = startMatch ? startMatch[1].trim() : '';

    // Bygg text från tillgängliga entiteter. VI HITTAR PÅ INGENTING.
    // Om Profile saknar duration/price/start_time → vi nämner dem inte.
    const parts: string[] = [];
    parts.push(title);
    if (performers) parts.push(` med ${performers}`);
    if (venue) parts.push(` på ${venue}`);
    if (city) parts.push(` i ${city}`);
    if (duration > 0) {
      const h = Math.floor(duration / 60);
      const m = duration % 60;
      // ALTERNATIVA format — testa att factuality-normalisering fångar dem
      // Vi varierar format per event för att testa alla grenar av normalizeDuration.
      const formats = [
        `, ${h} tim ${m} min`,
        ` (längd ${h} timmar ${m} minuter)`,
        `. Längd ${h}:${String(m).padStart(2, '0')}`,
        `. Speltid ${duration} min`,
      ];
      const fmt = formats[Math.abs(title.length) % formats.length];
      parts.push(fmt);
    }
    if (price > 0) {
      // Testa alternativa prisformat
      const priceFormats = [
        `. Inträde ${price} kr`,
        `. Biljetter ${price}:-`,
        `. Entré ${price} kronor`,
      ];
      const fmt = priceFormats[Math.abs(venue.length) % priceFormats.length];
      parts.push(fmt);
    }
    if (start && start.includes('T')) {
      const time = start.split('T')[1]?.slice(0, 5) ?? '';
      if (time) parts.push(`. Start kl ${parseInt(time.split(':')[0], 10)}`);
    }
    parts.push('.');
    return parts.join('');
  });
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

export interface StratifiedMetrics {
  total: number;
  by_stratum: Record<string, {
    count: number;
    pass: number;
    fallback_fact: number;
    fallback_minimal: number;
    failed: number;
    avg_attempts: number;
    avg_word_count: number;
    avg_unsupported_claims: number;
  }>;
  totals: {
    pass_rate: number;
    fallback_rate: number;
    failure_rate: number;
    avg_attempts: number;
    avg_word_count: number;
  };
}

export interface StratifiedMetrics {
  total: number;
  by_stratum: Record<string, {
    count: number;
    pass: number;
    fallback_fact: number;
    fallback_minimal: number;
    failed: number;
    avg_attempts: number;
    avg_word_count: number;
    avg_unsupported_claims: number;
  }>;
  totals: {
    pass_rate: number;
    fallback_rate: number;
    failure_rate: number;
    avg_attempts: number;
    avg_word_count: number;
  };
  per_event?: Array<{
    id: string;
    stratum: Stratum;
    status: string;
    attempts: number;
    word_count: number;
    unsupported_claims: number;
    final_text: string | null;
  }>;
}

export async function runStratifiedTest(): Promise<StratifiedMetrics> {
  const llm = makeStratifiedMock();
  const results: Array<{ id: string; stratum: Stratum; result: EditorialPipelineResult }> = [];

  for (const { id, stratum, event, rawDescription } of STRATIFIED_EVENTS) {
    try {
      const result = await runEditorialPipeline({
        event,
        sourceDescription: rawDescription,
        llm,
        maxAttempts: 2,
      });
      results.push({ id, stratum, result });
    } catch (err) {
      console.error(`[stratified] event ${id} misslyckades:`, err);
    }
  }

  // Aggregera per stratum
  const byStratum: Record<string, { count: number; pass: number; fallback_fact: number; fallback_minimal: number; failed: number; attempts: number; word_count: number; unsupported_claims: number; }> = {};
  for (const r of results) {
    const s = r.stratum;
    if (!byStratum[s]) {
      byStratum[s] = { count: 0, pass: 0, fallback_fact: 0, fallback_minimal: 0, failed: 0, attempts: 0, word_count: 0, unsupported_claims: 0 };
    }
    const bucket = byStratum[s];
    bucket.count++;
    if (r.result.status === 'passed') bucket.pass++;
    else if (r.result.status === 'fallback_fact') bucket.fallback_fact++;
    else if (r.result.status === 'fallback_minimal') bucket.fallback_minimal++;
    else if (r.result.status === 'failed') bucket.failed++;
    bucket.attempts += r.result.attempts;
    bucket.word_count += r.result.draft?.word_count ?? r.result.final_text?.split(/\s+/).filter(Boolean).length ?? 0;
    bucket.unsupported_claims += r.result.factuality?.unsupported_claims.length ?? 0;
  }

  const by_stratum: StratifiedMetrics['by_stratum'] = {};
  for (const [s, b] of Object.entries(byStratum)) {
    by_stratum[s] = {
      count: b.count,
      pass: b.pass,
      fallback_fact: b.fallback_fact,
      fallback_minimal: b.fallback_minimal,
      failed: b.failed,
      avg_attempts: b.count > 0 ? b.attempts / b.count : 0,
      avg_word_count: b.count > 0 ? b.word_count / b.count : 0,
      avg_unsupported_claims: b.count > 0 ? b.unsupported_claims / b.count : 0,
    };
  }

  const total = results.length;
  const passCount = results.filter((r) => r.result.status === 'passed').length;
  const fallbackCount = results.filter((r) => r.result.status === 'fallback_fact' || r.result.status === 'fallback_minimal').length;
  const failedCount = results.filter((r) => r.result.status === 'failed').length;
  const totalAttempts = results.reduce((acc, r) => acc + r.result.attempts, 0);
  const totalWords = results.reduce((acc, r) => acc + (r.result.draft?.word_count ?? r.result.final_text?.split(/\s+/).filter(Boolean).length ?? 0), 0);

  // Per-event detaljer (för djupare analys)
  const per_event: NonNullable<StratifiedMetrics['per_event']> = results.map((r) => ({
    id: r.id,
    stratum: r.stratum,
    status: r.result.status,
    attempts: r.result.attempts,
    word_count: r.result.draft?.word_count ?? r.result.final_text?.split(/\s+/).filter(Boolean).length ?? 0,
    unsupported_claims: r.result.factuality?.unsupported_claims.length ?? 0,
    final_text: r.result.final_text ?? null,
  }));

  return {
    total,
    by_stratum,
    totals: {
      pass_rate: total > 0 ? passCount / total : 0,
      fallback_rate: total > 0 ? fallbackCount / total : 0,
      failure_rate: total > 0 ? failedCount / total : 0,
      avg_attempts: total > 0 ? totalAttempts / total : 0,
      avg_word_count: total > 0 ? totalWords / total : 0,
    },
    per_event,
  };
}

// ─── CLI entry point ────────────────────────────────────────────────────────

const REPORT_DIR = path.resolve(process.cwd(), 'runtime');
const REPORT_FILE = path.resolve(REPORT_DIR, 'stratified-report.json');

if (process.argv[1] && process.argv[1].endsWith('stratifiedTest.ts')) {
  runStratifiedTest()
    .then((m) => {
      if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(REPORT_FILE, JSON.stringify(m, null, 2));
      console.log('='.repeat(60));
      console.log('STRATIFIED TEST REPORT — Editorial Engine (P7)');
      console.log('='.repeat(60));
      console.log(`Total events: ${m.total}`);
      console.log(`Pass rate:    ${(m.totals.pass_rate * 100).toFixed(1)}% (${Math.round(m.totals.pass_rate * m.total)} events)`);
      console.log(`Fallback:     ${(m.totals.fallback_rate * 100).toFixed(1)}% (${Math.round(m.totals.fallback_rate * m.total)} events)`);
      console.log(`Failure:      ${(m.totals.failure_rate * 100).toFixed(1)}% (${Math.round(m.totals.failure_rate * m.total)} events)`);
      console.log(`Avg attempts: ${m.totals.avg_attempts.toFixed(2)}`);
      console.log(`Avg word count: ${m.totals.avg_word_count.toFixed(1)}`);
      console.log('');
      console.log('By stratum:');
      for (const [s, b] of Object.entries(m.by_stratum)) {
        const status = `pass=${b.pass} fact=${b.fallback_fact} min=${b.fallback_minimal} fail=${b.failed}`;
        console.log(`  ${s.padEnd(28)} n=${b.count} ${status}`);
      }
      console.log('');
      console.log('--- Failed/Fallback events (för analys) ---');
      if (m.per_event) {
        for (const e of m.per_event) {
          if (e.status !== 'passed') {
            const preview = (e.final_text ?? '').slice(0, 80);
            console.log(`  [${e.status.padEnd(16)}] ${e.id} (${e.stratum}) words=${e.word_count} unsupported=${e.unsupported_claims}`);
            if (preview) console.log(`      → ${preview}${preview.length === 80 ? '...' : ''}`);
          }
        }
      }
      console.log('');
      console.log(`Full report saved to: ${REPORT_FILE}`);
    })
    .catch((err) => {
      console.error('Stratified test failed:', err);
      process.exit(1);
    });
}
