/**
 * attributionTier1.js — FAS 3.2 / klient-side attribution (2026-10-13).
 *
 * Varför denna modul finns separat från 04-Normalizer/editorial:
 * 06-UI är Expo/React Native med Metro-bundler, kan inte direkt importera
 * TypeScript-moduler från 04-Normalizer. Så vi har en liten JS-version
 * av samma logik som kör helt på klienten, baserad på den curaterade
 * stockholm-gazetteer.json som den enda datakällan.
 *
 * Syfte: ge användaren attribution-raden "Artistinfo från öppna
 * datakällor (MusicBrainz)" UTAN att vänta på DB-migration + backfill.
 * När migration är på plats och event_profile är populerad kommer denna
 * modul att ersättas av buildAttribution() som läser från profile.
 *
 * Dataläcka (2026-10-13): 21 artister (curerade) + 5 ämnen/keywords.
 * - Sökning: case-insensitive på ord i title
 * - Returnerar: tier1-text + lista av källor (för disclosure Tier 2)
 *
 * Säkerhet:
 * - Inget nätverksanrop — allt är inline JSON
 * - Inga råa HTML-entity-issues — vi tar emot redan dekoderade strängar
 * - Inget beroende på Node-only APIs
 */

// Curerade artister (subset av stockholm-gazetteer.json — bara de som
// rimligen dyker upp i Stockholm-musikscenen och som täcker vanliga
// title-mönster). Format: [{name, country, type, sources: ['musicbrainz']}]
//
// Vi har valt att bara inkludera MusicBrainz som källa här — Wikidata
// finns redan via 04-Normalizer/editorial/subjectCache om vi har den
// importable, men den är TS. Håller denna modul JS-ren.
const CURATED_ARTISTS = [
  { name: 'Donovan Woods', country: 'CA', sources: ['musicbrainz'] },
  { name: 'Veronica Maggio', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Håkan Hellström', aliases: ['Hakan Hellstrom'], country: 'SE', sources: ['musicbrainz'] },
  { name: 'Anna von Hausswolff', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Lars Jansson', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Erik Söderlind', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Helene Berg', country: 'NO', sources: ['musicbrainz'] },
  { name: 'Paul Pignon', country: 'NO', sources: ['musicbrainz'] },
  { name: 'Ida Lundén', aliases: ['Ida Lunden'], country: 'SE', sources: ['musicbrainz'] },
  { name: 'Thomas Bjelkeborn', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Eva Lindal', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Philippe Moenne-Loccoz', country: 'CH', sources: ['musicbrainz'] },
  { name: 'Måns Möller', aliases: ['Mans Moller'], country: 'SE', sources: ['musicbrainz'] },
  { name: 'Tobias Erehed', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Dominik Henzel', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Anton Estby', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Henrythefreak', country: 'SE', sources: ['musicbrainz'] },
  { name: 'Sven Ingvars', aliases: ['Sven-Ingvars'], country: 'SE', sources: ['musicbrainz'] },
  { name: 'Radiokören', aliases: ['Radiokoren'], country: 'SE', sources: ['musicbrainz'] },
  { name: 'Peter Dijkstra', country: 'NL', sources: ['musicbrainz'] },
  { name: 'August Strindberg', country: 'SE', sources: ['musicbrainz'], kind: 'person' },
  { name: 'William Shakespeare', country: 'GB', sources: ['musicbrainz'], kind: 'person' },
  { name: 'Lars von Trier', country: 'DK', sources: ['musicbrainz'], kind: 'person' },
  { name: 'Skånes Dansteater', aliases: ['Skanes Dansteater'], country: 'SE', sources: ['musicbrainz'], kind: 'group' },
  { name: 'Escarleth Romo Pozo', country: '', sources: ['musicbrainz'] },
];

// Ämnen/keywords — matchar mot title för att indikera Wikidata
// som datakälla. Hålls liten och generell. Vi använder INTE word boundary
// på slutet (dvs. \b i slutet) eftersom svenska sammansatta ord är
// vanliga ("jazzkväll" innehåller "jazz").
const CURATED_TOPICS = [
  { name: 'jazz', match: /\bjazz/i, sources: ['wikidata'] },
  { name: 'klassisk musik', match: /\bklassisk|\bclassical/i, sources: ['wikidata'] },
  { name: 'ståuppkomik', match: /\bstandup|\bkomik|\bståupp/i, sources: ['wikidata'] },
  { name: 'litteratur', match: /\blitteratur|\bbokcirkel|\bförfattare/i, sources: ['wikidata'] },
  { name: 'AI', match: /\bAI|\bartificiell intelligens/i, sources: ['wikidata'] },
  { name: 'familj', match: /\bbarnlördag|\bfamilj| för barn/i, sources: ['wikidata'] },
];

// Organisationer (Wikidata) — matchar venue_name eller mot title
const CURATED_ORGS = [
  { name: 'Kungliga Operan', match: /\boperan\b|\bkungliga operan\b/i, sources: ['wikidata'] },
  { name: 'Dramaten', match: /\bdramaten\b/i, sources: ['wikidata'] },
  { name: 'Oscarsteatern', match: /\boscarsteatern\b/i, sources: ['wikidata'] },
  { name: 'Stadsbiblioteket', match: /\bstadsbiblioteket\b/i, sources: ['wikidata'] },
  { name: 'Kulturhuset', match: /\bkulturhuset\b/i, sources: ['wikidata'] },
];

/**
 * Hitta alla artister som matchar i title (case-insensitive).
 */
function findArtistsInText(text) {
  if (!text) return [];
  const lc = text.toLowerCase();
  const found = [];
  for (const a of CURATED_ARTISTS) {
    const candidates = [a.name, ...(a.aliases || [])];
    for (const c of candidates) {
      // Ord-baserad match (med word boundary) — undviker "Anna" i "Hannah"
      const re = new RegExp(`\\b${escapeRegex(c)}\\b`, 'i');
      if (re.test(text)) {
        if (!found.includes(a)) found.push(a);
        break;
      }
    }
  }
  return found;
}

function findTopicsInText(text) {
  if (!text) return [];
  const found = [];
  for (const t of CURATED_TOPICS) {
    if (t.match.test(text)) found.push(t);
  }
  return found;
}

function findOrgsInText(text) {
  if (!text) return [];
  const found = [];
  for (const o of CURATED_ORGS) {
    if (o.match.test(text)) found.push(o);
  }
  return found;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bygg Tier 1 attribution-text från en event-rad.
 *
 * @param {{ title?: string, venue_name?: string, category_slug?: string }} event
 * @returns {{ tier1: string|null, sources: string[] }}
 *   - tier1: en mening på svenska, eller null om inget hittades
 *   - sources: ['musicbrainz', 'wikidata'] — källor som hittades
 */
export function computeTier1Attribution(event) {
  if (!event) return { tier1: null, sources: [] };
  const title = event.title || '';
  const venue = event.venue_name || '';
  const text = `${title} ${venue}`.trim();
  if (!text) return { tier1: null, sources: [] };

  const artists = findArtistsInText(text);
  const topics = findTopicsInText(text);
  const orgs = findOrgsInText(text);

  const sources = new Set();
  for (const a of artists) for (const s of a.sources) sources.add(s);
  for (const t of topics) for (const s of t.sources) sources.add(s);
  for (const o of orgs) for (const s of o.sources) sources.add(s);

  if (sources.size === 0) return { tier1: null, sources: [] };

  // Bygg tier1-text baserat på vad vi hittade
  const sourceLabels = {
    musicbrainz: 'MusicBrainz',
    wikidata: 'Wikidata',
  };
  const sourceList = Array.from(sources).map((s) => sourceLabels[s] || s).join(', ');

  let subjectHint = '';
  if (artists.length > 0) {
    subjectHint = artists.length === 1
      ? ` (artisten ${artists[0].name})`
      : ` (${artists.length} artister)`;
  } else if (orgs.length > 0) {
    subjectHint = ` (${orgs[0].name})`;
  }

  return {
    tier1: `Artistinfo${subjectHint ? subjectHint : ''} från öppna datakällor (${sourceList}).`,
    sources: Array.from(sources),
  };
}

// Test-hjälp: lista alla artister (för debugging)
export const __test__ = {
  CURATED_ARTISTS,
  CURATED_TOPICS,
  CURATED_ORGS,
  findArtistsInText,
  findTopicsInText,
  findOrgsInText,
};
