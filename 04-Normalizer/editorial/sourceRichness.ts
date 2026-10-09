/**
 * sourceRichness.ts — klassificerar hur rik källinformationen är för ett
 * event. Används i live-sample för att separera resultat per
 * informationsdensitet.
 *
 * Logik (utifrån DB-fält):
 *   - RICH     : raw_description > 200 tecken OCH/ELLER eventpulse_summary > 100 tecken
 *   - MEDIUM   : raw_description 50-200 tecken ELLER description > 100 tecken
 *   - POOR     : raw_description < 50 tecken OCH eventpulse_summary saknas
 *   - NO_SOURCE: varken raw_description, description, eller eventpulse_summary
 *
 * Används i P7 live-sample rapport för att visa att pass rate varierar
 * dramatiskt med hur mycket vi har att gå på.
 */

export type SourceRichness = 'RICH' | 'MEDIUM' | 'POOR' | 'NO_SOURCE';

export function rankSourceRichness(
  rawDescription: string | null,
  description: string | null,
  eventpulseSummary: string | null,
): SourceRichness {
  const rawLen = rawDescription?.trim().length ?? 0;
  const descLen = description?.trim().length ?? 0;
  const summaryLen = eventpulseSummary?.trim().length ?? 0;

  if (rawLen === 0 && descLen === 0 && summaryLen === 0) {
    return 'NO_SOURCE';
  }

  if (rawLen > 200 || summaryLen > 100) {
    return 'RICH';
  }

  if (rawLen >= 50 || descLen > 100) {
    return 'MEDIUM';
  }

  return 'POOR';
}
