/**
 * scripts/lib/saved-events.ts — vilka event har användaren sparat?
 *
 * ROTORSAK (2026-10-31): `scripts/purge_yesterday_events.ts` frågade tabellen
 * `user_interaction_save` — en tabell som INTE finns i live-DB (PostgREST:
 * "Could not find the table 'public.user_interaction_save' in the schema
 * cache"). Felet svaldes till en varning ("fortsätter utan skydd"), så purgen
 * raderade 1 000 events varje natt ÄVEN om användaren hade sparat dem.
 * Spara ligger i stället i `user_interactions` med `interaction='save'`
 * (se `08-Agent/tools/record_feedback.ts`).
 *
 * POLICY — skydden är fail-CLOSED:
 *   Kan vi inte avgöra vad användaren sparat raderas INGENTING. Ett tyst
 *   förlorat sparat event är värre än ett par extra dagar gamla rader i DB.
 *   Anroparen får alltså ett `ok: false` och måste avbryta, inte fortsätta.
 *
 * Varför en egen modul: purge-skriptet är ett toppnivå-skript som körs av
 * launchd/post-ingest och inte kan enhetstestas. Logiken som avgör
 * "radera eller arkivera" ligger här i ren form och har egna tester.
 */

/** Resultatet av en fråga mot Supabase som kan ha en `data` och/eller `error`. */
export interface SavedEventsQueryResult {
  data: Array<{ event_id: string | null }> | null;
  error: { message: string } | null;
}

/**
 * Minimal strukturell typ för den Supabase-klient vi behöver.
 * Avsiktligt snäv: bara `.from().select().eq().not()` behövs, och en testdubbel
 * ska kunna implementera den utan att dra in hela supabase-js.
 */
export interface SavedEventsClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        not(column: string, predicate: string, value?: unknown): PromiseLike<SavedEventsQueryResult>;
      };
    };
  };
}

export interface SavedEventIds {
  /** true = frågan gick igenom, `eventIds` är då komplett. */
  ok: boolean;
  /** Unika event_id som användaren sparat. Tom lista om `ok` är false. */
  eventIds: string[];
  /** Felmeddelande när `ok` är false. */
  error?: string;
}

/**
 * Hämtar de event_id som har en save-interaktion.
 *
 * Rader med `event_id = null` hoppas över (äldre save-rader från augusti
 * skrev inte event_id — de kan inte skydda något).
 */
export async function fetchSavedEventIds(
  supabase: SavedEventsClient,
): Promise<SavedEventIds> {
  let result: SavedEventsQueryResult;
  try {
    result = await supabase
      .from('user_interactions')
      .select('event_id')
      .eq('interaction', 'save')
      .not('event_id', 'is', null);
  } catch (err) {
    return {
      ok: false,
      eventIds: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (result.error) {
    return { ok: false, eventIds: [], error: result.error.message };
  }

  const eventIds = new Set<string>();
  for (const row of result.data ?? []) {
    if (row?.event_id) eventIds.add(row.event_id);
  }

  return { ok: true, eventIds: [...eventIds] };
}

export interface PartitionResult {
  /** Event som har en save — ska arkiveras lokalt, aldrig raderas. */
  toArchive: string[];
  /** Event utan save — kan raderas permanent. */
  toDelete: string[];
}

/**
 * Delar upp event-id i "sparas" och "raderas".
 *
 * Ren funktion (ingen I/O) så att beslutet kan testas utan DB.
 */
export function partitionBySaved(
  eventIds: string[],
  savedEventIds: string[],
): PartitionResult {
  const saved = new Set(savedEventIds);
  const toArchive: string[] = [];
  const toDelete: string[] = [];
  for (const id of eventIds) {
    if (saved.has(id)) toArchive.push(id);
    else toDelete.push(id);
  }
  return { toArchive, toDelete };
}
