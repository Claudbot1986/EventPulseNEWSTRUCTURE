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
 * Factuality check-resultat.
 *
 * Verifierar att ALLA materiella påståenden i draften kan härledas till
 * Profile. PASS om alla stödjs. unsupported_claims innehåller de påståenden
 * som inte kunde verifieras (för regeneration).
 */
export interface FactualityResult {
  pass: boolean;
  /** claims som inte kunde verifieras mot Profile. */
  unsupported_claims: string[];
  /** claims som verifierades (för loggning). */
  supported_claims: string[];
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
 * Pipeline-resultat (3 state machine).
 */
export type EditorialStatus = 'pending' | 'passed' | 'regenerating' | 'failed';

export interface EditorialPipelineResult {
  status: EditorialStatus;
  draft?: EditorialDraft;
  factuality?: FactualityResult;
  independence?: IndependenceResult;
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