/**
 * Kör en sidoeffekt som sker EFTER att eventet redan persisterats — utan
 * att låta felet fälla jobbet.
 *
 * Bakgrund (2026-10-23): normalizer.ts kastade direkt ur
 * `searchSyncQueue.add()` och `aiImageQueue.add()`. Båda körs efter att
 * eventet skrivits till Supabase, så ett fel där markera jobbet som failed
 * — vilket betyder "inget persisterades". Mätt samma dag: 26 jobb dog med
 * "Connection is closed." i de här anropen, trots att alla 26 events fanns
 * i databasen. Det var renast lögn mot dashboarden och mot E8-gaten.
 *
 * Princip: en sidoeffekt får aldrig ändra jobbets utfall. Den loggas, och
 * rapporten blir "eventet finns, sidoeffekten uteblev".
 */

/**
 * @returns true om sidoeffekten gick igenom, false om den misslyckades
 *          (misslyckandet är loggat, inte kastat).
 */
export async function enqueueSideEffect(
  label: string,
  eventId: string,
  fn: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[side-effect] ⚠️ ${label} misslyckades (event_id=${eventId}): ${message}`);
    return false;
  }
}
