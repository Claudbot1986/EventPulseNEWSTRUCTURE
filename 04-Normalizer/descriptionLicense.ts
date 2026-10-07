/**
 * Description License — T0201 (2026-10-05).
 *
 * Klassificerar rättighetsstatus för source description per event. Indata är
 * source-namn + (valfri) source-registry-override. Default = 'unknown'.
 *
 * Beslutsregel (användarbeslut 2026-10-05):
 *   - Om source-registry har explicit license för source-namnet → använd den.
 *   - Annars → 'unknown'.
 *
 * Säkerhetsegenskap: default 'unknown' betyder att UI/agent aldrig visar
 * `description_en/sv` utan uttrycklig klassificering. `events_public` view
 * filtrerar på license i en separat migration efter att denna modul är
 * driftssäker.
 *
 * Kontrakt: rent funktion (inga sidoeffekter), lätt att enhetstesta.
 *
 * Mönster: image_license-prejudikatet (T0052, vault 04-Sources/22-Image-Rights-Policy.md).
 */

export type DescriptionLicense =
  | 'pressbild'                  // svensk upphovsrätt räcker för redaktionellt bruk
  | 'copyright-with-attribution' // API ToS kräver attribution
  | 'partner-licensed'           // partner har uttryckligen gett rätt
  | 'public-domain'              // CC0, Wikimedia, etc.
  | 'unknown';                   // default; aldrig publikt utan vidare

/**
 * Source-registry-override. Sätts av operatör/source-config.
 *   {
 *     'billetto-se': { license: 'copyright-with-attribution', attribution: 'Photo: Billetto' },
 *     'kulturhuset': { license: 'pressbild' },
 *     'sthlmlist':   { license: 'unknown' },
 *   }
 */
export interface SourceLicenseOverride {
  license: Exclude<DescriptionLicense, 'unknown'>;
  attribution?: string;
}

export type SourceLicenseRegistry = Record<string, SourceLicenseOverride>;

export interface DescriptionLicenseInput {
  /** Source-namn (events.source), t.ex. 'sthlmlist', 'kulturhuset'. */
  source: string | null | undefined;
  /** Per-source overrides; tomt object om inga. */
  registry?: SourceLicenseRegistry | null;
  /**
   * Om true: returnera 'unknown' även om registry har en override.
   * Användbart för test-only "force unknown" eller nöd-stopp.
   */
  forceUnknown?: boolean;
}

export interface DescriptionLicenseOutput {
  license: DescriptionLicense;
  attribution: string | null;
  /** Vilken regel som slog in (för loggning/audit). */
  rule: 'registry-override' | 'unknown-default' | 'forced-unknown';
}

export function resolveDescriptionLicense(
  input: DescriptionLicenseInput
): DescriptionLicenseOutput {
  const registry = input.registry ?? {};
  const override = input.source ? registry[input.source] : undefined;

  if (input.forceUnknown) {
    return { license: 'unknown', attribution: null, rule: 'forced-unknown' };
  }

  if (override) {
    return {
      license: override.license,
      attribution: override.attribution ?? null,
      rule: 'registry-override',
    };
  }

  return { license: 'unknown', attribution: null, rule: 'unknown-default' };
}

/**
 * Vilka licenses som ger publikt exponeringsrätt för description_en/sv.
 *
 * 'unknown' exkluderas — det är default-no-go.
 *
 * OBS: `events_public` view kommer (i separat migration) att filtrera med
 * denna lista. Logiken ska ENDAST leva på ett ställe; UI/agent frågar inte.
 */
export const PUBLIC_DESCRIPTION_LICENSES: ReadonlyArray<DescriptionLicense> = [
  'pressbild',
  'copyright-with-attribution',
  'partner-licensed',
  'public-domain',
] as const;

/** Hjälpfunktion för att avgöra om en license är publikt tillåten. */
export function isPublicDescriptionLicense(license: DescriptionLicense | null): boolean {
  if (!license) return false;
  return PUBLIC_DESCRIPTION_LICENSES.includes(license);
}

/** Test-only — exponera typer/konstanter för enhetstester. */
export const __test__ = {
  PUBLIC_DESCRIPTION_LICENSES,
};