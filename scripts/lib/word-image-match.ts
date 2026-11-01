/**
 * scripts/lib/word-image-match.ts — DELAD matchningslogik för ordbilder.
 *
 * Används av generatorn, tilldelningen och gaten så att de aldrig kan
 * glida isär i vad som räknas som "samma ord".
 *
 * ── Varför inte suffixmatchning? ──────────────────────────────────────────
 *
 * En tidigare version matchade med "tokenet SLUTAR med nyckeln" för att
 * fånga sammansatta ord ("dambastu" innehåller "bastu"). Men det ger
 * 922 FALSA träffar i det riktiga korpuset:
 *
 *   "Ludwig Hart"        → "hart" slutar med "art"   → konstbild på en konsert
 *   "Svart Samtid"       → "svart" slutar med "art"  → konstbild på en konsert
 *   "Digitalt Forum"     → "digitalt" slutar med "alt"
 *   "Tennis"             → "tennis" slutar med "is"  → isbana på en tennismatch
 *
 * Suffixen är alltså ingen Morphologisk regel — den är bara ett rimligt
 * gissningsheuristik som går sönder för korta ord.
 *
 * ── Lösningen: ordlistan är facit ────────────────────────────────────────
 *
 * Ord-inventeringen innehåller ALLA ord som förekommer i eventtitlarna, med
 * sin stam. Den vet redan vilka ord som är sammansatta och med vad:
 *   "bastun"  → stam "bastu"  → bildnyckel "bastu"     (bestämd form)
 *   "dambastu" → stam "bastu" → bildnyckel "dambastu" (modifier + stam)
 *
 * Alltså: dela titeln i TOKENS och slå upp varje token i ordlistan. En
 * token som inte finns i ordlistan matchar ingenting. Ingen gissning.
 */

import { createHash } from 'node:crypto';

/** Bestända former som är samma sak som stammen. */
const INFL = ['n', 'en', 'ar', 'er', 'or', 'et', 's', 'na', 'orna', 'arna'];

/**
 * Bildnyckel för ett ord: "bastun" → "bastu" (bestämd form),
 * "dambastu" → "dambastu" (modifier + stam → egen bild).
 */
export function imageKey(word: string, stem: string): string {
  const w = word.toLowerCase();
  const s = stem.toLowerCase();
  if (!s || s === w) return w;
  if (w.startsWith(s)) {
    const rest = w.slice(s.length);
    if (INFL.includes(rest)) return s;      // bestämd form -> samma sak
  }
  return w;                                  // modifier + stam -> egen bild
}

/** En rad i ord-inventeringen. */
export interface InventoryRow {
  ord: string;
  stam?: string;
  antal_titlar?: string;
  antal_events?: string;
}

/** Ord → bildnyckel. */
export type WordIndex = Map<string, string>;

/**
 * Bygger indexet: varje ord i inventeringen → dess bildnyckel.
 * Flera ordformer kan peka på samma nyckel ("bastu" och "bastun" → "bastu").
 */
export function buildWordIndex(rows: InventoryRow[]): WordIndex {
  const index: WordIndex = new Map();
  for (const r of rows) {
    const ord = (r.ord ?? '').trim().toLowerCase();
    if (!ord) continue;
    const key = imageKey(ord, (r.stam ?? '').trim());
    // Flera ordformer pekar på samma nyckel ("bastu" och "bastun" → "bastu").
    // Det är avsett — de ska dela bild.
    index.set(ord, key);
  }
  return index;
}

/** Delar en titel i tokens (gemenerade, diacritiska bevarade). */
export function tokenizeTitle(s: string): string[] {
  return s.toLowerCase()
    .split(/[^a-z0-9åäöéüæøèáàíóúñç]+/i)
    .filter(Boolean);
}

/**
 * Vilka bildnycklar som en titel berör?
 *
 * Endast ord som finns i ordlistan räknas — därav inga falsa suffixträffar.
 */
export function matchKeysInTitle(title: string, index: WordIndex): Set<string> {
  const keys = new Set<string>();
  for (const token of tokenizeTitle(title)) {
    const key = index.get(token);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Ordformer som ska matcha samma bild (nyckel + ordform).
 *
 * Används för att hitta en bild för ett ord INTE finns i ordlistan (t.ex.
 * en ny titel som kom in efter att inventeringen gjordes). Här används
 * EXAKT matchning — aldrig suffix.
 */
export function matchForms(key: string, ord?: string): string[] {
  return [...new Set(
    [key, ord]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .map((s) => s.toLowerCase()),
  )];
}

/**
 * Ordning mellan flera ordträffar i SAMMA titel.
 *
 * 1. Längsta bildnyckeln vinner — den är mest specifika ("dambastu" slår
 *    "bastu").
 * 2. Lika långa nycklar: alfabetiskt först. Utan denna tie-break blev
 *    resultatet beroende av filordningen i biblioteksmappen — 85 av 5 874
 *    event fick olika bild beroende på vilken väg som kördes först.
 *
 * Ordningen är deterministisk och används BÅDE av tilldelningen
 * (`scripts/word_image_assign.ts`) och av ingestion
 * (`08-Agent/utils/wordImageBank.ts`), så de kan inte glida isär.
 */
export function compareWordHits(a: { key: string }, b: { key: string }): number {
  const byLength = b.key.length - a.key.length;
  if (byLength !== 0) return byLength;
  // KODPUNKTjämförelse, inte localeCompare: localeCompare är språkberoende
  // ("öva" sorteras före "tal" i svensk locale men efter i en-US) — det gav
  // olika bilder beroende på maskinens språkinställning.
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

/**
 * Filnamn för en ordbild i Supabase Storage.
 *
 * ── Varför inte ordet rakt av? ─────────────────────────────────────────────
 * Supabase Storage avvisar icke-ASCII-tecken i objektnycklar:
 *   "Invalid key: import-stamped/word/handarbetscafé__086.webp"
 * 212 av 896 biblioteksbilder har å/ä/ö/é i nyckeln och skulle aldrig
 * laddas upp. Percent-encoding hjälper inte heller — Storage avkodar
 * nyckeln innan den valideras ("probe_caf%C3%A9" → "probe_café" → FEL).
 *
 * Lösningen är ASCII + en kort hash av originalnyckeln:
 *   "handarbetscafé" → "handarbetscafe--3f2a1b9c.webp"
 *
 * Hashen är nödvändig, inte kosmetik: ASCII-vikningen slår ihop ord som
 * skiljer sig bara på diakritik ("cafe"/"café", "spoken"/"spöken",
 * "jubileumsturnè"/"jubileumsturné"). Utan hash skulle deras bilder skriva
 * över varandra i storage.
 */
export function storageSafeName(key: string): string {
  const ascii = key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // ta bort kombinationstecken
    .replace(/[^a-z0-9]+/g, '-')      // allt annat → bindestreck
    .replace(/^-+|-+$/g, '') || 'word';
  const hash = createHash('sha1').update(key.toLowerCase()).digest('hex').slice(0, 8);
  return `${ascii}--${hash}`;
}

/** Fullt filnamn (med ändelse) för en ordbild i storage. */
export function storageFileName(key: string): string {
  return `${storageSafeName(key)}.webp`;
}
