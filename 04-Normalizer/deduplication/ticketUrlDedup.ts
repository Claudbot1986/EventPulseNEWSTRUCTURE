/**
 * Dedup via ticket_url — är två rader samma event?
 *
 * BUGG (2026-10-24): normalizerns ticket_url-sökning tog den FÖRSTA raden med
 * matchande URL och skrev över den. En URL som bär flera events (kalendersida,
 * serie, terminslista) kollapsade därför till EN rad:
 *
 *   ifk-stockholm — 3 event ("Höstläger Katrineholm" 13/11,
 *   "IFK Klubbmästerskap" 24/11, "Lucia och Banana Cup" 8/12) på samma URL
 *   → 1 rad i databasen (den sista, "Lucia och Banana Cup").
 *
 * Mätt på hela korpusen (03-Queue/03-extractedevents/**):
 *   S1  samma källa + URL + dag, olika titel  →  98 rader  (titelförvandling — ska MERGAS)
 *   S2  samma källa + URL, olika dag + titel   →  13 rader  (olika event — ska SPLITTAS)
 *   S3  samma källa + URL, olika dag, samma tit → 357 rader  (olika företrädelser — ska SPLITTAS)
 *   korskällor med samma URL: 923 par med samma dag (konsolideras),
 *                            34 par med olika dag (26 av dem >7 dagar = serie-sidor)
 *
 * REGEL: en rad är en FÖRETRÄDESDAG. Samma ticket_url + samma kalenderdag =
 * samma event — oavsett källa. Samma ticket_url + annan kalenderdag = olika
 * företrädelser → nya rader.
 *
 * Bevis över 19 orelaterade domäner (ifk-stockholm, berwaldhallen,
 * helsingborg-konserthus, do310, 3arena, aviciiarena, sodrateatern,
 * dansenshus, rival, nalen, sthlmlist, downtown-2, abb-arena, bar-brooklyn,
 * goteborgsoperan, goteborgs-film-festival, hovet, jazz-i-orebro, göteborg).
 *
 * VIKTIGT: den här modulen ändrar INTE dedup_hash-algoritmen
 * (repo-policy "Do not change dedup hash algorithm"). Den ändrar bara vilken
 * befintlig rad en ny rad får uppdatera. En rad med samma source_id men ett
 * korrigerat datum fångas fortsätt av hash-sökningen i normalizern.
 */

/** En rad i events-tabellen som matchade på ticket_url. */
export interface TicketUrlCandidate {
  id: string;
  updated_at?: string | null;
  source: string | null;
  start_time: string | null;
}

/** Varför en kandidat matchar (eller inte). */
export type TicketUrlMatchReason =
  /** Annan källa, samma dag → samma event, olika adapter (Chicago-musikal 228→57). */
  | 'cross-source'
  /** Samma källa, samma dag → samma event (titelförvandling). */
  | 'same-source-same-day'
  /** Annan kalenderdag → olika företrädelse, INTE en dubblett. */
  | 'different-day'
  /** Datum saknas på någondera sidan → gammalt beteende (behåll dubbletten). */
  | 'no-date';

export interface TicketUrlSelection {
  candidate: TicketUrlCandidate | null;
  reason: TicketUrlMatchReason;
}

/**
 * Kalenderdag ("YYYY-MM-DD") ur en start_time.
 *
 * Semantik: datumdelen i ISO-strängen är den avsedda lokala kalenderdagen —
 * samma som 03-Queue/eventFreshness.ts ("Kalenderdagen läses av DATUMDELEN i
 * ISO-strängen"). Databasen lagrar UTC, så en rad som lästs tillbaka ger
 * UTC-dagen. För att båda sidor ska jämföra lika gäller:
 *
 *   - datum-only ("2026-11-13") → datumdelen (lagras som UTC-midnatt samma dag)
 *   - explicit zon ("…Z", "…+01:00") → UTC-dagen (entydig)
 *   - naiv ("2026-11-13T19:00") → datumdelen (lagras som den är, UTC-session)
 */
export function calendarDay(startTime: string | null | undefined): string | null {
  if (!startTime) return null;

  const trimmed = startTime.trim();

  // Hela värdet är ett datum (ingen tid) → datumdelen är kalenderdagen.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const datePart = trimmed.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;

  // Utan explicit zon är datumdelen den avsedda kalenderdagen.
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (!hasExplicitZone) return datePart;

  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Klassificera en enskild kandidat mot den inkommande raden.
 *
 * @param incomingSource    källan som den inkommande raden kommer från
 * @param incomingStartTime start_time som den inkommande raden bär
 * @param candidate         raden som hittades i databasen
 */
export function classifyTicketUrlMatch(params: {
  incomingSource: string;
  incomingStartTime: string | null | undefined;
  candidate: TicketUrlCandidate;
}): TicketUrlMatchReason {
  const { incomingSource, incomingStartTime, candidate } = params;

  const incomingDay = calendarDay(incomingStartTime);
  const candidateDay = calendarDay(candidate.start_time);

  // Utan datum går det inte att avgöra → behandla som dubblett (gammalt
  // beteende). Hellre en dubblett än att tappa ett event.
  if (incomingDay === null || candidateDay === null) return 'no-date';

  if (incomingDay !== candidateDay) return 'different-day';

  return candidate.source === incomingSource ? 'same-source-same-day' : 'cross-source';
}

/**
 * Är kandidaten en dubblett av den inkommande raden?
 */
export function isDuplicateTicketUrlMatch(reason: TicketUrlMatchReason): boolean {
  return reason !== 'different-day';
}

/**
 * Välj den rad som ska uppdateras — eller ingen, om raden är ny.
 *
 * Prioritering mellan träffar: en träff med samma dag är säker, en träff
 * utan datum är en gissning. Därför vinner "no-date" inte över
 * "same-source-same-day". Mellan två säkra träffar vinner korskällträffen —
 * konsolideringen över källor är ett medvetet beslut (Chicago-musikal:
 * 228 rader → 57) och den är oförändrad av dag-regeln (923 par med samma dag).
 *
 * @param candidates rader som matchade på ticket_url
 */
export function selectTicketUrlCandidate(params: {
  incomingSource: string;
  incomingStartTime: string | null | undefined;
  candidates: TicketUrlCandidate[];
}): TicketUrlSelection {
  const { incomingSource, incomingStartTime, candidates } = params;

  const ranked: { candidate: TicketUrlCandidate; reason: TicketUrlMatchReason }[] = [];
  for (const candidate of candidates) {
    const reason = classifyTicketUrlMatch({ incomingSource, incomingStartTime, candidate });
    if (isDuplicateTicketUrlMatch(reason)) ranked.push({ candidate, reason });
  }

  if (ranked.length === 0) {
    return { candidate: null, reason: 'different-day' };
  }

  const weight: Record<TicketUrlMatchReason, number> = {
    'cross-source': 3,
    'same-source-same-day': 2,
    'no-date': 1,
    'different-day': 0,
  };

  ranked.sort((a, b) => weight[b.reason] - weight[a.reason]);

  return { candidate: ranked[0].candidate, reason: ranked[0].reason };
}
