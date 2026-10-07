/**
 * Raw Description Retention — T0201 (2026-10-05).
 *
 * Bestämmer NÄR raw_description ska lagras (capture-villkor) och
 * implementerar worker-logiken för 30-dagars-purge.
 *
 * Användarbeslut 2026-10-05: time-boxed retention — raw_description sparas
 * i 30 dagar efter faktakonfirmering, rensas av nattlig retention-worker.
 *
 * Säkerhetsregler:
 *   - raw_description fångas ENDAST om minst ett av följande villkor är sant:
 *     (a) source.description_license = 'unknown' (vi fattar inte utfallet,
 *         spara för ev. reprocessing)
 *     (b) deterministisk faktakonstruktion lämnade < 5 fyllda fält
 *         (vi behöver description igen för att förbättra extraktion)
 *   - Annars: raw_description = null (källtext borttagen efter bearbetning)
 *   - Retention worker rensar rader där raw_description_captured_at < nu - 30 dagar.
 *
 * Kontrakt: rena funktioner förutom retentionWorker's DB-anrop.
 */

// ─── Capture-villkor ────────────────────────────────────────────────────────

export interface ShouldCaptureInput {
  /** Source-license från descriptionLicense.resolveDescriptionLicense. */
  license: string;
  /** Antal icke-null fält i den extraherade faktasamlingen. */
  filledFactCount: number;
  /**
   * Total antal fält som faktasamlingen KAN ha (för procentuell bedömning).
   * Default 16 (EventpulseFacts-nycklar minus de som alltid är null).
   */
  totalFactSlots?: number;
}

export interface ShouldCaptureOutput {
  /** true → spara raw_description + raw_description_captured_at = now() */
  capture: boolean;
  /** Orsak (för loggning/audit) */
  reason: 'unknown-license-reprocess' | 'thin-facts-needs-reprocessing' | 'license-known-rich-facts';
  /** Sannolikhetsfaktor — används för att kunna tune:a senare */
  priority: number;
}

/**
 * Bestämmer om raw_description ska lagras för framtida reprocessing.
 *
 * Logik:
 *   - license = 'unknown' → spara ALLTID (vi vet inte om innehållet är
 *     värt att visa publikt; reprocessing kan ge bättre extraktion).
 *   - license != 'unknown' OCH fyllda fakta < MIN_FILLED_FOR_DISCARD → spara.
 *   - license != 'unknown' OCH fyllda fakta >= MIN_FILLED_FOR_DISCARD → kasta.
 */
const MIN_FILLED_FOR_DISCARD = 5; // empiricalt — 5+ fyllda fält räcker för bra summary

export function shouldCaptureRawDescription(input: ShouldCaptureInput): ShouldCaptureOutput {
  const total = input.totalFactSlots ?? 16;
  const filled = input.filledFactCount;
  const license = input.license;

  if (license === 'unknown') {
    return {
      capture: true,
      reason: 'unknown-license-reprocess',
      priority: 1.0,
    };
  }

  if (filled < MIN_FILLED_FOR_DISCARD) {
    return {
      capture: true,
      reason: 'thin-facts-needs-reprocessing',
      priority: 0.7,
    };
  }

  return {
    capture: false,
    reason: 'license-known-rich-facts',
    priority: 0,
  };
}

/**
 * Räkna fyllda fält i en faktasamling (icke-null).
 * Hjälpfunktion för shouldCaptureRawDescription.
 */
export function countFilledFacts(facts: Record<string, unknown>): number {
  let count = 0;
  for (const v of Object.values(facts)) {
    if (v !== null && v !== undefined && v !== '') count++;
  }
  return count;
}

// ─── Retention worker ───────────────────────────────────────────────────────

/**
 * Beräkna cutoff-tidsstämpel för retention-purge.
 * Default: 30 dagar sedan nu.
 */
export function retentionCutoff(now: Date = new Date(), retentionDays: number = 30): Date {
  const ms = retentionDays * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

/**
 * Hitta events vars raw_description har blivit för gammal.
 * Returnerar event_id(s) som ska rensas.
 *
 * Rent villkor; anroparen att utföra DB-anrop.
 */
export interface RetentionSelectionInput {
  /** Cutoff-tid (returneras av retentionCutoff). */
  cutoff: Date;
  /** Max antal rader att returnera (för batched purges). */
  limit?: number;
}

export interface RetentionRow {
  event_id: string;
  captured_at: string; // ISO
  age_days: number;
}

/**
 * Generera SQL-fråga som plockar fram rader för purge.
 * Använder Supabase-konventionel.
 *
 * OBS: vi returnerar en query-builder-vänlig specifikation istället för
 * själva queryn — faktiska Supabase-anropet görs i workern (se
 * `rawDescriptionRetentionWorker.ts`).
 */
export function retentionSelectionSpec(input: RetentionSelectionInput) {
  return {
    table: 'events',
    select: 'id, raw_description_captured_at',
    where: {
      raw_description: { not: null },
      raw_description_captured_at: { lt: input.cutoff.toISOString() },
    },
    limit: input.limit ?? 1000,
  };
}

// ─── Test-only exports ──────────────────────────────────────────────────────

export const __test__ = {
  MIN_FILLED_FOR_DISCARD,
};