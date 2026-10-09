/**
 * save-favorite — delade typer
 *
 * Stream B.1 (Agent Trust Plan 2026-10-09): feature-as-directory-pilot.
 */

export interface SaveState {
  eventId: string;
  isSaved: boolean;
  /** När state senast uppdaterades (ISO-8601). Används för sync till backend. */
  updatedAt: string | null;
  /** Optimistic: true om vi inte fått svar från backend ännu. */
  pending: boolean;
}

export type SaveResult =
  | { kind: 'saved'; eventId: string; at: string }
  | { kind: 'unsaved'; eventId: string; at: string }
  | { kind: 'error'; eventId: string; reason: string };

export interface SaveStorage {
  /** Hämta senaste state för ett eventId. Returnerar null om aldrig sparat. */
  read(eventId: string): Promise<SaveState | null>;
  /** Spara ny state. Returnerar den skrivna staten. */
  write(state: SaveState): Promise<SaveState>;
  /** Hämta alla sparade event-IDs. */
  listAll(): Promise<string[]>;
  /** Rensa all save-state (används av GDPR-erase). */
  clear(): Promise<void>;
}
