/**
 * textualFirewall.ts — runtime-grind före Writer-anrop.
 *
 * Pipeline-steg 3 av 6 i EventPulse Editorial Description Engine (P7).
 *
 * Kontrakt:
 *   WriterSafeInputs.builder! För Writer får byggas UTAN source-text.
 *
 * Brandväggen är tvådelad:
 *   1. compileWriterInputs() — bygger WriterSafeInputs från Profile + EventPulse-data.
 *      Källbeskrivning, raw description, HTML, scraped copy får INTE ens nå hit.
 *   2. assertFirewallClean() — defensiv runtime-check som kastar om forbidden
 *      fält smyger in (t.ex. via misstag i pipeline-orkesteringen).
 *
 * Om vi märker att source_description slinker in → kasta. Det är ett
 * utvecklarfel som ska fastna i test, inte tystas.
 *
 * Steg 3/15 i P7 Definition of Done.
 */

import type {
  EventProfile,
  ForbiddenWriterInputs,
  WriterSafeInputs,
} from './types';

// ─── Style guide ─────────────────────────────────────────────────────────────

/**
 * Editorinje stil-guide för Writer. Konservativ med fakta, kreativ med
 * språk. Skickas ALLTID till Writer — det är Writer:s enda stilistiska
 * instruktion (förutom Profile + EventPulse-data).
 *
 * Innehållet är medvetet deterministiskt (vi vill ha repeterbar Writer-output)
 * men tillåter språklig variation. Inga känsliga keywords som "parafrasera",
 * "skriv om" eller "copy" — sådant hör hemma i en attackares prompt.
 */
export const STYLE_GUIDE: string = `Du skriver en kort redaktionell beskrivning av ett evenemang för EventPulse (Stockholm).

STIL:
- 2–3 meningar. Svenskt, ledigt men redaktionellt.
- Använd tredje person: "Konsert med X", inte "du kan höra X".
- Skapa inte fakta som inte finns i Profilen. Om Profilen är tunn, säg det indirekt ("kväll med..." istället för att lova specifika artister som inte namnges).
- Säljande men inte överdrivet. Inga "unikt", "magiskt", "spektakulärt" såvida inte Profilen uttryckligen stödjer det.
- Inte reklam. Inte metaforer för sakens skull.

FÖRBJUDET:
- Hitta inte på artister, verk, teman eller påståenden som inte finns i Profilen.
- Skriv aldrig ut pris, datum eller tid i löpande text — UI visar det separat.
- Inga emojis. Inga hashtags. Inga "Boka nu!"-uppmaningar.

FORMAT:
- En sammanhängande text, 2–3 meningar.
- Inga rubriker. Inga listor.`;

// ─── Builder ─────────────────────────────────────────────────────────────────

export interface WriterBuildArgs {
  profile: EventProfile;
  event: WriterSafeInputs['event'];
  styleGuide?: string;
}

/**
 * Bygg WriterSafeInputs från Profile + EventPulse-data.
 *
 * VIKTIGT: denna funktion accepterar INTE source_description, html_source
 * eller scraped_copy. Om någon försöker skicka in dem kastas ett fel —
 * brandväggen är programmerad att vägra.
 */
export function compileWriterInputs(args: WriterBuildArgs): WriterSafeInputs {
  const { profile, event, styleGuide } = args;

  // Säkerhetskontroll — event-objektet ska inte innehålla source-fält.
  const eventRecord = event as unknown as Record<string, unknown>;
  const forbiddenKeys = ['source_description', 'raw_description', 'original_title', 'html_source', 'scraped_copy'];
  for (const key of forbiddenKeys) {
    if (key in eventRecord && eventRecord[key] != null && eventRecord[key] !== '') {
      throw new Error(
        `textualFirewall: writer-inputs får inte innehålla "${key}". ` +
        `Profile byggs UTAN source-text. Pipeline-orkestreringen har en bugg.`,
      );
    }
  }

  return {
    profile,
    event: {
      title: event.title,
      start_time: event.start_time,
      venue_name: event.venue_name ?? null,
      city: event.city ?? null,
      price_min_sek: event.price_min_sek ?? null,
      is_free: event.is_free ?? false,
      language: event.language ?? null,
    },
    style_guide: styleGuide ?? STYLE_GUIDE,
  };
}

// ─── Defensiv runtime-check ─────────────────────────────────────────────────

/**
 * Kasta om forbidden-fält hittas i input som ska gå till Writer.
 * Använd som sista försvarslinje i pipeline-orkestreringen.
 */
export function assertFirewallClean(input: unknown): void {
  if (input == null || typeof input !== 'object') return;

  const forbidden: ForbiddenWriterInputs = {
    source_description: null,
    raw_description: null,
    original_title: null,
    html_source: null,
    scraped_copy: null,
  };

  const forbiddenKeys = Object.keys(forbidden);
  for (const key of forbiddenKeys) {
    const value = (input as Record<string, unknown>)[key];
    if (value != null && value !== '') {
      throw new Error(
        `textualFirewall: försöker skicka "${key}" till Writer. ` +
        `Detta är förbjudet — Profile byggs UTAN source-text.`,
      );
    }
  }
}