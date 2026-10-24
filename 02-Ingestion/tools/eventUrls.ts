/**
 * eventUrls — en värd/venue kan ha flera event-sidor.
 *
 * Bakgrund (2026-10-24). `SourceTruth` bär EN url per fil. När discovery
 * promotade en kandidat vars domän redan fanns som källa skapades därför en
 * NY fil `candidate-<hash>-<slug>.jsonl` per kandidat. Resultat:
 *
 *   - 25 extra källfiler för 9 värdar (operan.se: 9, modernamuseet: 5 …)
 *   - 67 DB-rader med `source = candidate-*` — samma evenemang, flera namn
 *     ("Lunchkonserter med Kungliga Operan" under 5 olika source-namn)
 *   - varje kandidat kördes genom hela C-gaten var för sig, och C0 hittade
 *     samma värdnivå-vinnare för dem alla (t.ex. /jobba-hos-oss på operan.se)
 *
 * Lösningen: kandidaten blir en EXTRA EVENT-SIDA på värdkällan, inte en egen
 * källa. `metadata.eventUrls` är listan. C-gaten extraherar varje URL för sig
 * och slår ihop resultaten med huvudkörningen.
 *
 * Detta är INGEN ny heuristik — ingen scoring-vikt ändras, ingen
 * IGNORE_PATTERN, ingen URL-token-logik. Det är bara hur en källas URLer
 * lagras.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const DATA_ROOT = process.env.EVENTPULSE_SANDBOX_ROOT
  ? path.resolve(process.env.EVENTPULSE_SANDBOX_ROOT)
  : PROJECT_ROOT;
const SOURCES_DIR = path.resolve(DATA_ROOT, 'sources');

/** Metadata-nyckeln som håller event-sidorna. */
export const EVENT_URLS_KEY = 'eventUrls';

/** Kanonisk form: https, ingen www, ingen avslutande slash. */
export function canonicalEventUrl(url: string): string {
  const parsed = new URL(url.trim());
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  parsed.hash = '';
  if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

interface SourceFile {
  id?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

function readSourceFile(sourceId: string): SourceFile | null {
  const file = path.join(SOURCES_DIR, `${sourceId}.jsonl`);
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, 'utf8').trim();
    if (!text) return null;
    return JSON.parse(text) as SourceFile;
  } catch {
    return null;
  }
}

/** Läser `metadata.eventUrls` för en källa. Alltid en array. */
export function readEventUrls(source: SourceFile | null): string[] {
  const raw = source?.metadata?.[EVENT_URLS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
}

/** Läser `metadata.eventUrls` direkt från registret. */
export function getEventUrls(sourceId: string): string[] {
  return readEventUrls(readSourceFile(sourceId));
}

/**
 * Lägger en event-sida på källan. Returnerar true om listan ändrades.
 *
 * Skriver EN RAD (radbaserade läsare parsar bara första raden — se
 * scripts/verify-source-file-format.ts).
 */
export function attachEventUrl(sourceId: string, url: string): boolean {
  return attachEventUrlToSourceFile(path.join(SOURCES_DIR, `${sourceId}.jsonl`), url);
}

/**
 * Samma som attachEventUrl men mot en explicit sökväg — discovery arbetar
 * med sitt eget `root` och ska inte vara bundet till registrets DATA_ROOT.
 */
export function attachEventUrlToSourceFile(file: string, url: string): boolean {
  if (!existsSync(file)) return false;

  let source: SourceFile;
  try {
    const text = readFileSync(file, 'utf8').trim();
    if (!text) return false;
    source = JSON.parse(text) as SourceFile;
  } catch {
    return false;
  }

  let canonical: string;
  try {
    canonical = canonicalEventUrl(url);
  } catch {
    return false;
  }

  const existing = readEventUrls(source);
  // Källans egen url är inte en "extra" event-sida.
  let ownCanonical: string | null = null;
  try {
    ownCanonical = canonicalEventUrl(String(source.url ?? ''));
  } catch {
    ownCanonical = null;
  }
  if (canonical === ownCanonical) return false;
  if (existing.some((u) => {
    try {
      return canonicalEventUrl(u) === canonical;
    } catch {
      return u === canonical;
    }
  })) {
    return false;
  }

  const metadata = { ...(source.metadata ?? {}) };
  metadata[EVENT_URLS_KEY] = [...existing, url.trim()];
  const updated: SourceFile = { ...source, metadata };

  writeFileSync(file, `${JSON.stringify(updated)}\n`, 'utf8');
  return true;
}
