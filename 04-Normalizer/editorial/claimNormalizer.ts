/**
 * claimNormalizer.ts — normalisering av claims mot Profile-fakta.
 *
 * Syfte: factuality-checkern ska INTE ge false negatives för att samma
 * fakta uttrycks i olika format. Om Profile har `duration_minutes: 130`
 * och Writer skriver "2 tim 10 min" ska det matchas.
 *
 * Normaliseringar:
 *   - Duration: "2 h 10 min" / "2 tim 10 min" / "130 min" / "2 timmar och 10 minuter"
 *     → alla → minuter (130)
 *   - Datum: "8 oktober" / "8/10" / "2026-10-08" / "lördag 8 oktober"
 *     → alla → ISO-datum (2026-10-08)
 *   - Klockslag: "19:00" / "kl 19" / "19.00" / "klockan sju på kvällen"
 *     → alla → HH:MM (19:00)
 *   - Pris: "250 kr" / "250:-" / "250 kronor" / "250 SEK"
 *     → alla → kr-belopp (250)
 *   - Åldersgräns: "18 år" / "från 18" / "18+"
 *     → alla → min_age (18)
 *   - Namn: "Beethoven" / "Ludwig van Beethoven" / "L. v. Beethoven"
 *     → alla → "beethoven" (match mot alla alias)
 *   - Numeriska uttryck: "95 musiker" ↔ "95-manna orkester"
 *     → match mot numeriskt värde
 *
 * Approach: när vi BYGGER evidence base, lägger vi till normaliserade
 * former av varje värde. När vi EXTRAHERAR claims, normaliserar vi dem
 * innan matchning.
 *
 * Steg 7/15 i P7 Definition of Done. Tillagd 2026-10-08.
 */

// ─── Duration ────────────────────────────────────────────────────────────────

/**
 * Parsa en duration-sträng till minuter (eller null om oparsbar).
 *
 * Accepterar:
 *   "130 min"           → 130
 *   "2 h 10 min"        → 130
 *   "2 tim 10 min"      → 130
 *   "2 timmar och 10 minuter" → 130
 *   "2 timmar, 10 min"  → 130
 *   "2:10"              → 130
 *   "2h10m"             → 130
 *   "ca 2 timmar"       → 120
 *   "1.5 timme"         → 90
 */
export function parseDurationToMinutes(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // HH:MM eller H:MM format
  const colonMatch = lower.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    return parseInt(colonMatch[1], 10) * 60 + parseInt(colonMatch[2], 10);
  }

  // "N tim" / "N timmar" / "N h" / "N hour"
  const hourMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:tim(?:mar|me)?|h(?:our)?)/);
  let minutes = 0;
  if (hourMatch) {
    const h = parseFloat(hourMatch[1].replace(',', '.'));
    minutes += Math.round(h * 60);
  }

  // "N min" / "N minuter"
  const minMatch = lower.match(/(\d+)\s*(?:min(?:uter)?|m(?:\b|$))/);
  if (minMatch) {
    minutes += parseInt(minMatch[1], 10);
  }

  // "N sek" / "N seconds"
  const secMatch = lower.match(/(\d+)\s*(?:sek(?:under)?|s(?:\b|$))/);
  if (secMatch && minutes === 0) {
    // Bara sekunder → returnera 0 (vi håller oss till minuter)
    return 0;
  }

  if (minutes > 0) return minutes;

  // "N minuter" utan hours (ren minuter)
  const pureMin = lower.match(/^(\d+)\s*min/);
  if (pureMin) return parseInt(pureMin[1], 10);

  return null;
}

/**
 * Returnera alla normaliserade duration-former för en sträng.
 * Används för att bygga evidence base.
 */
export function durationNormalForms(text: string): string[] {
  const total = parseDurationToMinutes(text);
  if (total == null) return [];
  const forms = new Set<string>();
  forms.add(`${total} min`);
  forms.add(`${total} minuter`);
  forms.add(`${total}min`);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) {
    forms.add(`${h} tim`);
    forms.add(`${h} timmar`);
    if (m === 0) {
      forms.add(`${h} h`);
    } else {
      forms.add(`${h} tim ${m} min`);
      forms.add(`${h} timmar ${m} minuter`);
      forms.add(`${h} h ${m} min`);
      forms.add(`${h}:${String(m).padStart(2, '0')}`);
    }
  }
  return Array.from(forms);
}

// ─── Date ────────────────────────────────────────────────────────────────────

const SWEDISH_MONTHS: Record<string, number> = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

const SWEDISH_DAYS: Record<string, number> = {
  söndag: 0, måndag: 1, tisdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lördag: 6,
};

/**
 * Parsa svensk datum-sträng till ISO-datum (YYYY-MM-DD) eller null.
 *
 * Accepterar:
 *   "8 oktober 2026"  → 2026-10-08
 *   "8 oktober"       → null (saknar år)
 *   "2026-10-08"      → 2026-10-08
 *   "8/10 2026"       → 2026-10-08
 *   "8/10"            → null (saknar år)
 *   "lördag 8 oktober" → 2026-10-08
 */
export function parseSwedishDate(text: string, yearHint?: number): string | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // ISO-format
  const isoMatch = lower.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  // Svenskt format "8 oktober 2026" eller "8 oktober"
  const svMatch = lower.match(/(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?/);
  if (svMatch) {
    const day = parseInt(svMatch[1], 10);
    const monthName = svMatch[2];
    const year = svMatch[3] ? parseInt(svMatch[3], 10) : yearHint;
    const month = SWEDISH_MONTHS[monthName];
    if (month && year) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // "8/10 2026" eller "8/10-2026"
  const slashMatch = lower.match(/(\d{1,2})\/(\d{1,2})(?:\s*[-\/]?\s*(\d{4}))?/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10);
    const year = slashMatch[3] ? parseInt(slashMatch[3], 10) : yearHint;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Returnera normaliserade former av en datum-sträng.
 */
export function dateNormalForms(text: string, yearHint?: number): string[] {
  const iso = parseSwedishDate(text, yearHint);
  if (!iso) return [];
  const [, m, d] = iso.split('-');
  const monthName = Object.entries(SWEDISH_MONTHS).find(([_, num]) => num === parseInt(m, 10))?.[0] ?? '';
  return [
    iso,
    `${parseInt(d, 10)} ${monthName} ${iso.split('-')[0]}`,
    `${parseInt(d, 10)} ${monthName}`,
  ];
}

// ─── Time ────────────────────────────────────────────────────────────────────

/**
 * Parsa klockslag till HH:MM (24-timmars) eller null.
 *
 * Accepterar:
 *   "19:00"     → 19:00
 *   "19.00"     → 19:00
 *   "kl 19"     → 19:00
 *   "klockan 7" → 07:00
 *   "07:30"     → 07:30
 */
export function parseClockTime(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // HH:MM eller H:MM
  const colonMatch = lower.match(/(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1], 10);
    const m = parseInt(colonMatch[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  // HH.MM (europeisk punktnotation)
  const dotMatch = lower.match(/(\d{1,2})\.(\d{2})/);
  if (dotMatch) {
    const h = parseInt(dotMatch[1], 10);
    const m = parseInt(dotMatch[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  // "kl H" eller "klockan H"
  const klMatch = lower.match(/(?:kl(?:ockan)?\.?\s+)(\d{1,2})(?:\.(\d{1,2}))?/);
  if (klMatch) {
    const h = parseInt(klMatch[1], 10);
    const m = klMatch[2] ? parseInt(klMatch[2], 10) : 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Returnera normaliserade former av ett klockslag.
 */
export function timeNormalForms(text: string): string[] {
  const norm = parseClockTime(text);
  if (!norm) return [];
  const [h, m] = norm.split(':');
  const forms = new Set<string>();
  forms.add(norm);
  forms.add(`${parseInt(h, 10)}:${m}`);
  forms.add(`${parseInt(h, 10)}.${m}`);
  forms.add(`kl ${parseInt(h, 10)}`);
  return Array.from(forms);
}

// ─── Price ───────────────────────────────────────────────────────────────────

/**
 * Parsa pris-sträng till belopp i SEK (kr) eller null.
 *
 * Accepterar:
 *   "250 kr"     → 250
 *   "250:-"      → 250
 *   "250 kronor" → 250
 *   "250 SEK"    → 250
 *   "från 250 kr" → 250
 *   "250 kr/person" → 250
 */
export function parsePriceToSek(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // Fånga första siffran
  const match = lower.match(/(\d{1,6}(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const num = parseFloat(match[1].replace(',', '.'));
  if (num < 0 || num > 1_000_000) return null;
  return Math.round(num);
}

/**
 * Returnera normaliserade former av ett pris.
 */
export function priceNormalForms(text: string): string[] {
  const sek = parsePriceToSek(text);
  if (sek == null) return [];
  return [
    `${sek} kr`,
    `${sek} kronor`,
    `${sek}:-`,
    `${sek} SEK`,
    `från ${sek} kr`,
  ];
}

// ─── Age ─────────────────────────────────────────────────────────────────────

/**
 * Parsa åldersgräns till min_age (eller null).
 *
 * Accepterar:
 *   "18 år"        → 18
 *   "från 18 år"   → 18
 *   "18+"          → 18
 *   "åldersgräns 18" → 18
 */
export function parseAgeLimit(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();
  // "18 år" / "från 18 år" / "18+"
  const withArMatch = lower.match(/(\d{1,2})\s*(?:\+|\s*år)/);
  if (withArMatch) {
    const age = parseInt(withArMatch[1], 10);
    if (age >= 0 && age <= 99) return age;
  }
  // "åldersgräns 18" / "åldersgräns: 18" / "från 18"
  const prefixMatch = lower.match(/(?:åldersgräns|minimiålder|min[\s-]?ålder|ålder[\s:]+)\s*(\d{1,2})/);
  if (prefixMatch) {
    const age = parseInt(prefixMatch[1], 10);
    if (age >= 0 && age <= 99) return age;
  }
  return null;
}

export function ageNormalForms(text: string): string[] {
  const age = parseAgeLimit(text);
  if (age == null) return [];
  return [
    `${age} år`,
    `från ${age} år`,
    `${age}+`,
    `åldersgräns ${age}`,
  ];
}

// ─── Name normalization ──────────────────────────────────────────────────────

/**
 * Normalisera ett namn: ta bort accenter, gemener, försök splita på prefix.
 *
 * "Ludwig van Beethoven" → "ludwig van beethoven", "beethoven"
 * "L. v. Beethoven"      → "l v beethoven", "beethoven"
 * "J.S. Bach"           → "j s bach", "bach"
 */
export function normalizeName(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase().trim();
  const forms = new Set<string>();
  forms.add(lower);
  // Ta bort accenter
  const noAccent = lower
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  forms.add(noAccent);
  // Sista ordet (ofta efternamn)
  const parts = lower.split(/\s+/);
  if (parts.length > 1) {
    forms.add(parts[parts.length - 1]);
    forms.add(parts[0]);
  }
  return Array.from(forms);
}

// ─── Number with unit ───────────────────────────────────────────────────────

/**
 * Plocka ut numeriskt värde med enhet.
 *
 * "95 musiker" → { value: 95, unit: "musiker" }
 * "120 personer" → { value: 120, unit: "personer" }
 */
export function parseNumberWithUnit(text: string): { value: number; unit: string } | null {
  if (!text) return null;
  const match = text.match(/(\d{1,6}(?:[.,]\d{1,2})?)\s*([a-zåäö]+)/i);
  if (!match) return null;
  const value = parseFloat(match[1].replace(',', '.'));
  if (value < 0 || value > 1_000_000) return null;
  return { value: Math.round(value), unit: match[2].toLowerCase() };
}

/**
 * Returnera normaliserade former av "N enhet".
 */
export function numberUnitNormalForms(text: string): string[] {
  const parsed = parseNumberWithUnit(text);
  if (!parsed) return [];
  const { value, unit } = parsed;
  const forms = new Set<string>();
  forms.add(`${value} ${unit}`);
  forms.add(`${value}-${unit}`); // "95-manna orkester"
  forms.add(`${value}${unit}`); // "95manna"
  return Array.from(forms);
}

// ─── Universal normalize for evidence-base ──────────────────────────────────

/**
 * Generera ALLA normaliserade former av ett värde (för evidence base).
 * Används när vi bygger evidence base för att se till att alla format
 * av samma fakta blir "stödda".
 */
export function allNormalForms(text: string, kind?: 'duration' | 'date' | 'time' | 'price' | 'age' | 'name' | 'number'): string[] {
  const forms = new Set<string>();
  forms.add(text.toLowerCase().trim());

  if (kind === 'duration' || !kind) {
    for (const f of durationNormalForms(text)) forms.add(f);
  }
  if (kind === 'date' || !kind) {
    for (const f of dateNormalForms(text)) forms.add(f);
  }
  if (kind === 'time' || !kind) {
    for (const f of timeNormalForms(text)) forms.add(f);
  }
  if (kind === 'price' || !kind) {
    for (const f of priceNormalForms(text)) forms.add(f);
  }
  if (kind === 'age' || !kind) {
    for (const f of ageNormalForms(text)) forms.add(f);
  }
  if (kind === 'name' || !kind) {
    for (const f of normalizeName(text)) forms.add(f);
  }
  if (kind === 'number' || !kind) {
    for (const f of numberUnitNormalForms(text)) forms.add(f);
  }

  return Array.from(forms).filter((f) => f.length >= 2);
}
