/**
 * dataQualityCheck.ts — semantisk datakvalitetsgrind (evidence fusion) mellan
 * Event Understanding och Editorial Writer (P7, steg 4 i pipelinen).
 *
 *   buildEventProfile() → checkDataQuality() → runEditorialPipeline()
 *
 * Designprincip (omarbetad 2026-10-08 efter användar-feedback):
 *
 *   Gate är EVIDENCE FUSION — den LISTAR alla signaler som talar för och
 *   emot nuvarande kategori. Den muterar INTE Profile.
 *
 *   Konflikter upptäcks via FLERA oberoende starka signaler. En enskild
 *   keyword-match räcker INTE för att flagga kategori som fel. Gate skyddar
 *   Writer från dålig metadata; den är INTE ett category-classification-system.
 *
 * Vad den returnerar (evidence fusion):
 *   - original_event_type     (vad Profile.event_type är just nuvarande)
 *   - inferred_event_type     (vad våra signaler tyder på, eller null vid svag evidens)
 *   - evidence[]              (varje signal: type, polarity, weight, message)
 *   - conflict                (true om ≥2 starka signaler motsäger original)
 *   - confidence              (0..1; hur stark evidensen är östraidge)
 *
 * Zurich-pattern (exempel på korrekt detektering):
 *
 *   original_event_type = exhibition
 *   evidence:
 *     - {polarity: against, weight: high, type: title_keyword,
 *        message: "Title innehåller 'Orchestra' / 'Symphony'"}
 *     - {polarity: against, weight: medium, type: structured_dl,
 *        message: "Profile saknar artister (artistResolver-resultat)"}
 *     - {polarity: against, weight: high, type: source_signal,
 *        message: "raw_description innehåller 'Rachmaninov', 'Berwald',
 *                  'Sibelius', 'orkester' (signalerar music)"}
 *   inferred_event_type = music
 *   conflict = true
 *   confidence = HIGH
 *
 * Steg 4/15 i P7 Definition of Done. Omarbetad 2026-10-08.
 */

import type { EventProfile } from './types';
import type { EventUnderstandingInput } from './eventUnderstanding';

// ─── Public types ─────────────────────────────────────────────────────────────

export type IssueSeverity = 'low' | 'medium' | 'high';
export type EvidencePolarity = 'for' | 'against' | 'neutral';
export type EvidenceType =
  | 'title_keyword'
  | 'venue_category'
  | 'performer_signal'
  | 'structured_signal'
  | 'source_signal'
  | 'category_default';

export interface DataQualityEvidence {
  type: EvidenceType;
  /** 'for' stödjer original_event_type, 'against' motsäger. */
  polarity: EvidencePolarity;
  weight: IssueSeverity;
  message: string;
}

export interface DataQualityReport {
  /** Vad Profile.event_type är (oförändrat). */
  original_event_type: string;
  /** Vad våra signaler tyder på, eller null om svag evidens. */
  inferred_event_type: string | null;
  /** Lista alla signaler (för loggning/audit). */
  evidence: DataQualityEvidence[];
  /** True om minst två starka (high/medium) mot-evidens-signaler finns. */
  conflict: boolean;
  /** 0..1 (1.0 = alla signaler stödjer original). */
  confidence: number;
  /** Tidsstämpel för loggning. */
  checked_at: string;
}

// ─── Kategori-klassificering ─────────────────────────────────────────────────

const MUSIC_CATEGORIES = new Set([
  'music', 'concert',
  'rock', 'pop', 'jazz', 'classical', 'electronic', 'hip-hop', 'folk', 'world',
  'metal', 'punk', 'reggae', 'soul', 'funk', 'blues', 'country', 'opera',
]);

const EXHIBITION_CATEGORIES = new Set([
  'exhibition', 'art-exhibitions', 'gallery', 'museum',
]);

const SPORT_CATEGORIES = new Set([
  'sports', 'sport',
]);

const THEATER_CATEGORIES = new Set([
  'theater', 'theatre-drama', 'theatre-comedy', 'standup', 'comedy',
  'musical-theatre', 'dance', 'circus',
]);

function classifyCategory(slug?: string | null): {
  is_music: boolean;
  is_exhibition: boolean;
  is_sport: boolean;
  is_theater: boolean;
} {
  if (!slug) {
    return { is_music: false, is_exhibition: false, is_sport: false, is_theater: false };
  }
  return {
    is_music: MUSIC_CATEGORIES.has(slug),
    is_exhibition: EXHIBITION_CATEGORIES.has(slug),
    is_sport: SPORT_CATEGORIES.has(slug),
    is_theater: THEATER_CATEGORIES.has(slug),
  };
}

// ─── Keyword-scanning (evidence-signal — inte facit) ─────────────────────────

const MUSIC_TITLE_KEYWORDS = [
  'konsert', 'spelar', 'band', 'turné', 'turnerar', 'live', 'gig', 'show',
  'sjunger', 'framträder', 'framför', 'konsertserie', 'turnépremiär',
  'spelning', 'livespelning', 'liveshow', 'festival', 'scenframträdande',
  // Klassiska musik-specifika termer:
  'orchestra', 'orkester', 'symfoni', 'symphony', 'philharmonic',
  'filharmonisk', 'kammarensemble', 'stråkkvartett', 'blåskvartett',
  'recital', 'konsertmästare',
];

const EXHIBITION_TITLE_KEYWORDS = [
  'utställning', 'galleri', 'verk', 'curator', 'curaterad', 'målning',
  'skulptur', 'installation', 'konst', 'konsthall', 'museum', 'vernissage',
  'öppet hus', 'utställningspremiär',
];

const SPORT_TITLE_KEYWORDS = [
  'match', 'tävling', 'cup', 'liga', 'serie', 'playoff', 'final', 'semifinal',
  'derby', 'träningsmatch', 'vänskapsmatch', 'mästerskap', 'tour',
];

const MUSIC_SOURCE_KEYWORDS = [
  // Klassiska musik/kompositörer (används för att fånga Zurich-pattern)
  'orkester', 'symfoniorkester', 'filharmonisk', 'kammarmusik', 'recital',
  'pianokonsert', 'violinkonsert', 'cellokonsert', 'konsertmästare',
  'sinfonietta', 'kammarorkester',
  'rachmaninov', 'sibelius', 'beethoven', 'mozart', 'chopin', 'tchaikovsky',
  'mahler', 'debussy', 'ravel', 'strauss', 'brahms', 'schubert', 'schumann',
  'berwald', 'stenhammar', 'lindblad', 'roman',
  'pianosolist', 'solist', 'orkesteri', 'uvertyr', 'symfoni',
];

function countHits(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw));
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

/**
 * EVIDENCE FUSION-GATE: Returnerar alla signaler som stödjer/motsäger
 * nuvarande kategori. Muterar INTE Profile.
 *
 * Användning: Läs report.conflict och report.inferred_event_type. Vid conflict
 * är det upp till caller (runEditorialPipeline / integration) att besluta om
 * FACT-BASED fallback eller liknande.
 */
export function checkDataQuality(
  input: EventUnderstandingInput,
  profile: EventProfile,
): DataQualityReport {
  const evidence: DataQualityEvidence[] = [];
  const cat = classifyCategory(input.category_slug);
  const venue = (input.venue_type ?? '').toLowerCase().trim();
  const title = (input.title ?? '').toLowerCase();
  const originalEventType = profile.event_type;

  // ── Signalgrupp 1: Venue-typ ↔ kategori ─────────────────────────────────
  // Venue-typ är en strukturerad EVIDENCE — inte facit. Vi väger den som
  // medium om den talar starkt mot.
  if (cat.is_exhibition && (venue === 'arena' || venue === 'club' || venue === 'concert_hall')) {
    evidence.push({
      type: 'venue_category',
      polarity: 'against',
      weight: 'high',
      message: `venue_type="${venue}" är ovanligt för utställning — brukar vara konsert/musik`,
    });
  } else if (cat.is_music && (venue === 'gallery' || venue === 'museum')) {
    evidence.push({
      type: 'venue_category',
      polarity: 'against',
      weight: 'high',
      message: `venue_type="${venue}" är ovanligt för musik — brukar vara utställning`,
    });
  } else if (cat.is_sport && (venue === 'theater' || venue === 'concert_hall')) {
    evidence.push({
      type: 'venue_category',
      polarity: 'against',
      weight: 'medium',
      message: `venue_type="${venue}" ovanligt för sport`,
    });
  } else if (cat.is_theater && (venue === 'gallery' || venue === 'museum')) {
    evidence.push({
      type: 'venue_category',
      polarity: 'neutral',
      weight: 'low',
      message: `venue_type="${venue}" möjligt för performance art/föreläsning`,
    });
  }

  // ── Signalgrupp 2: Titel-keywords ───────────────────────────────────────
  // Keywords ÄR EVIDENCE — en enskild keyword väger low. Flera → medium/high.
  if (title) {
    if (cat.is_exhibition) {
      const musicHits = countHits(title, MUSIC_TITLE_KEYWORDS);
      if (musicHits.length >= 1 && !title.includes('utställning')) {
        evidence.push({
          type: 'title_keyword',
          polarity: 'against',
          weight: musicHits.length >= 3 ? 'high' : musicHits.length >= 2 ? 'medium' : 'low',
          message: `Title innehåller musik-nyckelord: ${musicHits.join(', ')}`,
        });
      }
    }
    if (cat.is_music) {
      const exHits = countHits(title, EXHIBITION_TITLE_KEYWORDS);
      if (exHits.length >= 1 && !title.includes('konsert')) {
        evidence.push({
          type: 'title_keyword',
          polarity: 'against',
          weight: exHits.length >= 3 ? 'high' : exHits.length >= 2 ? 'medium' : 'low',
          message: `Title innehåller utställnings-nyckelord: ${exHits.join(', ')}`,
        });
      }
    }
    if (cat.is_sport) {
      const musicHits = countHits(title, MUSIC_TITLE_KEYWORDS);
      if (musicHits.length >= 2) {
        evidence.push({
          type: 'title_keyword',
          polarity: 'against',
          weight: 'low',
          message: `Title innehåller många musik-nyckelord: ${musicHits.join(', ')}`,
        });
      }
    }
  }

  // ── Signalgrupp 3: Performers ↔ kategori ────────────────────────────────
  if (cat.is_exhibition && profile.performers.length >= 1) {
    const isPerformanceArt =
      title.includes('performance') ||
      title.includes('föreställning') ||
      title.includes('live art') ||
      title.includes('levande');
    if (!isPerformanceArt) {
      evidence.push({
        type: 'performer_signal',
        polarity: 'against',
        weight: 'medium',
        message: `Profile har artister (${profile.performers.join(', ')}) — ` +
                 `utställning kan ha det om performance art, men verifiera.`,
      });
    }
  }

  // Music + 0 performers + title med musik-nyckelord = SVAG mot-evidens
  // (artistResolver kan ha missat, men vi vet inte säkert).
  if (cat.is_music && profile.performers.length === 0 && title) {
    const hasMusicHint = countHits(title, MUSIC_TITLE_KEYWORDS).length >= 1;
    if (!hasMusicHint) {
      evidence.push({
        type: 'performer_signal',
        polarity: 'against',
        weight: 'low',
        message: `Musik-kategori men Profile saknar artister — ` +
                 `artistResolver kan ha missat.`,
      });
    }
  }

  // ── Signalgrupp 4: Source-signal (om caller skickar source-text) ────────
  // Användaren kan skicka description_text som extra hinting till gate (men
  // INTE till Writer — den är låst av textual firewall).
  const sourceText = (input as { description_text?: string }).description_text;
  if (sourceText && typeof sourceText === 'string') {
    const sourceLower = sourceText.toLowerCase();
    if (cat.is_exhibition) {
      const musicHits = countHits(sourceLower, MUSIC_SOURCE_KEYWORDS);
      if (musicHits.length >= 2) {
        evidence.push({
          type: 'source_signal',
          polarity: 'against',
          weight: musicHits.length >= 5 ? 'high' : 'medium',
          message: `Source-text innehåller ${musicHits.length} musik-nyckelord: ${musicHits.slice(0, 5).join(', ')}${musicHits.length > 5 ? '...' : ''}`,
        });
      }
    }
    if (cat.is_music) {
      const exHits = countHits(sourceLower, EXHIBITION_TITLE_KEYWORDS);
      if (exHits.length >= 2) {
        evidence.push({
          type: 'source_signal',
          polarity: 'against',
          weight: exHits.length >= 5 ? 'high' : 'medium',
          message: `Source-text innehåller ${exHits.length} utställnings-nyckelord: ${exHits.slice(0, 5).join(', ')}`,
        });
      }
    }
  }

  // ── Beräkna conflict och inferred_event_type ──────────────────────────
  // Conflict kräver MINST TVÅ oberoende starka mot-signaler (high/medium).
  const strongAgainst = evidence.filter(
    (e) => e.polarity === 'against' && (e.weight === 'high' || e.weight === 'medium'),
  );
  const conflict = strongAgainst.length >= 2;

  // Försök härled inferred_event_type från starka mot-signaler.
  let inferredEventType: string | null = null;
  if (conflict) {
    // Om vi har mot-signaler som tyder på musik → 'music'.
    // Annars behåll null (vi säger bara "något är konstigt", inte vad).
    const musicSignals = strongAgainst.filter((e) =>
      e.type === 'title_keyword' || e.type === 'performer_signal' || e.type === 'source_signal',
    );
    const musicSourceHits = evidence.filter(
      (e) => e.type === 'source_signal' && e.message.toLowerCase().includes('musik'),
    ).length;
    const musicTitleHits = evidence.filter(
      (e) => e.type === 'title_keyword' && e.message.toLowerCase().includes('musik'),
    ).length;

    if (musicSignals.length >= 1 || musicSourceHits >= 1 || musicTitleHits >= 1) {
      inferredEventType = 'music';
    }
    // Vi sätter ALDRIG inferred_event_type till 'community' eller 'unknown'
    // om vi inte vet — hellre null än att gissa fel.
  }

  // ── Confidence: 1.0 om alla signaler är 'for' eller saknas. ───────────
  // Varje 'against' sänker confidence baserat på weight.
  let confidence = 1.0;
  for (const e of evidence) {
    if (e.polarity === 'against') {
      if (e.weight === 'high') confidence -= 0.25;
      else if (e.weight === 'medium') confidence -= 0.15;
      else confidence -= 0.05;
    }
  }
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    original_event_type: originalEventType,
    inferred_event_type: inferredEventType,
    evidence,
    conflict,
    confidence: Math.round(confidence * 100) / 100,
    checked_at: new Date().toISOString(),
  };
}