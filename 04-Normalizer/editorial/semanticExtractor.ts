/**
 * semanticExtractor.ts — semantisk extraktion från raw_description.
 *
 * NY design 2026-10-08: Event Understanding FÅR läsa raw_description för att
 * extrahera BETYDELSE, INTE formulering. Det vi tar ut är strukturerade
 * entiteter (orchestra, soloist, composers, works) som lagras i Profile —
 * INTE meningar som skulle kunna läcka till Writer.
 *
 * Viktigt kontrakt:
 *
 *   1. Vi extraherar ENBART entiteter (namn, antal, listor) — INTE meningar.
 *   2. textualFirewall tillåter INTE att raw_description når WriterInputss.
 *   3. compileWriterInputs() kastar om source_description/råtekst finns i
 *      inputs (vilket gör att även om någon råkar skicka raw_description
 *      via Profile.fältnamn så blockeras det i brandväggen).
 *   4. Vi skriver ALDRIG hela meningar/citat i Profile. Bara:
 *      - "Zurich Youth Symphony Orchestra" (ensemble)
 *      - "Ilya Shmukler" (performer)
 *      - ["Berwald", "Rachmaninov", "Sibelius"] (repertoire)
 *      - [{title: "Estrella de Soria", composer: "Berwald"}] (works)
 *      - 130 (duration_minutes)
 *
 * Zurich-pattern (från Supabase ticketmaster-linkoping 2026-10-08):
 *   raw: "...ungdomssymfoniorkestrar, Zürich Youth Orchestra... 95 musiker...
 *         Pianosolist är den unge stjärnpianisten Ilya Shmukler...
 *         Berwald... Rachmaninov... Sibelius...
 *         Estrella de Soria av Franz Berwald... Rachmaninovs andra pianokonsert...
 *         Sibelius första symfoni... Längd: ca 2 timmar & 10 minuter..."
 *
 *   → Profile.ensemble = "Zurich Youth Symphony Orchestra"
 *   → Profile.performers = ["Ilya Shmukler"]
 *   → Profile.repertoire = ["Estrella de Soria (Berwald)",
 *                            "Pianokonsert nr 2 (Rachmaninov)",
 *                            "Symfoni nr 1 (Sibelius)"]
 *   → duration_minutes = 130 (om start+end är opålitligt)
 *
 * Pipeline-steg 1.4 i P7 Definition of Done. Tillagd 2026-10-08.
 */

// ─── Known composers (used to detect classical music entities) ──────────────

const KNOWN_COMPOSERS: ReadonlyArray<{ name: string; aliases: string[] }> = [
  { name: 'Berwald', aliases: ['berwald', 'franz berwald'] },
  { name: 'Rachmaninov', aliases: ['rachmaninov', 'rachmaninoff'] },
  { name: 'Sibelius', aliases: ['sibelius', 'jean sibelius'] },
  { name: 'Beethoven', aliases: ['beethoven', 'ludwig van beethoven'] },
  { name: 'Mozart', aliases: ['mozart', 'wolfgang amadeus mozart'] },
  { name: 'Chopin', aliases: ['chopin', 'frederic chopin'] },
  { name: 'Tchaikovsky', aliases: ['tchaikovsky', 'tjakovskij'] },
  { name: 'Mahler', aliases: ['mahler', 'gustav mahler'] },
  { name: 'Debussy', aliases: ['debussy', 'claude debussy'] },
  { name: 'Ravel', aliases: ['ravel', 'maurice ravel'] },
  { name: 'Strauss', aliases: ['strauss', 'johann strauss', 'richard strauss'] },
  { name: 'Brahms', aliases: ['brahms', 'johannes brahms'] },
  { name: 'Schubert', aliases: ['schubert', 'franz schubert'] },
  { name: 'Schumann', aliases: ['schumann', 'robert schumann'] },
  { name: 'Stenhammar', aliases: ['stenhammar', 'wilhelm stenhammar'] },
  { name: 'Lindblad', aliases: ['lindblad', 'adolf fredrik lindblad'] },
  { name: 'Grieg', aliases: ['grieg', 'edvard grieg'] },
  { name: 'Bach', aliases: ['bach', 'johann sebastian bach'] },
  { name: 'Handel', aliases: ['handel', 'georg friedrich händel', 'haendel'] },
  { name: 'Vivaldi', aliases: ['vivaldi', 'antonio vivaldi'] },
  { name: 'Haydn', aliases: ['haydn', 'joseph haydn'] },
  { name: 'Liszt', aliases: ['liszt', 'franz liszt'] },
  { name: 'Bruckner', aliases: ['bruckner', 'anton bruckner'] },
  { name: 'Wagner', aliases: ['wagner', 'richard wagner'] },
  { name: 'Verdi', aliases: ['verdi', 'giuseppe verdi'] },
  { name: 'Puccini', aliases: ['puccini', 'giacomo puccini'] },
  { name: 'Mendelssohn', aliases: ['mendelssohn', 'felix mendelssohn'] },
  { name: 'Dvořák', aliases: ['dvořák', 'dvorak', 'antonin dvořák'] },
  { name: 'Elgar', aliases: ['elgar', 'edward elgar'] },
  { name: 'Satie', aliases: ['satie', 'erik satie'] },
];

// ─── Public extraction result ────────────────────────────────────────────────

export interface SemanticExtraction {
  /** Orkester/ensemble-namn (t.ex. "Zurich Youth Symphony Orchestra"). */
  ensemble?: string;
  /** Antal musiker i orkestern (t.ex. 95). */
  orchestra_size?: number;
  /** Typ av ensemble ("symfoniorkester", "kammarensemble", etc.). */
  ensemble_type?: string;
  /** Soloist-namn (t.ex. "Ilya Shmukler"). */
  soloist_name?: string;
  /** Soloist-roll (t.ex. "pianosolist", "violinsolist"). */
  soloist_role?: string;
  /** Identifierade kompositörer (t.ex. ["Berwald", "Rachmaninov", "Sibelius"]). */
  composers: string[];
  /** Identifierade verk med kompositörs-attribution. */
  works: Array<{ title: string; composer?: string }>;
  /** Längd i minuter (om text anger detta, t.ex. "ca 2 timmar & 10 minuter"). */
  duration_minutes_from_text?: number;
  /** Vilka source-rader bidragit med vad (för loggning/audit). */
  evidence: Array<{ field: string; value: string; source_pattern: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchFirst(text: string, regex: RegExp): string | null {
  const m = text.match(regex);
  return m ? m[1].trim() : null;
}

/**
 * Hjälpfunktion: avgör om en extraherad work-titel är brus snarare än ett
 * verkligt verk. Brus inkluderar:
 *   - Titlar som börjar med meningsinledande adverb ("Med", "Först", "Därefter",
 *     "Slutligen", "Sedan", "Programmet", "Där", "Här")
 *   - Titlar som innehåller work-context keywords ("uvertyren", "konserten",
 *     "till", "före", "efter", "och", "i Linköping", etc.)
 *   - Titlar med för låg musikalisk signal (för många stoppord, ingen form-term)
 */
function isNoisyWorkTitle(title: string): boolean {
  const lower = title.toLowerCase();

  // 1. Meningsinledande adverb/prepositioner
  if (/^(?:med|och|en|av|i|på|för|den|som|från|det|denna|detta|när|sedan|därefter|slutligen|först|där|här|programmet|personlig|personligt|musik|samt|även|också|som|inleder|öppnar|avslutar|spelar|framför|återvänder)\b/i.test(title)) {
    return true;
  }

  // 2. Work-context keywords (signalera att det inte är en titel utan kontext)
  if (/\b(?:uvertyren|konserten|sonaten|symfonin|tillverkningen|till\s|konsert\s+och|före\s+konserten|efter\s+konserten)\b/i.test(lower)) {
    return true;
  }

  // 3. Om titeln innehåller flera stoppord men inget musikaliskt verk-nyckelord
  //    → troligen inte ett verk utan en mening.
  const stopwords = title.match(/\b(?:och|med|en|av|i|på|för|den|som|från|det|denna|detta|denne|när|sedan|därefter|slutligen|först|där|här|vid|efter|utan|under|över|detta|denna)\b/gi) ?? [];
  const musicalTerms = title.match(/\b(?:konsert|symfoni|sonat|sonatin|kvartett|trio|opera|fantasi|svit|partita|concerto|sonata|symphony|sinfonia|fuga|prelud|uvertyr|sats|vals|menuett|adagio|allegro|tema|variation|kapric|rapsodi|scherzo|fantasie|etyd|nocturne|impromptu|ballad|romance|barcarole|berceuse|cantata|oratorium|requiem|mässa|sinfoniett|sinfonietta)\b/i) ?? [];
  // Om ≥3 stoppord men inga musikaliska termer → brus
  if (stopwords.length >= 3 && musicalTerms.length === 0) {
    return true;
  }

  return false;
}

/**
 * Hitta första composer-namn som matchar i text.
 * Använder word-boundary-matching för att undvika falska positiver
 * ("ravel" i "genomtravst").
 */
function findComposerInText(text: string, startIdx: number): { composer: string; idx: number } | null {
  const slice = text.slice(startIdx).toLowerCase();
  let best: { composer: string; idx: number } | null = null;
  for (const c of KNOWN_COMPOSERS) {
    for (const alias of c.aliases) {
      // Tillåt genitiv-suffix ("Rachmaninovs", "Beethovens") och "s" efter.
      // Word-boundary i början, men bara word-char eller slut i slutet.
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const aliasRx = new RegExp(`\\b${escaped}(?:s|'s)?\\b`, 'i');
      const m = slice.match(aliasRx);
      if (m && m.index !== undefined && (best === null || m.index < best.idx)) {
        best = { composer: c.name, idx: m.index + startIdx };
      }
    }
  }
  return best;
}

// ─── Huvudfunktion ──────────────────────────────────────────────────────────

/**
 * Extrahera semantik från raw_description-text.
 *
 * Returnerar tomt resultat (alla fält undefined/[]) om text är null/tom.
 * Returnerar ALDRIG meningar — bara entiteter.
 */
export function extractSemantics(rawDescription: string | null | undefined): SemanticExtraction {
  const result: SemanticExtraction = {
    composers: [],
    works: [],
    evidence: [],
  };

  if (!rawDescription || typeof rawDescription !== 'string') return result;
  const text = rawDescription.trim();
  if (text.length === 0) return result;

  // ── 1. Orkester/ensemble ───────────────────────────────────────────────
  // Mönster: "X orkester", "X Orchestra", "X Sinfonietta", "X filharmoniker",
  //          "X Ensemble", "X kammarensemble", "X stråkkvartett"
  //
  // VIKTIGT: vi kräver att matchning INTE innehåller meningsbrytande
  // skiljetecken (., ;, !) OCH att prefixet är rimligt (max 3 ord innan
  // suffix). Detta förhindrar att "Det är en fullstor symfoniorkester"
  // matchas som ensemble-namn.
  const orchestraPatterns: Array<{ regex: RegExp; type: string }> = [
    { regex: /\b([\p{Lu}][\p{L}\-]+(?:\s+[\p{Lu}][\p{L}\-]+){0,4}\s+(?:Youth\s+Symphony\s+Orchestra|Symphony\s+Orchestra|Philharmonic(?:\s+Orchestra)?|Symphony))\b/u, type: 'symphony_orchestra' },
    { regex: /\b([\p{Lu}][\p{L}\-]+(?:\s+[\p{L}\-]+){0,4}\s+(?:symfoniorkester|filharmoniker|sinfonietta|kammarorkester|storband|big\sband))\b/u, type: 'orchestra_sv' },
    { regex: /\b([\p{Lu}][\p{L}\-]+(?:\s+[\p{L}\-]+){0,4}\s+(?:Orchestra|Orchestre|Ensemble|Sinfonietta|Chamber\s+Orchestra))\b/u, type: 'orchestra_en' },
    { regex: /\b([\p{Lu}][\p{L}\-]+(?:\s+[\p{L}\-]+){0,4}\s+(?:orkester))\b/u, type: 'orkester_sv' },
  ];

  for (const p of orchestraPatterns) {
    const m = text.match(p.regex);
    if (m && m[1]) {
      const cleaned = m[1].replace(/\s+/g, ' ').trim();
      // Avvisa om innehåller skiljetecken (mening), ledord som "det är en", "fullstor", "med"
      if (
        cleaned.length >= 4 &&
        cleaned.length <= 80 &&
        !/[.,;!?]/.test(cleaned) &&
        !/^(?:Det|Detta|Det\s+är|Med|Fullstor|Hel|Sin|Deras)/i.test(cleaned)
      ) {
        result.ensemble = cleaned;
        result.ensemble_type = p.type;
        result.evidence.push({
          field: 'ensemble',
          value: cleaned,
          source_pattern: p.regex.source.slice(0, 80),
        });
        break;
      }
    }
  }

  // ── 2. Orkesterstorlek ─────────────────────────────────────────────────
  // Mönster: "N musiker", "med N musiker", "N medlemmar"
  const sizeMatch = text.match(/(\d{1,4})\s*(?:musiker|medlemmar|spelmän|musicians)/i);
  if (sizeMatch) {
    const n = parseInt(sizeMatch[1], 10);
    if (n >= 1 && n <= 500) {
      result.orchestra_size = n;
      result.evidence.push({
        field: 'orchestra_size',
        value: String(n),
        source_pattern: 'N musiker',
      });
    }
  }

  // ── 3. Soloist ─────────────────────────────────────────────────────────
  // Mönster:
  //   "Pianosolist är X", "Pianosolist: X"
  //   "Solist X", "Solist: X"
  //   "med X på piano/violin/cello"
  //   "X är pianosolist"
  const soloistPatterns: Array<{ regex: RegExp; role: string }> = [
    { regex: /(?:Pianosolist|Pianist)\s*(?:är|:)\s+([A-ZÅÄÖ][\wÅÄÖåäöÀ-ſ\.\s\-]{2,40})/i, role: 'pianosolist' },
    { regex: /(?:Violinsolist|Violinist)\s*(?:är|:)\s+([A-ZÅÄÖ][\wÅÄÖåäöÀ-ſ\.\s\-]{2,40})/i, role: 'violinsolist' },
    { regex: /(?:Cellosolist)\s*(?:är|:)\s+([A-ZÅÄÖ][\wÅÄÖåäöÀ-ſ\.\s\-]{2,40})/i, role: 'cellosolist' },
    { regex: /(?:Solist)\s*(?:är|:)\s+([A-ZÅÄÖ][\wÅÄÖåäöÀ-ſ\.\s\-]{2,40})/i, role: 'solist' },
    { regex: /(?:med)\s+([A-ZÅÄÖ][\wÅÄÖåäöÀ-ſ\.\s\-]{2,40})\s+(?:på|vid)\s+(?:piano|fiol|violin|cello)/i, role: 'solist' },
  ];

  for (const p of soloistPatterns) {
    const m = text.match(p.regex);
    if (m && m[1]) {
      // Ta bara första meningen/namnet (sluta vid punkt, komma, semikolon)
      let name = m[1].split(/[,.;:!?]/)[0].trim();
      // Filtrera bort beskrivande adjektiv i början ("den unge stjärnpianisten")
      // Tar bort allt INNAN sista versalen-började sekvensen.
      name = name.replace(/^(?:den|de|det|som|är|och|nyligen|även)[^.A-ZÅÄÖ]*?(?=[A-ZÅÄÖ])/, '').trim();
      // Ta bort ändelser som "pianisten", "violinisten" etc. som inte är del av namn
      // (vi behåller dem — de kan vara en del av hur namnet presenteras)
      if (name.length >= 3 && name.length <= 60 && /^[A-ZÅÄÖ]/.test(name)) {
        result.soloist_name = name;
        result.soloist_role = p.role;
        result.evidence.push({
          field: 'soloist',
          value: name,
          source_pattern: p.regex.source.slice(0, 80),
        });
        break;
      }
    }
  }

  // ── 4. Kompositörer (söker igenom HELA texten) ────────────────────────
  const found = new Set<string>();
  let cursor = 0;
  while (cursor < text.length) {
    const hit = findComposerInText(text, cursor);
    if (!hit) break;
    if (!found.has(hit.composer)) {
      found.add(hit.composer);
      result.composers.push(hit.composer);
      result.evidence.push({
        field: 'composer',
        value: hit.composer,
        source_pattern: 'known composer name match',
      });
    }
    cursor = hit.idx + 1;
  }

  // ── 5. Verk med kompositörs-attribution ────────────────────────────────
  // Mönster:
  //   - "X av [Composer]" eller "X av [Förnamn] [Composer]"
  //   - "[Composer]s första symfoni" (svensk genitiv) eller "[Composer] X"
  //   - "uvertyren/konserten till X av [Composer]"
  //
  // Vi tillåter valfritt förnamn mellan "av" och kompositör för att fånga
  // "Estrella de Soria av Franz Berwald".
  // Vi tillåter valfri genitiv (`s`) EFTER kompositör för att fånga både
  // "Rachmaninovs andra pianokonsert" och "Sibelius första symfoni".
  const composerGroup =
    '(Berwald|Rachmaninov|Sibelius|Beethoven|Mozart|Chopin|Tchaikovsky|Mahler|Debussy|Ravel|Strauss|Brahms|Schubert|Schumann|Stenhammar|Lindblad|Grieg|Bach|Handel|Vivaldi|Haydn|Mendelssohn|Elgar|Satie)';
  const firstNameOpt = '(?:[A-ZÅÄÖ][\\wÅÄÖåäöÀ-ſ\\-]+\\s+)?';
  const workPatterns: Array<RegExp> = [
    // "X av [Förnamn?] Composer"
    new RegExp(
      `([A-ZÅÄÖ][\\wÅÄÖåäöÀ-ſ\\s\\-]{3,50}?)\\s+av\\s+${firstNameOpt}${composerGroup}`,
      'g',
    ),
    // "Composer(s)? X" — fångar både "Rachmaninovs X" och "Sibelius X"
    new RegExp(
      `${composerGroup}(?:s|'s)?\\s+([\\wÅÄÖåäöÀ-ſ\\s\\-]{3,60}?)(?:\\.|,|;|$)`,
      'g',
    ),
    // "uvertyren/konserten (till) X av [Förnamn?] Composer"
    new RegExp(
      `(?:uvertyren|tema|piece|concerto|sonaten|symfonin|konserten|verket| operan)\\s+(?:till\\s+)?([A-ZÅÄÖ][\\wÅÄÖåäöÀ-ſ\\s\\-]{3,50}?)\\s+av\\s+${firstNameOpt}${composerGroup}`,
      'g',
    ),
  ];

  const worksSet = new Set<string>();
  for (const pattern of workPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      let title: string;
      let composer: string | undefined;
      if (m.length === 3) {
        // Either "X av Y" or "Ys X"
        // Detect which form based on first capture
        const first = m[1];
        const second = m[2];
        if (KNOWN_COMPOSERS.some((c) => c.aliases.includes(first.toLowerCase()))) {
          composer = first.charAt(0).toUpperCase() + first.slice(1);
          title = second;
        } else {
          title = first;
          composer = second;
        }
      } else {
        title = m[1];
        composer = m[2];
      }
      // Rensa bort artefakter
      title = title.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim();
      if (title.length < 3 || title.length > 80) continue;
      // Filtrera bort brus: titlar som börjar med meningsbrytande adverb/prepositioner,
      // eller som innehåller work-context keywords (false positives från mönster 1 och 2).
      if (isNoisyWorkTitle(title)) continue;
      const key = `${title}::${composer ?? ''}`;
      if (worksSet.has(key)) continue;
      worksSet.add(key);
      result.works.push({ title, composer });
      result.evidence.push({
        field: 'work',
        value: `${title}${composer ? ` (${composer})` : ''}`,
        source_pattern: pattern.source.slice(0, 80),
      });
    }
  }

  // ── 6. Längd från text ─────────────────────────────────────────────────
  // Mönster: "Längd: ca 2 timmar & 10 minuter", "ca 2 timmar", "2 timmar 10 min"
  const hourMinMatch = text.match(/(?:ca\s+)?(\d{1,2})\s*tim(?:mar|me)\s*(?:&|och)?\s*(\d{1,2})?\s*(?:minuter|min)/i);
  if (hourMinMatch) {
    const h = parseInt(hourMinMatch[1], 10);
    const m = hourMinMatch[2] ? parseInt(hourMinMatch[2], 10) : 0;
    if (h >= 1 && h <= 12 && m >= 0 && m <= 59) {
      result.duration_minutes_from_text = h * 60 + m;
      result.evidence.push({
        field: 'duration',
        value: `${h}h${m}m`,
        source_pattern: 'Längd: ca N timmar & M minuter',
      });
    }
  }

  return result;
}

/**
 * Applicera SemanticExtraction på EventProfile.
 *
 * Returnerar NY profile (immutability). Bara fält som extraherats
 * faktiskt sätts — vi skriver ALDRIG över existing_profile.performers.
 */
export function applySemanticExtraction(
  profile: import('./types').EventProfile,
  extraction: SemanticExtraction,
): import('./types').EventProfile {
  if (
    !extraction.ensemble &&
    !extraction.orchestra_size &&
    !extraction.ensemble_type &&
    !extraction.soloist_name &&
    extraction.composers.length === 0 &&
    extraction.works.length === 0 &&
    extraction.duration_minutes_from_text == null
  ) {
    return profile; // nothing to apply
  }

  const provenance = { ...profile.provenance };
  const addProv = (key: string, value: string) => {
    provenance[key] = [...(provenance[key] ?? []), value];
  };

  // ── Ensemble ──────────────────────────────────────────────────────────
  let ensemble = profile.ensemble;
  if (extraction.ensemble && !ensemble) {
    ensemble = extraction.ensemble;
    addProv('ensemble', `semantic_extractor:${extraction.ensemble_type ?? 'unknown'}`);
  } else if (extraction.ensemble_type && !ensemble) {
    addProv('ensemble_type', `semantic_extractor:${extraction.ensemble_type}`);
  }

  // ── Performers (soloist) ───────────────────────────────────────────────
  let performers = [...profile.performers];
  if (extraction.soloist_name && !performers.includes(extraction.soloist_name)) {
    performers = [extraction.soloist_name, ...performers];
    addProv('performers', `semantic_extractor:soloist:${extraction.soloist_role ?? 'unknown'}`);
  }

  // ── Repertoire (verk med kompositörer) ────────────────────────────────
  let repertoire = profile.repertoire ? [...profile.repertoire] : [];
  for (const work of extraction.works) {
    const entry = work.composer ? `${work.title} (${work.composer})` : work.title;
    if (!repertoire.includes(entry)) {
      repertoire.push(entry);
    }
  }
  if (extraction.works.length > 0) {
    addProv('repertoire', `semantic_extractor:${extraction.works.length} works`);
  }

  // ── Duration (text är MER tillförlitlig än category default) ────────
  // Om vi har "Längd: ca 2 timmar 10 minuter" → 130, är det starkare än
  // category-typiska 110. Vi overrider bara om text säger något — inte tvärtom.
  let duration_minutes = profile.duration_minutes;
  let durationProvenance = '';
  if (extraction.duration_minutes_from_text != null) {
    duration_minutes = extraction.duration_minutes_from_text;
    durationProvenance = 'semantic_extractor:duration_from_text';
  }

  // ── Concept (kompositörer) ────────────────────────────────────────────
  let concept = profile.concept;
  if (extraction.composers.length > 0) {
    const composerList = extraction.composers.join(', ');
    if (!concept) {
      concept = `Verk av ${composerList}`;
    } else if (!concept.includes(composerList)) {
      concept = `${concept} — verk av ${composerList}`;
    }
    addProv('concept', `semantic_extractor:composers(${extraction.composers.length})`);
  }

  // ── Experience characteristics (orkesterstorlek) ──────────────────────
  let experience_characteristics = [...profile.experience_characteristics];
  if (extraction.orchestra_size != null) {
    const sizeDesc = `${extraction.orchestra_size} musiker`;
    if (!experience_characteristics.includes(sizeDesc)) {
      experience_characteristics = [sizeDesc, ...experience_characteristics];
    }
    addProv('experience_characteristics', `semantic_extractor:orchestra_size`);
  }

  // ── Production characteristics (soloist-roll) ─────────────────────────
  let production_characteristics = profile.production_characteristics
    ? [...profile.production_characteristics]
    : [];
  if (extraction.soloist_role) {
    const prodDesc = `${extraction.soloist_role}`;
    if (!production_characteristics.includes(prodDesc)) {
      production_characteristics.push(prodDesc);
    }
    addProv('production_characteristics', `semantic_extractor:soloist_role`);
  }

  // Uppdatera provenance för duration om den applicerats
  if (durationProvenance) {
    addProv('duration_minutes', durationProvenance);
  }

  return {
    ...profile,
    ensemble,
    performers,
    repertoire: repertoire.length > 0 ? repertoire : profile.repertoire,
    concept,
    experience_characteristics,
    production_characteristics: production_characteristics.length > 0 ? production_characteristics : profile.production_characteristics,
    duration_minutes,
    provenance,
  };
}