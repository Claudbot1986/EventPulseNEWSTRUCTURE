#!/usr/bin/env node
/**
 * set-source-url.mjs — peka om en källa till en ny URL.
 *
 * Bakgrund (2026-10-24). En del källor har en URL som slutat fungera:
 *   - billetto-stockholm: URL:en kom från "description-URL mining" och är
 *     en 404 (/en/search/stockholm). Billettos riktiga listning är
 *     /c/stockholm-l — vilket också är den URL-pattern befintlig
 *     billettoStockholm-adapter är byggd för.
 *   - momentsapp-stockholm: URL:en är datumlåst (/kalender/2026-10-04) och
 *     ger bara events från den dagen.
 *
 * Skriptet använder sourceRegistry.updateSourceUrl() — samma kodväg som
 * scB-404-recovery.ts — och verifierar den nya URL:en INNAN den skrivs.
 * Skriver ingen databasrad.
 *
 * Användning:
 *   npx tsx scripts/set-source-url.mjs <sourceId> <newUrl> [--yes]
 *
 *   --yes   hoppa över bekräftelse av den nya URL:en (testkörning)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const skipVerify = args.includes('--yes');
const positional = args.filter((a) => !a.startsWith('--'));

if (positional.length !== 2) {
  console.error('usage: npx tsx scripts/set-source-url.mjs <sourceId> <newUrl> [--yes]');
  process.exit(1);
}

const [sourceId, newUrl] = positional;

const { getSource, updateSourceUrl } = await import(
  path.join(ROOT, '02-Ingestion/tools/sourceRegistry.ts')
);

const source = getSource(sourceId);
if (!source) {
  console.error(`fel: källan "${sourceId}" finns inte i sources/`);
  process.exit(1);
}

console.log(`källa:  ${sourceId}`);
console.log(`gamla:  ${source.url}`);
console.log(`nya:    ${newUrl}`);

if (!skipVerify) {
  let status = 0;
  let finalUrl = newUrl;
  let bytes = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(newUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });
    clearTimeout(timer);
    status = res.status;
    finalUrl = res.url;
    const body = await res.text();
    bytes = body.length;
  } catch (err) {
    console.error(`fel: kunde inte hämta ${newUrl} — ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  console.log(`kontroll: http=${status} bytes=${bytes} final=${finalUrl}`);
  if (status === 404 || status === 410) {
    console.error('fel: nya URL:en svarar 404/410 — skrev inte.');
    process.exit(1);
  }
  if (status >= 400) {
    console.error('varning: nya URL:en svarar fel. Fortsätter ändå (kan vara bot-vägg).');
  }
}

const ok = updateSourceUrl(sourceId, newUrl);
if (!ok) {
  console.error('fel: updateSourceUrl misslyckades');
  process.exit(1);
}
console.log(`OK: ${sourceId} pekar nu på ${newUrl}`);
