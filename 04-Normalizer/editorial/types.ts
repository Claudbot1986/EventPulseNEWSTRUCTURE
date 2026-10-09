/**
 * Editorial Description Engine — TypeScript types.
 *
 * Detta är en NYTT lager ovanpå befintlig normalizer-flöde. Målet:
 *   source description → Event Understanding → STRUCTURED EVENT PROFILE
 *   → [TEXTUAL FIREWALL] → Editorial Writer → Factuality Check
 *   → Independence Check → EVENTPULSE DESCRIPTION
 *
 * Licens-grinden (resolveDescriptionLicense) rör vi INTE — den fortsätter
 * styra description_en/sv. Det nya lagret är ETT alternativ för events där
 * licens blockerar scraped text.
 *
 * Designprinciper (jfr 04-Normalizer/eventpulseSummary.ts — samma
 * faktabaserade utgångspunkt men med semantisk extraktion + Writer istället
 * för template):
 *   1. Profile byggs UTAN att läsa source description-texten (bara strukturerade
 *      fält, multi-source aggregering, faktabaserad extraktion).
 *   2. Writer får BARA Profile + EventPulse-data. Source-text rensas ut
 *      server-side (Textual Firewall).
 *   3. Factuality/independence är POST-write filter som kan regenerera Writer.
 *
 * 2026-10-07 — Steg 1 (P7) av EventPulse Editorial Description Engine.
 */

/**
 * JSON-värde (Supabase JSONB shape). Re-deklarerad lokalt för att inte
 * vara beroende av @supabase/supabase-js interna exports (vilka varierar
 * mellan versioner).
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Structured Event Profile (steg 2).
 *
 * Profile är SEMANTISK EXTRAKTION — betydelse, INTE formulering.
 * Profile ska kunna förstås utan att läsa originaltexten.
 * Profile är normaliserad på EN gång per event och återanvändas av:
 *   - Editorial Writer (beskrivning)
 *   - Recommendations (framtida)
 *   - Personalization (framtida)
 *   - Semantic search (framtida)
 *   - AI agent (framtida)
 */
export interface EventProfile {
  /** typ av event — music, theater, standup, exhibition, festival, workshop, screening, sport, community. */
  event_type: string;
  /** format — concert, reading, performance, talk, panel, installation, club_night. */
  event_format?: string;
  /** huvudsakliga artister/föreläsare/medverkande (normaliserade). */
  performers: string[];
  /** support acts, opening acts, secondary artists. */
  support_acts?: string[];
  /** ensemble-sammansättning om känt, t.ex. 'six-piece band', 'string quartet', 'solo piano'. */
  ensemble?: string;
  /** genrer (normaliserade, t.ex. jazz, classical, electronic). */
  genres: string[];
  /** subgenrer. */
  subgenres?: string[];
  /** vad programmet/programmet INNEHÅLLER (faktiskt innehåll, inte slogans). */
  content: string[];
  /** teman eventet utforskar (kärlek, död, politik, etc.). */
  themes?: string[];
  /** konceptuell beskrivning — vad gör eventet unikt jämfört med andra av samma typ. */
  concept?: string;
  /** upplevelsekaraktär — hur upplevs det (live, intim, stor, familjevänlig, etc.). */
  experience_characteristics: string[];
  /** performance-stil — interpretativ, experimentell, klassisk, etc. */
  performance_style?: string;
  /** aktiviteter för publiken (deltagande, lyssning, dans, mingel). */
  audience_participation?: string[];
  /** språk för eventet. */
  language: string[];
  /** målgrupp — vuxna, barn, familj, seniorer, etc. */
  target_audience?: string[];
  /** ålderskontext (family-friendly, 18+, alla åldrar). */
  age_context?: string;
  /** ungefärlig längd i minuter om känt. */
  duration_minutes?: number;
  /** premiär? (true/false). */
  premiere?: boolean;
  /** del av turné? */
  tour?: string;
  /** del av festival? */
  festival_context?: string;
  /** special guests. */
  special_guests?: string[];
  /** repertoar / typ av innehåll (befintligt material, nyskrivet, mix). */
  repertoire?: string[];
  /** produktionskaraktär — scenografi, ljusdesign, multimedia, etc. */
  production_characteristics?: string[];
  /** pedagogiskt innehåll — passar workshops/föreläsningar. */
  educational_content?: string[];
  /** familjekaraktär — passar barn/familj? */
  family_characteristics?: string[];
  /** tillgänglighet — textning, teckenspråk, etc. */
  accessibility?: string[];
  /** rumslig kontext — kyrka, klubb, utomhus, svart låda, etc. */
  setting?: string;
  /** praktisk info — biljetter krävs, gratis, åldersgräns, klädkod, etc. */
  practical_information?: string[];
  /** source provenance — vilka sources bidragit med vilka fakta. */
  provenance: Record<string, string[]>;
}

/**
 * Textual Firewall — typdefinition för inputs som Writer får vs INTE får.
 *
 * Garantin är: Writer får ALDRIG source description, original meningar,
 * HTML-text, eller liknande som gör att Writer kan parafrasera.
 *
 * Implementationen finns i textualFirewall.ts — TypeScript-typerna är
 * första försvarslinjen.
 */
export interface WriterSafeInputs {
  /** Structured Event Profile — extraherat utan source description. */
  profile: EventProfile;
  /** EventPulse egen eventdata (venue, datum, pris, etc.). */
  event: {
    title: string;
    start_time: string;
    venue_name?: string | null;
    city?: string | null;
    price_min_sek?: number | null;
    is_free?: boolean;
    language?: string | null;
  };
  /** Editorial Style Guide — hur vi vill att texten ska låta. */
  style_guide: string;
}

/**
 * Inputs som ALDRIG får nå Writer.
 *
 * Dessa fält är flaggade i Firewall-objektet så att alla writers kan
 * kontrollera innan de skickar till AI:et.
 */
export interface ForbiddenWriterInputs {
  source_description: string | null;
  raw_description: string | null;
  original_title: string | null;
  html_source: string | null;
  scraped_copy: string | null;
}

/**
 * Editorial Writer output.
 */
export interface EditorialDraft {
  text: string;
  word_count: number;
  /** Vilken info-nivå texten motsvarar (RICH / MEDIUM / LOW / VERY_LOW). */
  info_level: 'RICH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  /** generation metadata — model, prompt version, seed. */
  meta: {
    model: string;
    prompt_version: string;
    seed?: string;
    generated_at: string;
  };
}

/**
 * Factuality check-resultat (claim-by-claim).
 *
 * Verifierar att ALLA materiella påståenden i draften kan härledas till
 * Profile. PASS endast om inga UNSUPPORTED claims finns. INFERRED claims
 * (semantiska konsekvenser av kategori) accepteras.
 */
export interface FactualityResult {
  pass: boolean;
  /** claims som inte kunde verifieras mot Profile eller kategori. */
  unsupported_claims: string[];
  /** claims som verifierades mot Profile eller event-fält. */
  supported_claims: string[];
  /** claims som accepterats via kategori-hints (semantisk konsekvens). */
  inferred_claims?: string[];
  /** Detaljer per claim — används för loggning och regeneration feedback. */
  details?: Array<{
    claim: string;
    status: 'SUPPORTED' | 'INFERRED' | 'UNSUPPORTED';
    evidence: Array<{ field: string; value: string }>;
    match_type: 'exact' | 'substring' | 'word-overlap' | 'none';
  }>;
  checked_at: string;
}

/**
 * Independence check-resultat.
 *
 * Jämför draft mot source description. Letar efter identiska formuleringar,
 * särpräglade fraser, slogans, metaforer, avancerad parafrasering.
 *
 * Inte juridisk garanti — tekniskt riskreducerande kvalitetsfilter.
 */
export interface IndependenceResult {
  pass: boolean;
  /** Highest similarity score (0..1) över alla testade matchningar. */
  max_similarity: number;
  /** Vilka fraser matchade (för loggning + regenerering). */
  matched_phrases: string[];
  checked_at: string;
}

/**
 * Pipeline-resultat (state machine).
 *
 * passed           — LLM-genererad text som klarade factuality + independence
 * regenerating     — minst en grind underkänd, regenerering startad
 * fallback_fact    — LLM misslyckades → FACT-lista från Profile
 * fallback_minimal — LLM misslyckades → bara titel + venue + datum
 * failed           — Inte ens MINIMAL kunde byggas (saknar titel/venue/datum)
 */
export type EditorialStatus =
  | 'pending'
  | 'passed'
  | 'regenerating'
  | 'fallback_fact'
  | 'fallback_minimal'
  | 'failed';

export interface EditorialPipelineResult {
  status: EditorialStatus;
  draft?: EditorialDraft;
  factuality?: FactualityResult;
  independence?: IndependenceResult;
  /** Data quality gate — evidence fusion-resultat. */
  data_quality?: import('./dataQualityCheck').DataQualityReport;
  /** Antal regenereringsförsök. */
  attempts: number;
  /** Slutlig status när klar. */
  final_text?: string;
  /** Fel om failed. */
  error?: string;
}

/**
 * Storage-shape för events.event_profile (DB-kolumn).
 *
 * Sparas som JSONB. Regenereras när source_info ändras eller profile
 * valideras underkänner.
 */
export interface StoredEventProfile {
  profile: EventProfile;
  version: number;
  generated_at: string;
  source_hashes: Record<string, string>;
}

/**
 * Storage-shape för events.editorial_description (DB-kolumn).
 */
export interface StoredEditorialDescription {
  text: string;
  info_level: 'RICH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  factuality_pass: boolean;
  independence_pass: boolean;
  model: string;
  prompt_version: string;
  generated_at: string;
  attempts: number;
  word_count: number;
}

/**
 * Shape för Supabase insert/update på events (typning för migrationer).
 */
export interface EventEditorialUpdate {
  event_profile?: StoredEventProfile;
  editorial_description?: StoredEditorialDescription;
  editorial_description_generated_at?: string;
}

/**
 * Convenience: tom profile för testning.
 */
export const EMPTY_PROFILE: EventProfile = {
  event_type: 'community',
  performers: [],
  genres: [],
  content: [],
  experience_characteristics: [],
  language: ['sv'],
  provenance: {},
};

// ─── Entity Extraction (P8 FAS 2, 2026-10-08) ───────────────────────────────
//
// GENERELL semantisk extraktion som ersätter den smala Zurich-pattern-only
// semanticExtractor.ts. Syftet är att identifiera entities (personer/band/
// verk/team) från title + raw_description + strukturerade fält, med
// konserva role-konfidens och evidence per entitet.

/**
 * Roller som en extraherad entitet kan ha i ett event.
 * Konservativ: bara roller vi kan belägga med mönster eller strukturerad data.
 */
export type EntityRole =
  | 'artist'        // Musikartist / DJ
  | 'band'          // Grupp
  | 'dj'            // Specifikt DJ
  | 'comedian'      // Standup-artist
  | 'performer'     // Teater/dans/skådespelare
  | 'ensemble'      // Orkester/ensemble
  | 'conductor'     // Dirigent
  | 'soloist'       // Solist (klassisk)
  | 'speaker'       // Föreläsare
  | 'team'          // Sport-lag
  | 'work'          // Verk (musical, pjäs, opera, film)
  | 'composer'      // Kompositör (refererad, inte performer)
  | 'author'        // Bokförfattare
  | 'organizer'     // Arrangör/venue (refererad)
  | 'referenced'    // Tribute/hyllning — namnges men uppträder inte
  | 'theme'         // Tematisk event (fest med namn, hyllningsafton)
  | 'unknown';

/**
 * Konfidens för en extraherad entitet.
 *
 * VI ANVÄNDER INTE DECIMAL-TAL (0.93 vs 0.87) — för kalibrerad
 * sannolikhet behövs JEV (senare). Etiketter är tydligare att audita.
 */
export type EntityConfidence =
  | 'VERIFIED'   // Strukturdata bekräftar
  | 'SUPPORTED'  // Generellt mönster + kategori stödjer
  | 'INFERRED'   // Rimlig utifrån kategori men inte uttryckligen sagt
  | 'AMBIGUOUS'  // Flera tolkningar — returneras separat för review
  | 'UNKNOWN';   // Vet inte

/**
 * Varifrån en entitet kommer.
 * Vi sparar exakt source-text för att kunna granska.
 */
export interface EntityEvidence {
  /** Vilket fält entity:n hittades i. */
  field: 'title' | 'raw_description' | 'structured_input' | 'venue_name';
  /** Det exakta textavsnitt som stödjer claim. */
  span: string;
  /** Vilken metod/regel som extraherade. */
  method: string;
}

/**
 * En enskild extraherad entitet med dess roll och evidens.
 */
export interface ExtractedEntity {
  /** Entitetens namn (normaliserat — trimming, lowercase behålls för läsbarhet). */
  name: string;
  /** Vad entiteten har för roll i just detta event. */
  role: EntityRole;
  /** Evidens: varifrån vi vet detta. */
  evidence: EntityEvidence;
  /** Hur säkra vi är. */
  confidence: EntityConfidence;
}

/**
 * Input till extractEntities().
 *
 * OBS: vi sparar INTE denna i DB — det är en runtime-struktur. Profil och
 * DB-schema förblir oförändrade i P8 FAS 2.
 */
export interface EntityExtractionInput {
  title: string | null;
  raw_description: string | null;
  category_slug: string | null;
  venue_name: string | null;
  /** Från artistResolver/structured pipeline (om löses upp tidigare). */
  structured_performers?: string[];
}

/**
 * DB row med description-fält (för typecheck).
 */
export type DbEventRow = {
  id: string;
  title: string;
  title_sv: string | null;
  title_en: string | null;
  description: string | null;
  description_sv: string | null;
  description_en: string | null;
  description_license: string | null;
  eventpulse_summary: string | null;
  event_profile: Json | null;
  editorial_description: string | null;
  editorial_description_generated_at: string | null;
  editorial_info_level: string | null;
  category_slug: string | null;
  venue_name: string | null;
  start_time: string;
  is_free: boolean | null;
  price_min_sek: number | null;
  source: string;
};