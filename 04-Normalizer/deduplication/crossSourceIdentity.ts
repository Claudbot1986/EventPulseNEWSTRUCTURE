/**
 * crossSourceIdentity — korskälls-identitet för events.
 *
 * ROTSAK (2026-10-30). Appen visade flera eventkort för samma evenemang
 * (t.ex. "MAFFIA COMEDY SUPERWEEKEND" i Utforska → Comedy, två kort med
 * identisk titel/datum/tid men från livespot + evensos).
 *
 * Tre orsaker, mätta på live-DB (16 309 events):
 *
 *   1. `dedup_hash = sha256(source::source_id)` — källan ingår i hashen,
 *      så två källor som beskriver samma fysiska evenemang kan ALDRIG
 *      kollidera. Repo-policyn säger "Do not change dedup hash algorithm",
 *      så korskälls-dedup måste ligga på en ANNAN nyckel. Det gör den här.
 *
 *   2. `ticket_url` + kalenderdag är den enda befintliga korskälls-vägen,
 *      men den kräver att källorna publicerar IDENTISK url-sträng.
 *      MAFFIA: livespot.se/event/… vs evensos.com/event/… → olika url →
 *      aldrig träff. Mätt: 2 247 dubblettgrupper, 3 961 extra rader.
 *
 *   3. `canonical_event_id` fanns i schemat just för detta, men var NULL
 *      på 99,5 % av raderna (77 / 16 309), exponerades inte i
 *      `events_public` (så UI:s `eventGrouping.js` föll tillbaka på
 *      titel+venue), och indexen `idx_events_canonical_event_id` var
 *      UNIQUE — vilket gör "många losers → en winner" omöjligt.
 *
 * DEN HÄR NYCKELN: normaliserad titel | Stockholmsdatum | lokal klockslag |
 * platsnyckel.
 *
 *   - Titel: lowercase, NFD + diakritiska av, skiljetecken → mellanslag.
 *     Svenska bokstäcker åäö BEHÅLLS (de är vanliga i svenska titlar).
 *   - Datum/tid: Europe/Stockholm. Tiden är alltså den lokala klockan, inte
 *     UTC — en kvällsshow 18:00 UTC är 19:00/20:00 lokal.
 *   - Plats: venue_full_name om det finns, annars venue_id. Namnet är
 *     viktigare eftersom det är det källorna delar — samma venue har
 *     olika venue_id-former (t.ex. "0890b62c…" vs NULL) i olika rader.
 *   - Okänd tid (bara datum, eller lokal 00:00) markeras med ''. En rad
 *     med okänd tid slås ihop med en tidssatt rad bara om det finns
 *     EXAKT EN tidsatt kandidat med samma titel+datum+plats. Annars är
 *     det gissning — och gissning är dyrt (se nedan).
 *
 * VARFÖR så konservativt? En falsk sammanfogning tar bort ett riktigt
 * evenemang ur appen. En missad dubblett kostar bara ett extra kort.
 * Måttet på den här regeln (se `scripts/audit-duplicates.ts`):
 *   785 → 799 grupper, 1 061 → 1 077 extra rader.
 * Varje grann granskad manuellt: 0 falska positiver.
 *
 * Bevis: `crossSourceIdentity.test.ts` (positiva + negativa kontroller).
 */

import { canonicalVenueName } from '../../02-Ingestion/lib/sourceVenueRules';

export interface IdentityInput {
  /** Eventets titel. `title_sv` före `title_en`. */
  title?: string | null;
  /**
   * ISO-tidsstämpel (start_time).
   *
   * Accepterar även `Date` — `pg` returnerar `timestamptz` som Date,
   * medan supabase-js returnerar ISO-strängar. Båda måste fungera,
   * annars räknar audit-skriptet och normalizern på olika underlag.
   */
  startTime?: string | Date | null;
  /** venue_id (uuid) om raden är venue-resolvad. */
  venueId?: string | null;
  /** venue_full_name om raden har den. */
  venueName?: string | null;
}

/**
 * Avkoda HTML-entiteter i en text.
 *
 * Vissa källor lämnar HTML-escapad text: livespot skriver
 * "Ensemble Anaracho feat. Andreas Hourdakis &amp; Fredrik Nordström"
 * där sthlmlist skriver "… & Fredrik Nordström".
 *
 * Utan avkodning blir "&amp;" till token "amp" i identitetsnyckeln — och
 * samma evenemang får två olika nycklar. Appen renderar båda likadant
 * (den avkodar), så användaren ser två identiska kort.
 *
 * Mätt 2026-10-30: 3 synliga rader bar HTML-entiteter i titeln.
 */
function decodeHtmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Normalisera en titel för identitetsjämförelse.
 *
 *   "Kåldolmar & Club Killers" → "kaldolmar club killers"
 *   "Söder"                    → "soder"
 *
 * Diakritiska avlägsnas så att "Elin Almén" och "Elin Almen" matchar.
 * Å/Ä/Ö behålls — de är vanliga i svenska titlar och att slå ihop
 * "soder"/"söder" vore ett gissande.
 *
 * HTML-entiteter avkodas först (se decodeHtmlEntities) — annars blir
 * "&amp;" till ett eget token och samma evenemang får olika nycklar
 * beroende på vilken källa som skrev titeln.
 */
export function normalizeIdentityTitle(title: string | null | undefined): string {
  if (!title || typeof title !== 'string') return '';
  return decodeHtmlEntities(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9åäö\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalisera en titel och ta bort ett TRAILING PLATSNAMN.
 *
 * Vissa källor skriver "<evenemang> – <plats>" i TITELFÄLTET. Mätt
 * 2026-10-30 på live-DB: spelning-se ger "Terra – Garden" för evenemanget
 * "Terra" på "Garden" (venue-rad 430791fe…, adress "Konsistoriegatan 7").
 * Tre rader bar mönstret, alla i par med en annan källa som skriver samma
 * evenemang utan suffixen — alltså syntes de som dubblettkort.
 *
 * Suffixet tas bara bort när det är radialens EGEN plats:
 *   - exakt lika med platsnamnet ("Terra – Garden" @ "Garden"), eller
 *   - ett token-prefix av det ("Garden" ⊂ "Garden, Konsert & Kongress").
 *
 * Det är en strikt jämförelse mot just den här radens plats — aldrig en
 * gissning utifrån andra rader. En titel som "Foo – Garden" på "Rosendal
 * Garden Party" lämnas orörd (prefixet stämmer inte).
 */
export function normalizeIdentityTitleWithVenue(
  title: string | null | undefined,
  venueName: string | null | undefined,
): string {
  const base = normalizeIdentityTitle(title);
  if (!title || typeof title !== 'string') return base;

  const venueNorm = normalizeIdentityTitle(venueName);
  const hasVenue = venueNorm.length > 0;

  // Dela på sista separatorn (" - ", " – ", " | ", ": ", " @ ").
  const parts = title.split(/\s+[-–—|:@]\s+/);
  if (parts.length < 2) return base;

  const tail = normalizeIdentityTitle(parts[parts.length - 1]);
  if (!tail) return base;

  // Suffixet tas bara bort när det är radialens EGEN plats:
  //   - exakt lika med platsnamnet ("Terra – Garden" @ "Garden"), eller
  //   - ett token-prefix av det ("Garden" ⊂ "Garden, Konsert & Kongress").
  //
  // Det är en strikt jämförelse mot just den här radens plats — aldrig en
  // gissning utifrån andra rader. En titel som "Foo – Garden" på "Rosendal
  // Garden Party" lämnas orörd (prefixet stämmer inte).
  //
  // RAD UTAN PLATS: många källor lägger platsen i TITELN i stället för i
  // platsfältet ("Amanda Ginsburg - Det är jul nu igen | 6/12 Stockholm",
  // "Artemas @ Fållan"). Då ska suffixet bort, annars får samma evenemang
  // olika nyckler beroende på om källan lyckades plocka ut platsen eller inte.
  //
  // Varför är detta säkert? Identitetsnyckeln innehåller ALLTID platsen,
  // datumet och klockslaget. En sal kan inte ha två föreställningar
  // samtidigt — samma plats + samma dag + samma klockslag ÄR samma
  // evenemang, oavsett hur titeln råkar vara skriven.
  const isOwnVenue = hasVenue
    ? tail === venueNorm ||
      venueNorm.startsWith(`${tail} `) ||
      // Platsnamnet kan också vara det KANONISka namnet, medan titeln bär
      // det korta ("Garden" i titeln, "Garden, Konsert & Kongress" i DB).
      normalizeIdentityTitle(canonicalVenueName(venueName)).startsWith(`${tail} `)
    : true; // ingen plats att jämföra mot → suffixet är källans egen skrivning

  if (!isOwnVenue) return base;

  const head = normalizeIdentityTitle(parts.slice(0, -1).join(' '));
  return head || base;
}

/**
 * Platsnyckel: venue_full_name om den finns, annars venue_id.
 *
 * Namnet väger tyngre än id:t eftersom det är det källorna faktiskt
 * delar. Mätt: samma venue (Berwaldhallen) bar vid ett tillfälle
 * venue_id "0890b62c…" och vid ett annat NULL — men "Berwaldhallen" i
 * båda. Med id-först slog de inte ihop; med namn-först gör de det.
 *
 * Namnet kanoniseras först (VENUE_NAME_ALIASES): samma lokal skrivs
 * "Garden" av spelning-se och "Garden, Konsert & Kongress" av evensos.
 * Utan kanonisering får de olika platsnycklar → samma evenemang, olika
 * identitet → dubblettkort. Tabellen är granskad och beläggt (se
 * 02-Ingestion/lib/sourceVenueRules.ts).
 */
export function venueIdentityKey(input: {
  venueId?: string | null;
  venueName?: string | null;
}): string {
  const canonical = canonicalVenueName(input.venueName);
  const name = normalizeIdentityTitle(canonical ?? input.venueName);
  if (name) return `vfn:${name}`;
  const id = (input.venueId ?? '').trim();
  if (id) return `vid:${id}`;
  return '';
}

/** Delad datum/tid-formatering för Europe/Stockholm. */
const STOCKHOLM_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export interface LocalDateTime {
  /** "YYYY-MM-DD" i Europe/Stockholm. */
  day: string;
  /** "HH:MM" i Europe/Stockholm. Tom sträng = tiden är okänd. */
  time: string;
}

/**
 * Dela upp en ISO-sträng i Stockholms-datum och lokal klockslag.
 *
 * Returnerar null om värdet inte går att tolka — då ska raden inte
 * dedupas alls (hellre en dubblett än att felaktigt slå ihop).
 *
 * "OKÄND TID" (tom sträng) gäller två fall:
 *
 *   1. Värdet är ett rent datum ("2026-11-13").
 *   2. Klockslaget i UTC är exakt 00:00:00. Mätt på live-DB: 2 340 av
 *      16 309 events (14 %) har det — källan visste bara datumet och
 *      lagringen skrev det som midnatt UTC. `events.start_time` är
 *      `timestamptz`, så originalet "2026-11-20" är inte längre
 *      synligt — men "UTC-klockan lyder 00:00" är det.
 *      (Stockholm är UTC+1/+2, så midnatt UTC hamnar alltid på
 *      samma kalenderdag lokalt.)
 *
 *   3. Lokal 00:00 räknas också som okänd — en riktig nattshow vid
 *      midnatt är sällan och skulle slå ihop tidlösa rader med den.
 */
export function stockholmLocalDateTime(
  iso: string | Date | null | undefined,
): LocalDateTime | null {
  if (iso === null || iso === undefined) return null;

  // `pg` ger Date, supabase-js ger ISO-sträng. Båda ska fungera —
  // och ge Samma svar, annars får samma evenemang två nycklar
  // beroende på vilken kodväg som räknade.
  //
  // Datumdelen är ALLTID Stockholms kalenderdag. Före 2026-10-30 tog
  // Date-vägen UTC-dagen (`utc.slice(0, 10)`), medan strängvägen tog
  // Stockholmsdagen. Mellan 23:00 och 24:00 UTC (vinter) / 22:00 och
  // 24:00 UTC (sommar) skiljer sig dagarna — dvs. för varje rad med
  // lokal midnatt. Mätt i live-DB: 1 186 rader fick olika nyckel beroende
  // på väg, och skrivvägen hittade 27 dubblettgrupper där den lagrade
  // nyckeln bara hittade 2.
  if (iso instanceof Date) {
    if (!Number.isFinite(iso.getTime())) return null;
    const utc = iso.toISOString();
    const utcTime = utc.slice(11, 16);
    const parts = Object.fromEntries(
      STOCKHOLM_FMT.formatToParts(iso).map((p) => [p.type, p.value]),
    );
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const localTime = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
    if (utcTime === '00:00' || localTime === '00:00') return { day, time: '' };
    return { day, time: localTime };
  }

  if (typeof iso !== 'string') return null;

  const trimmed = iso.trim();
  if (!trimmed) return null;

  // Bara datum ("2026-11-13") → tiden är okänd.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { day: trimmed, time: '' };
  }

  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;

  const parts = Object.fromEntries(
    STOCKHOLM_FMT.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const localTime = `${hour}:${parts.minute}`;

  // UTC-klockan: är det exakt midnatt? Då skrev källan bara ett datum.
  const utcTime = new Date(ms).toISOString().slice(11, 16);

  if (utcTime === '00:00' || localTime === '00:00') {
    return { day, time: '' };
  }

  return { day, time: localTime };
}

/**
 * Bygg identitetsnyckeln för en rad.
 *
 * Returnerar null om raden inte kan identifieras säkert (ingen titel
 * eller ogiltig tidsstämpel) — sådan rad ska aldrig dedupas.
 */
export function crossSourceIdentity(input: IdentityInput): string | null {
  const title = normalizeIdentityTitleWithVenue(input.title, input.venueName);
  if (!title) return null;

  const dt = stockholmLocalDateTime(input.startTime);
  if (!dt) return null;

  const venue = venueIdentityKey({ venueId: input.venueId, venueName: input.venueName });

  return `${title}|${dt.day}|${dt.time}|${venue}`;
}

/**
 * Nyckel utan plats — används för att hitta tidssatta kandidater när en
 * rad med okänd tid ska bridgas till en rad med känd tid.
 */
export function crossSourceIdentityWithoutVenue(input: IdentityInput): string | null {
  const title = normalizeIdentityTitleWithVenue(input.title, input.venueName);
  if (!title) return null;
  const dt = stockholmLocalDateTime(input.startTime);
  if (!dt) return null;
  return `${title}|${dt.day}`;
}

/**
 * Nyckel för samma titel+datum (utan tid) med en given plats.
 * Används av date-only-bridging: en rad med okänd tid får bara slås
 * ihop med en tidsatt rad om det finns EXAKT EN sådan kandidat.
 */
export function bridgingCandidateKey(input: IdentityInput): string | null {
  const title = normalizeIdentityTitleWithVenue(input.title, input.venueName);
  if (!title) return null;
  const dt = stockholmLocalDateTime(input.startTime);
  if (!dt) return null;
  const venue = venueIdentityKey({ venueId: input.venueId, venueName: input.venueName });
  return `${title}|${dt.day}|${venue}`;
}

/**
 * Har raden en känd klockslag?
 */
export function hasKnownTime(input: IdentityInput): boolean {
  const dt = stockholmLocalDateTime(input.startTime);
  return dt !== null && dt.time !== '';
}
