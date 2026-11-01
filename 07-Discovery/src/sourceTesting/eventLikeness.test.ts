/**
 * Tester för eventLikeness — inklusive negativa kontroller.
 *
 * De FAKTISKA titlarna nedan är hämtade ur live-grafen (2026-11-01):
 * de som ska fällas kommer från källor som visade sig vara blogg- och
 * nyhetssidor, de som inte får fällas kommer från källor som levererade
 * riktiga evenemang. En gate som släpper igenom en riktig evenemangsttitel
 * är lika fel som en gate som missar en artikel.
 */

import { describe, it, expect } from 'vitest';
import {
  assessLikeness,
  classifyPageSignals,
  classifyTitleShape,
  decodeEntities,
  shouldBlockPromotion,
} from './eventLikeness.js';

/** Artiklar — dessa SKA fällas. */
const ARTICLE_TITLES = [
  'Har du glömt något på Kulturfestivalen?',
  'Varför är vissa gator avstängda inför festivalen?',
  'När sker Kulturfestivalen 2026?',
  'Är det någon åldersgräns på Kulturfestivalen?',
  'Så funkar hemmets teknik från första fiberkabel till varm dusch',
  'Så väljer du ekologisk gurkmeja för kök och produktion',
  'Därför dominerar mytologi och slott bland europeiska spelteman',
  'Därför är företagstelefonin en samarbetsfråga, inte bara en IT-fråa',
  'Snart släpps biljetterna till Melodifestivalturnén 2027!',
  'Ansökan öppen: vistelsestipendium till Grez sur Loing',
  'Höstlov i Stockholm – här hittar du roliga saker att göra',
  'Guiden till halloweenfester i Stockholm',
  'Saker att göra i Stockholm i helgen',
  'Tips på höstens bästa utställningar i Stockholm',
];

/** Riktiga evenemang — dessa FÅR INTE fällas. */
const EVENT_TITLES = [
  'Nietzsche kontra Wagner',
  'Årsmöte',
  'Midsommar Stockholm Midsommarfirande den 19 juni – stång, ringlekar och dans',
  'Höstlov på Tekniska museet',
  'Järfällabadet BAD & GYM',
  'Akalla 4H-gård',
  'Tyresta Nationalpark',
  'Designsamtal med Therese Lindahl',
  'Graveyard & Blues Pills',
  'THE BLACK DAHLIA MURDER - TWO DECADES OF NOCTURNAL-EUROPÉ 2027',
  'Elvis, Elvis, Elvis! - 2026',
  'Somayas mammafika',
  'Storytelling och Stop Motion',
  'Julen dansas ut – Gudhems samhälle',
  'Cruising ströget i Falköping – Bilutställning',
  'Improvisationsteater nybörjare förlängning måndagar kl 17.10 start 9 nov',
  'Helgkurs – Improvisationsteater Karaktär 21-22 november',
  'Komisk grundkurs 28-29 november',
  'Stand-up för nybörjare måndagar kl 17.10 start 9 november',
  'Julmarknad på Nordiska museet',
  'Lär dig stöpa ljus med bivax',
  'Luciakonsert med Dalarnas Lussibrud',
  'Nina Varumo möter Mikael Niemi',
  'Lär dig tälja köksredskap',
  'Utställning: Fritt fall – om modet att släppa taget – Jenny Axelsson',
  'Samtal på Systervåningen: Narrativ salong – Livsmod och vemod',
  'Nyanser av Södermalm: fotografer ger sin bild av Södermalm och Slussen',
  'Workshop: Fånga stan – Urban Sketchers på Spårvägsmuseet',
  'Öppet hus på Kungliga Svenska Balettskolan',
  'Här firas Beaujolais Nouveau 2026 i Stockholm',
  'Elisabeth Ohlson – Retrospektiv',
  'Tigran Hamasyan',
  'Natten & jazzen',
  'Öppen verkstad för unga 16–24 år',
  'Guldgruvan – alternativ standup (gratis inträde)',
  'Blue Hour på Kungliga Operan',
  'Eva Dahlgren spelar på Cirkus',
  // MÄTTA FALSKLARM (2026-11-01) — riktiga evenemang med frågetecken i
  // titeln. Ett frågetecken ensamt är därför INTE en artikelmarkör.
  'Benjamin Ingrosso – What Happens Next?',
  '15 Minutes of Art: Will You Be Profitable, My Friend?',
];

describe('eventLikeness — titlar', () => {
  it('fäller artikelrubriker', () => {
    const missed = ARTICLE_TITLES.filter((t) => classifyTitleShape(t) !== 'article');
    expect(missed).toEqual([]);
  });

  it('fällar INTE riktiga evenemangstitlar', () => {
    const wronglyBlocked = EVENT_TITLES.filter((t) => classifyTitleShape(t) === 'article');
    expect(wronglyBlocked).toEqual([]);
  });

  it('känner igen en del evenemang som evenemang (negativ kontroll på den andra sidan)', () => {
    const events = EVENT_TITLES.filter((t) => classifyTitleShape(t) === 'event');
    // Mätt 2026-11-01: bara 7 av 37 riktiga evenemangstitlar har något
    // aktivitetsord. Det är i linje med titelanalysen (46 % av grafens titlar
    // saknar aktivitetsord — de är produktions- eller artistnamn). Kravet är
    // därför INTE "de flesta känns igen", utan "inga riktiga evenemang fälls"
    // (testet ovan) och "en del känns igen".
    expect(events.length).toBeGreaterThanOrEqual(5);
  });

  it('tomt eller saknat → unknown, aldrig article', () => {
    expect(classifyTitleShape(null)).toBe('unknown');
    expect(classifyTitleShape('')).toBe('unknown');
    expect(classifyTitleShape('   ')).toBe('unknown');
  });
});

describe('eventLikeness — sidans egna deklarationer', () => {
  it('en NewsArticle är en artikel (starkt bevis)', () => {
    const r = classifyPageSignals({ jsonLdTypes: ['WebPage', 'NewsArticle', 'BreadcrumbList'] });
    expect(r.verdict).toBe('article');
    expect(r.declaredArticle).toBe(true);
  });

  it('en Article-JSON-LD är en artikel', () => {
    const r = classifyPageSignals({ jsonLdTypes: ['Article', 'WebPage', 'Organization'] });
    expect(r.verdict).toBe('article');
  });

  it('"Läsningstid:" i beskrivningen är en artikel (struktur, inte ämnesord)', () => {
    const r = classifyPageSignals({
      description: 'Läsningstid: 3 min Uppdaterat: 07 December 2025 Sammanfattning Samuel L. Jackson är en av filmvärldens mest framgångsrika…',
    });
    expect(r.verdict).toBe('article');
  });

  it('en Event-JSON-LD är ett evenemang', () => {
    const r = classifyPageSignals({ jsonLdTypes: ['Event', 'WebPage'] });
    expect(r.verdict).toBe('event');
    expect(r.declaredEvent).toBe(true);
  });

  it('SAKNAR Event-typ är INTE bevis för artikel (mätt: royaldjurgarden)', () => {
    // Mätt 2026-11-01: royaldjurgarden.se/julmarknad-pa-nordiska-museet är ett
    // riktigt evenemang men saknar JSON-LD helt. Ett event-fel på "ingen
    // Event-typ" hade tagit bort ett riktigt evenemang.
    const r = classifyPageSignals({ jsonLdTypes: ['WebPage'] });
    expect(r.verdict).not.toBe('article');
  });

  it('og:type=article ensamt räcker INTE — mätt: royaldjurgarden är ett riktigt evenemang', () => {
    // Mätt 2026-11-01: royaldjurgarden.se/julmarknad-pa-nordiska-museet bär
    // `og:type=article` men ÄR ett evenemang. En gate som blockerade på
    // og:type ensamt hade tagit bort en bra källa.
    const bare = classifyPageSignals({ ogType: 'article' });
    expect(bare.declaredArticle).toBe(false);
    expect(bare.verdict).not.toBe('article');
    // Det noteras ändå som ett skäl — bara inte som bevis.
    expect(bare.reasons.join(' ')).toContain('og:type');
  });

  it('en Event-JSON-LD vinner över og:type=article', () => {
    const withEventType = classifyPageSignals({ ogType: 'article', jsonLdTypes: ['Event'] });
    expect(withEventType.verdict).toBe('event');
  });
});

describe('eventLikeness — sammansatt bedömning', () => {
  it('en majoritet artiklar → article', () => {
    const a = assessLikeness([
      { title: 'Har du glömt något på Kulturfestivalen?' },
      { title: 'Så väljer du ekologisk gurkmeja för kök och produktion' },
      { title: 'Därför dominerar mytologi och slott bland europeiska spelteman' },
    ]);
    expect(a.verdict).toBe('article');
    expect(shouldBlockPromotion(a).blocked).toBe(true);
  });

  it('kollaborationse-mönstret (4 artiklar av 8) → article (mätt 2026-11-01)', () => {
    const a = assessLikeness([
      { title: 'Så funkar hemmets teknik från första fiberkabel till varm dusch' },
      { title: 'Så väljer du ekologisk gurkmeja för kök och produktion' },
      { title: 'Därför dominerar mytologi och slott bland europeiska spelteman' },
      { title: 'Därför är företagstelefonin en samarbetsfråga, inte bara en IT-fråga' },
      { title: 'Rätt säsong för din resa till Thailand: Upptäck destinationer för hela året' },
      { title: 'Elbilsladdning nattetid: så sparar du 3 000 kr/år automatiskt' },
      { title: 'Samarbete vid spelbordet: Regler och taktiska signaler i kortspelet Tecken' },
      { title: 'Hur Streamingplattformar Förändrar Hur Vi Ser På Film' },
    ]);
    expect(a.verdict).toBe('article');
  });

  it('EN artikelrubrik blockerar inte (biljettnuse: riktiga konserter med frågetecken)', () => {
    const a = assessLikeness([
      { title: 'Benjamin Ingrosso – What Happens Next?' },
      { title: 'Benjamin Ingrosso – What Happens Next?' },
      { title: 'Natten & jazzen' },
      { title: 'Tigran Hamasyan' },
    ]);
    expect(a.verdict).not.toBe('article');
    expect(shouldBlockPromotion(a).blocked).toBe(false);
  });

  it('thatsupse-mönstret (4 guider av 65 rader) → INTE blockerad', () => {
    // Riktiga proportioner: thatsupse levererade 65 rader varav 4 var
    // guide-artiklar ("Tips på …", "Guiden till …", "Saker att göra …",
    // "Höstlov i Stockholm – här hittar du …") — 6 %. En källa med 4 guider
    // bland 65 rader ska INTE blockeras.
    const guides = [
      'Tips på höstens bästa utställningar i Stockholm',
      'Saker att göra i Stockholm i helgen',
      'Guiden till halloweenfester i Stockholm',
      'Höstlov i Stockholm – här hittar du roliga saker att göra',
    ];
    const events = Array.from({ length: 61 }, (_, i) => ({
      title: `${EVENT_TITLES[i % EVENT_TITLES.length]} (${i})`,
    }));
    const a = assessLikeness([...guides.map((title) => ({ title })), ...events]);
    expect(a.articleRows).toBe(4);
    expect(a.verdict).not.toBe('article');
  });

  it('en blandad källa med tydlig event-majoritet → event (blir INTE blockerad)', () => {
    const a = assessLikeness([
      { title: 'Helgkurs – Improvisationsteater Karaktär 21-22 november' },
      { title: 'Komisk grundkurs 28-29 november' },
      { title: 'Saker att göra i Stockholm i helgen' },
    ]);
    expect(a.verdict).toBe('event');
    expect(shouldBlockPromotion(a).blocked).toBe(false);
  });

  it('okända rader blockerar aldrig (konservativt)', () => {
    const a = assessLikeness([
      { title: 'Tigran Hamasyan' },
      { title: 'Natten & jazzen' },
      { title: 'Årsmöte' },
    ]);
    expect(a.verdict).toBe('unknown');
    expect(shouldBlockPromotion(a).blocked).toBe(false);
  });

  it('tomt underlag ger unknown, inte article', () => {
    const a = assessLikeness([]);
    expect(a.verdict).toBe('unknown');
    expect(shouldBlockPromotion(a).blocked).toBe(false);
  });

  it('sidans deklaration väger tyngre än titeln', () => {
    // En rad som LÅTER som ett evenemang men vars sida säger NewsArticle.
    const a = assessLikeness([
      { title: 'Guldgruvan – alternativ standup', page: { jsonLdTypes: ['NewsArticle'] } },
      { title: 'Guldgruvan – alternativ standup', page: { jsonLdTypes: ['NewsArticle'] } },
    ]);
    expect(a.verdict).toBe('article');
  });
});

describe('eventLikeness — avkodning', () => {
  it('avkodar HTML-entiteter', () => {
    expect(decodeEntities('DAVID BINNEY &#38; LOUIS COLE')).toBe('DAVID BINNEY & LOUIS COLE');
    expect(decodeEntities('Match &#8211; AIK')).toBe('Match – AIK');
    expect(decodeEntities('Ekonomi &#038; Företag')).toBe('Ekonomi & Företag');
    expect(decodeEntities('a &amp; b')).toBe('a & b');
  });

  it('avkodar en titel med entitet innan den klassas', () => {
    expect(classifyTitleShape('Så väljer du ekologisk gurkmeja &#8211; hela &#246;r')).toBe('article');
  });
});
