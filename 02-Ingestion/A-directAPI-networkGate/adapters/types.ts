/**
 * types.ts — gemensamt kontrakt för source-adapters i Tool A.
 *
 * En source-adapter är den SANCTIONERADE platsen för källspecifik logik.
 * Gate-koden (runA.ts) får aldrig innehålla sajt-specifika regler — den
 * slår bara upp `metadata.sourceAdapter` i registret och kör adaptern.
 * Det håller oss kompatibla med Generalization Protection Rule: en mönster
 * som bara gäller en sajt får inte bäddas in i C0/C1/C2 eller i gatens
 * egen logik.
 *
 * Adapterkontraktet:
 *   - adaptern returnerar RADER i extractedevents-format (inte BullMQ-jobb).
 *   - A-gaten skriver raderna till 03-Queue/03-extractedevents/<sourceId>.jsonl.
 *   - därefter tar importToEventPulse → raw_events → worker → Supabase över.
 *
 * På så sätt finns EN persistensväg, och antalet events som rapporteras
 * är det faktiska antalet rader — inte en heartbeat.
 */

import type { SourceTruth } from '../../tools/sourceRegistry';

/** En rad i extractedevents-format (det format importToEventPulse läser). */
export interface AdapterEventRow {
  title: string;
  /** ISO-8601 med tidszon (t.ex. "2026-10-25T14:00:00.000Z"). */
  start_time: string;
  end_time: string | null;
  /** YYYY-MM-DD — legacy-fält för äldre läsare. */
  date: string;
  /** HH:MM — legacy-fält, lokal tid. */
  time?: string;
  venue?: string;
  address?: string;
  city?: string;
  description?: string;
  url?: string;
  ticketUrl?: string;
  category?: string;
  source: string;
  sourceUrl?: string;
  source_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  image_url?: string | null;
  detected_language?: 'sv' | 'en' | 'other' | null;
  raw_payload?: Record<string, unknown>;
}

export interface ApiAdapterResult {
  status: 'completed' | 'failed';
  /** Rader som faktiskt producerades. */
  events: AdapterEventRow[];
  error?: string;
}

export interface ApiAdapter {
  /** Unikt namn — nyckeln i registret och värdet i `metadata.sourceAdapter`. */
  readonly name: string;
  /**
   * Värdsuffixer som adaptern hanterar AUTOMATISKT (t.ex. ".confetti.events").
   *
   * Tom lista betyder att adaptern bara kan köras explicit, via
   * `metadata.sourceAdapter` i source-filen. Automatisk matchning gör att en
   * källa som pekar på en sådan värd fungerar direkt — även om den kommer
   * från discovery-promotering, som inte känner till adaptrar.
   */
  readonly hostSuffixes: readonly string[];
  /** Kör adaptern mot en källa och returnera rader i extractedevents-format. */
  run(source: SourceTruth): Promise<ApiAdapterResult>;
}
