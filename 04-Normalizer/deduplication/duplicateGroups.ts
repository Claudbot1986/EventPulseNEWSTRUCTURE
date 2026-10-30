/**
 * duplicateGroups — gruppera events som beskriver samma fysiska evenemang.
 *
 * Sitter ovanpå `crossSourceIdentity.ts` (nyckelns form) och används av
 * BÅDE normalizern (write-time: hitta en befintlig rad att uppdatera) och
 * `scripts/audit-duplicates.ts` (read-time: hitta dubbletter att slå ihop).
 * En implementation — mätning och produktion kan inte glida isär.
 *
 * TRE REGLER, mätta mot live-DB (16 309 events):
 *
 *   R1 (identitet): titel | dag | tid | plats är samma evenemang.
 *       Oavsett källa. Fångar t.ex. "Kneecap" i 5 källor (18:30, B-K).
 *
 *   R2 (samma lista): samma normaliserad ticket_url + samma dag + samma
 *       titel + tidsavvikelse < 180 min = samma evenemang.
 *       Källorna justerar klockslaget på samma sida: "Genom Natten"
 *       listas som 18:00 (sthlmlist), 19:30 (nalen) och 20:00
 *       (fb-events) — samma konsert.
 *
 *   R3 (källornas oenighet): samma titel + dag + plats, MEN från
 *       olika källor, och tidsavvikelse <= 180 min = samma evenemang.
 *       Fångar "Spawner & ånghäst parken" (livespot 17:00, nalen.se
 *       18:00, nalen.com 19:30) — en konsert, tre aggregatorer.
 *
 *   R4 (plats-alias): samma titel + dag + tid, men platsnamnen är
 *       olika varianter av samma sal. "Kulturhuset Stadsteatern" /
 *       "Kilen, Kulturhuset Stadsteatern, Sergels torg" /
 *       "Kulturhuset Stadsteatern Husby" — samma teater. "Nalen" /
 *       "Nalen Klubb, Stockholm" — samma lokal. "Avicii Arena" /
 *       "Avicii Arena (fd Globen)" — samma arena.
 *
 *       Mått: efter R1–R3 återstod 194 grupper (201 rader) där samma
 *       titel+dag+tid fanns med olika platsnamn. 62 av dem har plats-
 *       namn som är token-subsekvenser av varandra — de är samma sal.
 *
 * TVÅ SKYDDSREGLER (utan dem skulle vi ta bort riktiga evenemang):
 *
 *   S1  R2 och R3 slår ALDRIG ihop när tidsavvikelsen >= 180 min.
 *       "MAMMA MIA! THE PARTY" har lunch 12:00 och kväll 18:30 (390
 *       min) — två föreställningar. "Chicago - the Musical" har
 *       14:00 och 18:30 (270 min) — tidig och sen föreställning.
 *
 *   S2  R3 slår ALDRIG ihop rader från SAMMA källa. "Spökvandring i
 *       Medborgarhuset" ligger som 4 momentsapp-rader 14:15/15:00/
 *       15:45/16:30 — fyra SKILDA visningar av en promenad, inte
 *       fyra dubbletter. "Lena från Vetlanda" 14:00 och 17:30 hos
 *       livespot är matiné och kväll.
 *
 * Resultatet: grupper med 2+ rader. En rad hamnar högst i EN grupp.
 */

import {
  bridgingCandidateKey,
  crossSourceIdentity,
  hasKnownTime,
  normalizeIdentityTitle,
  normalizeIdentityTitleWithVenue,
  stockholmLocalDateTime,
  type IdentityInput,
} from './crossSourceIdentity';
import { canonicalVenueName } from '../../02-Ingestion/lib/sourceVenueRules';

export interface GroupableEvent {
  id: string;
  title?: string | null;
  /** ISO-sträng eller Date — `pg` ger Date, supabase-js ger sträng. */
  startTime?: string | Date | null;
  venueId?: string | null;
  venueName?: string | null;
  /**
   * Adressen till platsen (från venues-tabellen). Två event på samma
   * adress är på samma lokal, även om källorna skriver olika namn:
   * "Garden" (adress "Konsistoriegatan 7") och "Konsistoriegatan 7".
   */
  venueAddress?: string | null;
  source?: string | null;
  ticketUrl?: string | null;
}

export interface DuplicateGroup<T extends GroupableEvent> {
  /** Alla rader i gruppen (inklusive den "vinnande" raden). */
  members: T[];
  /** Vilka regler som bidrog till gruppen. */
  rules: Array<'identity' | 'same-listing' | 'cross-source' | 'venue-alias' | 'date-only-bridge' | 'manual'>;
  /**
   * Varför gruppen bildades — den regel som är mest specifik för gruppen.
   *
   * Skillnaden mot `rules` är viktig för läsbarheten i audit-rapporten:
   * "cross-source" kan betyda antingen att två källor listar samma show
   * med olika klockslag (troligen samma evenemang) eller att en rad
   * med OKÄND tid har bryggts till en tidsatt rad (då är det en gissning
   * som grundar sig på att det bara finns EN möjlig partner). Blanda
   * ihop de två gör rapporten otydlig — "date-only-bridge" är den
   * svagare av dem och ska synas.
   */
  reason: DuplicateGroup<T>['rules'][number];
  /**
   * Uttrycklig huvudrad, när operatören har granskat ett par manuellt.
   *
   * Utan den väljs vinnaren av poängskalningen (beskrivning, bild,
   * kategori, titel, plats) — bra för automatiska grupper, men fel för ett
   * manuellt par där riktningen är ett beslut, inte en gissning.
   */
  winnerId?: string;
}

export interface DuplicateRuleOptions {
  /**
   * Max tidsavvikelse i minuter för R2 och R3. Standard 180.
   * Över detta behandlas raderna som olika föreställningar.
   */
  maxTimeGapMinutes?: number;
}

const DEFAULT_MAX_GAP_MINUTES = 180;

function toIdentityInput<T extends GroupableEvent>(e: T): IdentityInput {
  return {
    title: e.title,
    startTime: e.startTime,
    venueId: e.venueId,
    venueName: e.venueName,
  };
}

/** Normaliserad ticket_url: ingen scheme, ingen trailing slash, ingen query. */
export function normalizeTicketUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '';
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/** Lokal tid i minuter sedan midnatt, eller null om tiden är okänd. */
function localMinutes(e: GroupableEvent): number | null {
  const dt = stockholmLocalDateTime(e.startTime);
  if (!dt || !dt.time) return null;
  return Number(dt.time.slice(0, 2)) * 60 + Number(dt.time.slice(3, 5));
}

/**
 * Ord som INTE får identifiera en plats på egen hand.
 *
 * "Stockholm" (och(sys) andra ortnamn) förekommer som suffix i nästan
 * varje samlingsplatsnamn: "Nalen Klubb, Stockholm", "Kulturhuset
 * Stadsteatern, Sergels torg, Stockholm". Om "stockholm" kunde matcha
 * en kortare sekvens skulle varje hall slås ihop med varje annan.
 */
const GENERIC_PLACE_TOKENS = new Set([
  'stockholm', 'goteborg', 'göteborg', 'malmo', 'malmö', 'uppsala',
  'sweden', 'sverige', 'scandinavia', 'nordics', 'city', 'staden',
  'stad', 'center', 'centrum',
]);

/** Dela ett platsnamn i normaliserade tokens. */
function placeTokens(name: string | null | undefined): string[] {
  return normalizeIdentityTitle(name).split(' ').filter(Boolean);
}

/**
 * Titelnyckel som också tar bort ett trailing platsnamn.
 *
 * "Terra – Garden" (spelning-se) och "Terra" (evensos) beskriver samma
 * evenemang; den första skriver lokalnamnet i titelfältet. Samma
 * normalisering används av identitetsnyckeln — annars skulle mätning och
 * produktion glida isär.
 */
function titleKey(e: GroupableEvent): string {
  return normalizeIdentityTitleWithVenue(e.title, e.venueName);
}

/** Är `small` en kontinuerlig subsekvens av `big`? */
function isContiguousSubsequence(big: string[], small: string[]): boolean {
  if (small.length === 0 || small.length > big.length) return false;
  for (let i = 0; i + small.length <= big.length; i++) {
    let ok = true;
    for (let j = 0; j < small.length; j++) {
      if (big[i + j] !== small[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Är två platsnamn varianter av samma sal?
 *
 *   "Nalen"                       ⊂ "Nalen Klubb, Stockholm"          → ja
 *   "Kulturhuset Stadsteatern"    ⊂ "Kilen, Kulturhuset Stadsteatern, Sergels torg" → ja
 *   "Avicii Arena"                ⊂ "Avicii Arena (fd Globen)"        → ja
 *   "Kungsholms kyrka"            ⊄ "Katarina Kyrka, Högbergsgatan"   → nej
 *   "Stockholm"                   → aldrig ensam (generiskt ord)
 *
 * FÖRE token-heuristiken prövas den GRANSKADE alias-tabellen
 * (`VENUE_NAME_ALIASES` i 02-Ingestion/lib/sourceVenueRules.ts). Varje par
 * där är en faktisk beläggt koppling — t.ex. "Styckmästergatan 10,
 * Stockholm" ↔ "Slaktkyrkan" (venue-raderna bekräftar adressen).
 *
 * Varför tabellen FÖR heuristiken: heuristiken är tokensekvens, så den
 * slår ihop "Garden" med "The Secret Garden" och "Rosendal Garden Party".
 * Mättning av just den heuristiken (scripts/canonicalize-venues.ts, senare
 * borttagen) slog ihop 2 730 event i Örebro, Umeå, Jönköping och Norrköping
 * med "Kulturhuset Stadsteatern" via en transitiv kedja. Alias-tabellen
 * innehåller bara par som en människa granskat — därför går den först.
 */
export function venueNamesAlias(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  // 1. Granskad alias-tabell — exakt och beläggt.
  const canonA = canonicalVenueName(a);
  const canonB = canonicalVenueName(b);
  if (canonA && canonB && canonA === canonB) return true;
  if (canonA && sameNormalizedName(canonA, b)) return true;
  if (canonB && sameNormalizedName(canonB, a)) return true;

  // 2. Token-subsekvens (mät: 62 av 194 kvarvarande grupper).
  const ta = placeTokens(a);
  const tb = placeTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;

  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length === long.length) return short.every((t, i) => t === long[i]);
  if (short.every((t) => GENERIC_PLACE_TOKENS.has(t))) return false;
  return isContiguousSubsequence(long, short);
}

/** Samma platsnamn efter normalisering (skiftläge, mellanslag, diakritiska). */
function sameNormalizedName(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeIdentityTitle(a);
  const nb = normalizeIdentityTitle(b);
  return na.length > 0 && na === nb;
}

/** Lokal kalenderdag, eller ''. */
function localDay(e: GroupableEvent): string {
  return stockholmLocalDateTime(e.startTime)?.day ?? '';
}

/** Max-min av kända tider i gruppen (null om ingen känd tid). */
function timeGap(events: GroupableEvent[]): number | null {
  const mins = events.map(localMinutes).filter((m): m is number => m !== null);
  if (mins.length < 2) return null;
  return Math.max(...mins) - Math.min(...mins);
}

/**
 * Gruppera rader som beskriver samma evenemang.
 *
 * @param events rader att gruppera (objekt behåller sina fält)
 * @returns grupper med 2+ rader. En rad förekommer högst i en grupp.
 */
export function groupDuplicateEvents<T extends GroupableEvent>(
  events: T[],
  options: DuplicateRuleOptions = {},
): DuplicateGroup<T>[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  const maxGap = options.maxTimeGapMinutes ?? DEFAULT_MAX_GAP_MINUTES;

  // ── union-find ──────────────────────────────────────────────────────────
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const byId = new Map<string, T>();
  for (const e of events) byId.set(e.id, e);

  /** Registrera vilka regler som användes för en union. */
  const ruleHits = new Map<string, Set<DuplicateGroup<T>['rules'][number]>>();
  const recordRule = (a: string, b: string, rule: DuplicateGroup<T>['rules'][number]) => {
    const key = [a, b].sort().join('|');
    const set = ruleHits.get(key) ?? new Set();
    set.add(rule);
    ruleHits.set(key, set);
  };

  const bucket = <K extends string>(map: Map<K, T[]>, key: K, e: T) => {
    const arr = map.get(key);
    if (arr) arr.push(e);
    else map.set(key, [e]);
  };

  // ── R1: identitetsnyckel (titel | dag | tid | plats) ───────────────────
  const identityBuckets = new Map<string, T[]>();
  for (const e of events) {
    const key = crossSourceIdentity(toIdentityInput(e));
    if (key) bucket(identityBuckets, key, e);
  }
  for (const members of identityBuckets.values()) {
    for (let i = 1; i < members.length; i++) {
      union(members[0].id, members[i].id);
      recordRule(members[0].id, members[i].id, 'identity');
    }
  }

  // ── R2: samma lista (url + dag + titel) ───────────────────────────────
  const listingBuckets = new Map<string, T[]>();
  for (const e of events) {
    const url = normalizeTicketUrl(e.ticketUrl);
    const day = localDay(e);
    const title = titleKey(e);
    if (!url || !day || !title) continue;
    bucket(listingBuckets, `${url}|${day}|${title}`, e);
  }
  for (const members of listingBuckets.values()) {
    if (members.length < 2) continue;
    // S2 — samma källa får INTE slås ihop via den här regeln.
    //
    // R2:s syfte är korskällslistor: "Genom Natten" listas som 18:00
    // (sthlmlist), 19:30 (nalen) och 20:00 (fb-events) — samma konsert,
    // tre källor, olika klockslag.
    //
    // Men en URL som bär FLERA föreställningar (en kväll med 18:30,
    // 19:30 och 20:30) ger tre rader från samma källa med samma URL.
    // De är tre skilda föreställningar — inte en. Mätt 2026-10-30:
    // "E.M.D." (rival.se) 18:30/19:30/20:30 och "Saint Levant"
    // (fallan.nu) 18:00/19:00/20:00 — båda tre föreställningar per
    // kväll, alla med samma URL. Utan S2 togs två av tre bort ur appen.
    if (new Set(members.map((m) => m.source ?? '')).size < 2) continue;
    const gap = timeGap(members);
    if (gap !== null && gap >= maxGap) continue; // S1
    for (let i = 1; i < members.length; i++) {
      union(members[0].id, members[i].id);
      recordRule(members[0].id, members[i].id, 'same-listing');
    }
  }

  // ── R3: källornas oenighet (titel + dag + plats, olika källor) ───────
  const crossBuckets = new Map<string, T[]>();
  for (const e of events) {
    const bk = bridgingCandidateKey(toIdentityInput(e));
    if (!bk) continue;
    bucket(crossBuckets, bk, e);
  }
  for (const members of crossBuckets.values()) {
    if (members.length < 2) continue;
    if (new Set(members.map((m) => m.source ?? '')).size < 2) continue; // S2
    const gap = timeGap(members);
    if (gap !== null && gap > maxGap) continue; // S1

    // S3 — ENTYDIGHET, symmetriskt. Ett par får bara slås ihop om BÅDA
    // sidor har exakt EN möjlig partner.
    //
    // Utan detta slår 180-minutersfönstret över flera föreställningar
    // samma kväll. Mätt 2026-10-30: "Yttling Jazz @ Fasching" finns
    // 19:00 (songkick), 20:00 (livespot) och 22:00 (songkick). R3 slog
    // ihop alla tre i en grupp — två riktiga föreställningar togs bort
    // ur appen.
    //
    // Symmetrin är det viktiga: livespot-raden 20:00 har TVÅ möjliga
    // partner (19:00 och 22:00). Om bara songkick-sidan räknas är
    // båda paren "entydiga" och kedjan bildas ändå. Med symmetrin
    // släpps båda — vi vet inte vilken som är samma evenemang.
    //
    // Två rader i samma bucket (den vanliga fallen: en källa har rätt
    // tid, en annan har fel) är entydiga → de slås ihop ✓.
    // Flera möjliga par → lämna dem ifred. En missad dubblett är
    // billigare än att ta bort ett riktigt evenemang.
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const candidates = members.filter(
        (c, j) => j !== i && (c.source ?? '') !== (m.source ?? ''),
      );
      if (candidates.length !== 1) continue;
      const other = candidates[0];
      const otherCandidates = members.filter(
        (c) => c.id !== other.id && (c.source ?? '') !== (other.source ?? ''),
      );
      if (otherCandidates.length !== 1) continue;
      union(m.id, other.id);
      recordRule(m.id, other.id, 'cross-source');
    }
  }

  // ── R6: datumlös rad bryggs till sin ENDA tidsatta partner ─────────────
  //
  // Samma källa, samma titel, samma dag, samma plats — men ena raden har
  // en tid och den andra saknar den. Källan listade samma sak två
  // gånger, varav en lista inte fick med klockslaget.
  //
  // SKYD (därför att detta är den svagaste regeln):
  //   - Bunken måste innehålla EXAKT två rader. Är det fler finns det
  //     fler möjliga partner och kopplingen vore ett gissande.
  //     ("E.M.D." 18:30/19:30/20:30 med en tidlös rad: 3 rader → ingen
  //     brygga.)
  //   - Bara inom samma källa. Korskällsfallet hanteras av R3, som har
  //     starkare skydd (S1 + symmetrisk entydighet S3).
  //   - En rad med känd tid och en med okänd tid. Två tidsatta rader
  //     (t.ex. matiné 13:00 + kväll 19:00) slås INTE ihop.
  //
  // Mätt 2026-10-30 i live-DB: 12 par matchar detta mönster (t.ex.
  // "Fri Fredag på Moderna Museet", "Sång- och sagostund",
  // "Halloween på Skansen") — varje gång samma evenemang listat två
  // gånger av samma källa, varav en lista saknade klockslaget.
  for (const members of crossBuckets.values()) {
    if (members.length !== 2) continue;
    const [a, b] = members;
    if ((a.source ?? '') !== (b.source ?? '')) continue; // R3 täcker korskälla
    const aKnown = hasKnownTime(toIdentityInput(a));
    const bKnown = hasKnownTime(toIdentityInput(b));
    if (aKnown === bKnown) continue; // ena tidsatt, ena tidlös
    union(a.id, b.id);
    recordRule(a.id, b.id, 'date-only-bridge');
  }

  // ── R4: plats-alias (samma titel + dag + tid, platsnamn = varianter) ───
  //
  // Källorna skriver samma sal på olka sätt: "Nalen" / "Nalen Klubb,
  // Stockholm" / "Nalen – Stora Salen, Stockholm". Platsnamnen matchar
  // inte, så R1–R3 ser dem som olika evenemang.
  //
  // Matchar när den kortare token-sekvensen är en CONTIGUOUS subsekvens
  // av den längre: "kulturhuset stadsteatern" ⊂ "kilen kulturhuset
  // stadsteatern sergels torg".
  //
  // Skydd: en subsekvens som bara består av ortnamn ("stockholm") får
  // inte matcha — "Stockholm" är i praktiken varje samlingsplats
  // suffix och skulle slå ihop orelaterade salar.
  const aliasBuckets = new Map<string, T[]>();
  for (const e of events) {
    const t = titleKey(e);
    const dt = stockholmLocalDateTime(e.startTime);
    if (!t || !dt || !dt.time) continue;
    bucket(aliasBuckets, `${t}|${dt.day}|${dt.time}`, e);
  }
  for (const members of aliasBuckets.values()) {
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (!venueNamesAlias(members[i].venueName, members[j].venueName)) continue;
        union(members[i].id, members[j].id);
        recordRule(members[i].id, members[j].id, 'venue-alias');
      }
    }
  }

  // ── R4b: samma adress = samma lokal ────────────────────────────────────
  //
  // Källorna skriver ibort adressen som platsnamn: "Konsistoriegatan 7"
  // (adressen till Garden i Linköping). R4 matchar inte, eftersom
  // "konsistoriegatan 7" inte är en token-subsekvens av "garden".
  // Men adresserna är lika → samma lokal → samma evenemang.
  //
  // Skydd: en adress som bara är ett ortnamn ("Linköping", "Stockholm")
  // räknas INTE — då skulle alla Linköpingsevenemang slås ihop.
  const addressBuckets = new Map<string, T[]>();
  for (const e of events) {
    const addr = normalizeIdentityTitle(e.venueAddress);
    if (!addr || GENERIC_PLACE_TOKENS.has(addr) || addr.split(' ').length < 2) continue;
    // Måste vara SAMMA evenemang: titel + dag + tid + adress.
    const t = titleKey(e);
    const dt = stockholmLocalDateTime(e.startTime);
    if (!t || !dt || !dt.time) continue;
    bucket(addressBuckets, `${t}|${dt.day}|${dt.time}|${addr}`, e);
  }
  for (const members of addressBuckets.values()) {
    if (members.length < 2) continue;
    for (let i = 1; i < members.length; i++) {
      union(members[0].id, members[i].id);
      recordRule(members[0].id, members[i].id, 'venue-alias');
    }
  }

  // ── R5: ena sidan saknar plats (samma titel + dag + tid) ───────────────
  //
  // Vissa källor (mätt: fb-events-stockholm-apify, 42 rader) lämnar ingen
  // plats alls. Andra källor har den. Samma titel + dag + klockslag +
  // ena sidan saknar plats = samma evenemang.
  //
  // Skydd: gäller bara när den ENDA platsen saknas helt. Om båda sidor
  // har en plats och de skiljer sig, gäller R4 (alias) — inte R5.
  const venueLessBuckets = new Map<string, T[]>();
  for (const e of events) {
    const t = titleKey(e);
    const dt = stockholmLocalDateTime(e.startTime);
    if (!t || !dt || !dt.time) continue;
    const hasVenue = Boolean((e.venueName ?? '').trim() || (e.venueId ?? '').trim());
    if (hasVenue) continue;
    bucket(venueLessBuckets, `${t}|${dt.day}|${dt.time}`, e);
  }
  for (const members of venueLessBuckets.values()) {
    // Ingen guard på antal: en ENDA platslös rad mot en rad med plats är
    // det vanliga fallet (en källa saknar plats, en annan har den).
    // Hitta kandidater med plats: samma titel + dag + tid.
    for (const m of members) {
      const t = titleKey(m);
      const dt = stockholmLocalDateTime(m.startTime)!;
      const candidates = (aliasBuckets.get(`${t}|${dt.day}|${dt.time}`) ?? []).filter(
        (c) => c.id !== m.id,
      );
      for (const c of candidates) {
        const cHasVenue = Boolean((c.venueName ?? '').trim() || (c.venueId ?? '').trim());
        if (!cHasVenue) continue;
        union(m.id, c.id);
        recordRule(m.id, c.id, 'venue-alias');
      }
    }
  }

  // ── Bygg grupperna ─────────────────────────────────────────────────────
  const components = new Map<string, T[]>();
  for (const e of events) {
    const root = find(e.id);
    const arr = components.get(root);
    if (arr) arr.push(e);
    else components.set(root, [e]);
  }

  const groups: DuplicateGroup<T>[] = [];
  for (const members of components.values()) {
    if (members.length < 2) continue;
    const rules = new Set<DuplicateGroup<T>['rules'][number]>();
    for (const a of members) {
      for (const b of members) {
        if (a.id === b.id) continue;
        const set = ruleHits.get([a.id, b.id].sort().join('|'));
        if (set) for (const r of set) rules.add(r);
      }
    }
    groups.push({ members, rules: [...rules], reason: primaryRule(rules) });
  }

  return groups;
}

/**
 * Den regel som beskriver gruppen BÄST — starkast bevis först.
 *
 * 'date-only-bridge' ligger sist: den bygger på att det bara finns EN
 * möjlig partner, inte på att två rader pekar på samma sak. En grupp
 * som bara bärs av den regeln ska därför aldrig beskrivas som ett
 * säkert "samma evenemang".
 */
const RULE_PRIORITY: Array<DuplicateGroup<GroupableEvent>['rules'][number]> = [
  'manual',
  'identity',
  'same-listing',
  'venue-alias',
  'cross-source',
  'date-only-bridge',
];

function primaryRule(
  rules: Set<DuplicateGroup<GroupableEvent>['rules'][number]>,
): DuplicateGroup<GroupableEvent>['rules'][number] {
  for (const rule of RULE_PRIORITY) if (rules.has(rule)) return rule;
  return 'identity';
}

/**
 * Antal extra rader (rader som skulle tas bort) i en grupplista.
 */
export function duplicateExtras<T extends GroupableEvent>(groups: DuplicateGroup<T>[]): number {
  return groups.reduce((s, g) => s + g.members.length - 1, 0);
}

/**
 * Platsnyckel som används av både nyckelberäkning och audit.
 */
export { venueIdentityKey, bridgingCandidateKey, hasKnownTime } from './crossSourceIdentity';
