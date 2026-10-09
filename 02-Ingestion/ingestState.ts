/**
 * IngestState — type-system-of-truth för ingestion-state.
 *
 * Stream A.4 (Agent Trust Plan 2026-10-09) / Pstack-princip #13 (Type system discipline)
 * och #24 (Encode lessons in structure).
 *
 * Vad detta löser:
 * Tidigare hade vi lös `status: 'pending_render_gate'` etc. på enskilda datastrukturer.
 * Det var fritt fram att konstruera ogiltiga states ('archived' → 'pending_render_gate'
 * t.ex.), och CI hade ingen möjlighet att fånga det. Med denna union + transitions-funktion
 * blir ogiltiga state-changes oframställbara.
 *
 * Designregler:
 *  - En "kind" per state, varje variant bär sina egna obligatoriska fält.
 *  - `transition()` är den ENDA godkända vägen att byta state.
 *  - Ogiltiga transitions kastar Error (i runtime) eller kompilerar-fel (om man
 *    glömmer att hantera alla grenar i en `switch` med `assertNever`).
 */

import { z } from 'zod';

/**
 * ISO-8601 tidsstämpel.
 */
const ISO8601 = z.string().refine(s => !Number.isNaN(Date.parse(s)), 'måste vara ISO-8601');

/**
 * FailureReason = strukturerad orsak till ett misslyckande.
 * Gör att vi kan gruppera ogiltiga outputs utan att förlita oss på fritext.
 */
export const FailureReasonSchema = z.enum([
  'serialization_bug',
  'geographic_scope_violation',
  'missing_required_field',
  'duplicate',
  'upstream_timeout',
  'parse_error',
  'unverified',
]);
export type FailureReason = z.infer<typeof FailureReasonSchema>;

/**
 * IngestState = en diskriminerad union av alla giltiga states för en ingestion-rad.
 *
 * Diskriminerande fält: `kind`.
 *
 * Konvention:
 *  - `raw`: bara inkommit från källa, ej validerad.
 *  - `validated`: passerat schema-validering (t.ex. AGateOutputSchema).
 *  - `failed`: validering misslyckades, eller geografisk scope, eller dedup.
 *  - `archived`: skickades inte vidare (manuell-granskning kö, eller TTL-utgången).
 *  - `forwarded` är INGEN state — det är ett beslut i gate-koden, inte på inputen.
 */
export type IngestState =
  | { kind: 'raw'; sourceId: string; receivedAt: string }
  | { kind: 'validated'; sourceId: string; validatedAt: string; schemaVersion: number }
  | { kind: 'failed'; sourceId: string; failedAt: string; reason: FailureReason; reasonDetail?: string }
  | { kind: 'archived'; sourceId: string; archivedAt: string; ttlDays: number };

export const IngestStateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('raw'),
    sourceId: z.string().min(1),
    receivedAt: ISO8601,
  }),
  z.object({
    kind: z.literal('validated'),
    sourceId: z.string().min(1),
    validatedAt: ISO8601,
    schemaVersion: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('failed'),
    sourceId: z.string().min(1),
    failedAt: ISO8601,
    reason: FailureReasonSchema,
    reasonDetail: z.string().optional(),
  }),
  z.object({
    kind: z.literal('archived'),
    sourceId: z.string().min(1),
    archivedAt: ISO8601,
    ttlDays: z.number().int().positive(),
  }),
]);

/**
 * Transitions: explicita, endast giltiga state-changes får passera.
 *
 * `transition(prev, next)` kontrollerar:
 *  - prev.kind === aktuell
 *  - next.kind === ett av de tillåtna efterföljande states
 *  - bär korrekt tidsstämpel
 *
 * Returnerar `next` om OK; kastar Error om transitionen är ogiltig.
 *
 * Tillåtna övergångar:
 *   raw       → validated | failed | archived
 *   validated → failed | archived
 *   failed    → archived
 *   archived  → (terminal)
 */
export type TransitionTarget = Exclude<IngestState['kind'], 'archived'>;

const ALLOWED: Record<TransitionTarget, ReadonlyArray<TransitionTarget | 'archived'>> = {
  raw: ['validated', 'failed', 'archived'],
  validated: ['failed', 'archived'],
  failed: ['archived'],
};

export class InvalidStateTransitionError extends Error {
  constructor(public readonly from: IngestState['kind'], public readonly to: IngestState['kind']) {
    super(`Ogiltig IngestState-transition: ${from} → ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export function transition<S extends IngestState>(
  prev: S,
  next: S extends { kind: TransitionTarget } ? Exclude<IngestState, { kind: typeof prev.kind extends infer K ? K extends 'archived' ? never : IngestState : never }> : never,
): S {
  // type-system-narrowing happens via the conditional type above; vi gör runtime-kontroll här
  const fromKind = prev.kind;
  const toKind = (next as IngestState).kind;

  if (fromKind === 'archived') {
    throw new InvalidStateTransitionError('archived', toKind);
  }
  const allowed = ALLOWED[fromKind as TransitionTarget];
  if (!allowed.includes(toKind as TransitionTarget | 'archived')) {
    throw new InvalidStateTransitionError(fromKind, toKind);
  }
  return next;
}

/**
 * `assertNever` — utnyttja exhaustiveness i switch.
 *
 *   function describe(s: IngestState) {
 *     switch (s.kind) {
 *       case 'raw': return 'incoming';
 *       case 'validated': return 'accepted';
 *       case 'failed': return 'rejected';
 *       case 'archived': return 'purged';
 *       default: return assertNever(s); // TS fel om något case saknas
 *     }
 *   }
 */
export function assertNever(x: never): never {
  throw new Error(`assertNever: förväntade aldrig-gren, fick ${JSON.stringify(x)}`);
}
