/**
 * fallbackHierarchy.ts — graceful fallback-kedja när LLM-pipelinen inte
 * producerar en godkänd beskrivning.
 *
 * Designprincip (2026-10-08):
 *   När LLM-pipelinen misslyckas (factuality/independence/data-quality) ska
 *   användaren FORTFARANDE få en beskrivning — bara på lägre nivå. Hellre
 *   en tråkig faktalista än ingenting alls.
 *
 *   GOOD     = LLM-genererad text som passerat factuality + independence
 *   FACT     = faktalista från Profile (ingen LLM) — aldrig meningar, bara
 *              strukturerade fält separerade med skiljetecken
 *   MINIMAL  = titel + venue + datum (allra sista utväg)
 *   NULL     = inte ens detta (returnera tom sträng)
 *
 *   Fallback-trappan triggas när:
 *     - LLM misslyckas med factuality/independence efter maxAttempts
 *     - dataQuality.conflict = true OCH Profile.inferred_event_type skilt
 *       från original (dvs Profile verkar fel — använd FACT med försiktighet)
 *
 *   Fallback-text är ALLTID:
 *     - Deterministisk (samma input → samma output)
 *     - Kortare än GOOD (1-3 meningar)
 *     - Heltäckande (mindre risk för faktualitetsfel)
 *     - På profilens huvudsakliga språk (default svenska)
 *
 * Steg 5/15 i P7 Definition of Done.
 */

import type { EventProfile } from './types';
import type { EventUnderstandingInput } from './eventUnderstanding';

// ─── Public types ─────────────────────────────────────────────────────────────

export type FallbackLevel = 'FACT' | 'MINIMAL' | null;

export interface FallbackResult {
  /** Vilken nivå vi landade på. */
  level: FallbackLevel;
  /** Texten som ska användas (tom sträng om level=null). */
  text: string;
  /** Vilka Profile-fält som användes (för loggning/audit). */
  sources: string[];
  /** Ordräkning (för metrics). */
  word_count: number;
  /** info_level som motsvarar denna fallback. */
  info_level: 'LOW' | 'VERY_LOW';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Välj primärt språk från Profile.language. Default 'sv'.
 */
function primaryLanguage(profile: EventProfile): string {
  return profile.language?.[0] ?? 'sv';
}

/**
 * Plocka ut de fält vi kan använda i FACT-läge.
 * Returnerar en lista med (label, value) par BARA om värdet är meningsfullt.
 */
function collectFactFields(
  profile: EventProfile,
  event: EventUnderstandingInput,
): Array<{ label: string; value: string; source: string }> {
  const out: Array<{ label: string; value: string; source: string }> = [];

  // 1. Performers (artister)
  if (profile.performers.length > 0) {
    out.push({
      label: 'Medverkande',
      value: profile.performers.join(', '),
      source: 'performers',
    });
  }

  // 2. Genres
  if (profile.genres.length > 0) {
    out.push({
      label: 'Genre',
      value: profile.genres.join(', '),
      source: 'genres',
    });
  }

  // 3. Duration (bara om vi har det)
  if (profile.duration_minutes != null && profile.duration_minutes > 0) {
    const h = Math.floor(profile.duration_minutes / 60);
    const m = profile.duration_minutes % 60;
    let durStr = '';
    if (h > 0) durStr += `${h} tim`;
    if (m > 0) durStr += ` ${m} min`;
    if (durStr) {
      out.push({
        label: 'Längd',
        value: durStr.trim(),
        source: 'duration_minutes',
      });
    }
  }

  // 4. Setting (typ av lokal)
  if (profile.setting) {
    out.push({
      label: 'Lokal',
      value: profile.setting,
      source: 'setting',
    });
  }

  // 5. Concept (om det finns något vettigt)
  if (profile.concept && profile.concept.length > 0 && profile.concept.length < 100) {
    out.push({
      label: 'Koncept',
      value: profile.concept,
      source: 'concept',
    });
  }

  // 6. Repertoire (om vi har extrakterat verk)
  if (profile.repertoire && profile.repertoire.length > 0) {
    out.push({
      label: 'Repertoar',
      value: profile.repertoire.join('; '),
      source: 'repertoire',
    });
  }

  // 7. Ensemble (orkesternamn)
  if (profile.ensemble && profile.ensemble.length > 0 && profile.ensemble.length < 60) {
    out.push({
      label: 'Ensemble',
      value: profile.ensemble,
      source: 'ensemble',
    });
  }

  // 8. Audience / target (om vettigt)
  if (profile.target_audience && profile.target_audience.length > 0) {
    out.push({
      label: 'För',
      value: profile.target_audience.join(', '),
      source: 'target_audience',
    });
  }

  // 9. Venue-namn (om inte redan i setting)
  if (event.venue_name && !out.some((f) => f.source === 'setting')) {
    out.push({
      label: 'Plats',
      value: event.venue_name,
      source: 'venue_name',
    });
  }

  // 10. Datum (ger unikhet vid samma title/venue — samma show, olika datum)
  // [FAS 5.2 2026-10-14] Title + venue + datum = garanterat unikt per event
  if (event.start_time) {
    const d = new Date(event.start_time);
    if (!isNaN(d.getTime())) {
      const dateStr = formatDate(event.start_time);
      if (dateStr) {
        out.push({
          label: 'Datum',
          value: dateStr,
          source: 'start_time',
        });
      }
    }
  }

  // 11. Pris (om känt och inte gratis)
  if (event.is_free === true) {
    out.push({ label: 'Pris', value: 'gratis', source: 'is_free' });
  } else if (event.price_min_sek != null && event.price_min_sek > 0) {
    out.push({
      label: 'Pris',
      value: `från ${event.price_min_sek} kr`,
      source: 'price_min_sek',
    });
  }

  return out;
}

// ─── FACT-level fallback ─────────────────────────────────────────────────────

/**
 * Bygg en faktalista-beskrivning från Profile.
 *
 * Format: "Typ: <event_type>. <label>: <value>. <label>: <value>."
 *
 * Returnerar { level: null, text: '' } om Profile har så lite info att inte
 * ens en faktalista blir meningsfull (då bör vi gå till MINIMAL istället).
 */
export function buildFactBasedFallback(
  profile: EventProfile,
  event: EventUnderstandingInput,
): FallbackResult {
  const fields = collectFactFields(profile, event);

  // Minst 2 meningsfulla fält krävs för att FACT ska vara värt det.
  // Annars går vi vidare till MINIMAL.
  if (fields.length < 2) {
    return { level: null, text: '', sources: [], word_count: 0, info_level: 'VERY_LOW' };
  }

  // Bygg mening: title först (ger unikhet per event), sedan Typ + fält
  // [FAS 5.2 2026-10-14] Title-prefix gör att FACT blir unikt per event —
  // utan detta blev 1700+ community-events identiska.
  const lang = primaryLanguage(profile);
  const typeLabel = lang === 'sv' ? 'Typ' : 'Type';
  const parts: string[] = [];

  // Title som första fält — ger unikhet (title är required och per-event)
  const title = event.title?.trim();
  if (title && title.length > 0 && title.length < 200) {
    // Skydd mot title som ser ut som hel mening med skiljetecken i slutet
    const cleanTitle = title.replace(/[.!?]+$/, '').trim();
    parts.push(`${cleanTitle}.`);
  }

  parts.push(`${typeLabel}: ${profile.event_type}.`);

  for (const f of fields) {
    // Skydd: värdet får inte innehålla hela meningar (skulle kunna vara brus
    // från semantic extraction eller felaktigt fält)
    const cleanValue = f.value.replace(/[.!?]{2,}/g, '.').trim();
    if (cleanValue.length === 0 || cleanValue.length > 200) continue;
    parts.push(`${f.label}: ${cleanValue}.`);
  }

  const text = parts.join(' ');
  return {
    level: 'FACT',
    text,
    sources: fields.map((f) => f.source),
    word_count: text.split(/\s+/).filter(Boolean).length,
    info_level: 'LOW',
  };
}

// ─── MINIMAL-level fallback ──────────────────────────────────────────────────

/**
 * Bygg en minimal-beskrivning med bara det allra nödvändigaste.
 *
 * Format: "<title> — <venue>, <date>."
 *
 * Används när Profile har för lite info för FACT. Fungerar som "sista
 * utväg" innan NULL.
 */
export function buildMinimalFallback(
  event: EventUnderstandingInput,
): FallbackResult {
  const sources: string[] = [];
  const parts: string[] = [];

  // Titel (obligatoriskt)
  const title = event.title?.trim();
  if (!title || title.length === 0) {
    return { level: null, text: '', sources: [], word_count: 0, info_level: 'VERY_LOW' };
  }
  parts.push(title);
  sources.push('title');

  // Venue
  if (event.venue_name) {
    parts.push(` — ${event.venue_name}`);
    sources.push('venue_name');
  }

  // Datum
  if (event.start_time) {
    const date = formatDate(event.start_time);
    if (date) {
      parts.push(`, ${date}`);
      sources.push('start_time');
    }
  }

  // Pris om känt
  if (event.is_free === true) {
    parts.push(' (gratis)');
    sources.push('is_free');
  } else if (event.price_min_sek != null && event.price_min_sek > 0) {
    parts.push(` (från ${event.price_min_sek} kr)`);
    sources.push('price_min_sek');
  }

  const text = parts.join('') + '.';
  return {
    level: 'MINIMAL',
    text,
    sources,
    word_count: text.split(/\s+/).filter(Boolean).length,
    info_level: 'VERY_LOW',
  };
}

/**
 * Formatera ISO-datum till läsbar svensk form: "8 oktober 2026".
 */
function formatDate(iso: string): string | null {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const months = [
      'januari', 'februari', 'mars', 'april', 'maj', 'juni',
      'juli', 'augusti', 'september', 'oktober', 'november', 'december',
    ];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return null;
  }
}

// ─── Huvudväljare ────────────────────────────────────────────────────────────

/**
 * Välj bästa möjliga fallback-nivå i ordning FACT → MINIMAL → null.
 *
 * Logik:
 *   1. Försök FACT (kräver minst 2 meningsfulla fält)
 *   2. Om FACT inte fungerar → försök MINIMAL (kräver bara titel)
 *   3. Om inte ens MINIMAL fungerar → returnera null (tom sträng)
 */
export function chooseFallback(
  profile: EventProfile,
  event: EventUnderstandingInput,
): FallbackResult {
  // 1. Försök FACT
  const fact = buildFactBasedFallback(profile, event);
  if (fact.level === 'FACT') return fact;

  // 2. Försök MINIMAL
  const minimal = buildMinimalFallback(event);
  if (minimal.level === 'MINIMAL') return minimal;

  // 3. Ge upp
  return { level: null, text: '', sources: [], word_count: 0, info_level: 'VERY_LOW' };
}
