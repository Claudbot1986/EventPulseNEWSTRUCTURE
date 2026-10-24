/**
 * readSourceFile.mjs — läs en källfil i sources/ utan att gissa format.
 *
 * Bakgrund (2026-10-24). `sources/*.jsonl` är JSONL: en källa per fil,
 * ett JSON-objekt per rad. Registret (`sourceRegistry.updateSourceMetadata`)
 * skrev under en period pretty-printad JSON, vilket gjorde de berörda
 * källorna osynliga för läsare som bara parsar första raden — tyst, utan
 * fel. Se `scripts/verify-source-file-format.ts` (gate sf1).
 *
 * Den här läsaren tolererar båda formaten, så att en framtida skrivare
 * inte kan återföra felet tyst. Formatet är alltså inte längre beroende
 * av att ALLA skrivare följer samma regel — men skrivarna gör det nu,
 * eftersom sf1 mäter det.
 *
 * @param {string} filePath  sökväg till källfilen
 * @returns {Record<string, any> | null}  källan, eller null om filen
 *   saknas, är tom eller inte går att tolka
 */
import { readFileSync } from 'node:fs';

/**
 * Tolka källfilens innehåll. Ren funktion — testar den gärna.
 * @param {string} raw
 * @returns {Record<string, any> | null}
 */
export function parseSourceText(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  // 1. Hela filen som ett JSON-dokument (pretty-printat).
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.id) return parsed;
  } catch {
    // 2. första raden som JSONL-rad.
  }

  // 2. Första raden (JSONL-format).
  const firstLine = trimmed.split('\n')[0].trim();
  if (!firstLine) return null;
  try {
    const parsed = JSON.parse(firstLine);
    if (parsed && typeof parsed === 'object' && parsed.id) return parsed;
  } catch {
    // 3. sista utväg: dela på "},{" om filen råkar ha flera objekt.
  }

  // 3. Flera objekt i samma fil (onödigt men möjligt).
  const objects = [];
  for (const chunk of trimmed.split(/\n(?=\{)/)) {
    const c = chunk.trim().replace(/,$/, '');
    if (!c) continue;
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object' && parsed.id) objects.push(parsed);
    } catch {
      // ignorera
    }
  }
  return objects.length === 1 ? objects[0] : null;
}

/**
 * @param {string} filePath
 * @returns {Record<string, any> | null}
 */
export function readSourceFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  return parseSourceText(raw);
}
