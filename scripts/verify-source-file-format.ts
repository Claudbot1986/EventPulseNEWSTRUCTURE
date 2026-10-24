#!/usr/bin/env node
/**
 * verify-source-file-format.ts — bevis för att sources/*.jsonl är JSONL.
 *
 * Bakgrund (2026-10-24). `sources/*.jsonl` är "en källa per fil, ett
 * JSON-objekt per rad". Flera läsare parsar bara första raden:
 *
 *   scripts/probe-fail-sources.mjs
 *   scripts/probe-c0-candidates.mjs
 *   scripts/probe-root-fallback.mjs
 *   scripts/verify-c0-root-fallback.mjs
 *
 * `sourceRegistry.updateSourceMetadata()` och `updateSourceUrl()` skrev
 * pretty-printad JSON (`JSON.stringify(x, null, 2)`). De fem källor som
 * fick en metadata-uppdatering blev DÄRÖR OSYNLIGA för radbaserade
 * läsare — tyst, utan fel. RF1-gaten sa "källan billetto-stockholm
 * finns inte i sources/" fast källan var där.
 *
 * Skrivaren i 07-Discovery/src/sourceTesting/sandbox.ts har alltid
 * skrivit en rad. Registret var alltså od exceptionen.
 *
 * Gates:
 *   sf1 — registry skriver EN RAD (mäts i en sandbox, inte i produktion),
 *         och ingen befintlig källfil är flerradig.
 *         Negativ kontroll: detektorn MÅSTE underkänna en flerradig fil.
 *
 * Användning: npx tsx scripts/verify-source-file-format.ts sf1
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'sources');
const arg = process.argv[2];

function ok(msg: string) { console.log(msg); }
function fail(msg: string) { console.error(msg); process.exit(1); }

/**
 * Vad är fel med en källfil? Returnerar null om filen är korrekt.
 *
 * Ren funktion så att negativ kontroll kan köra samma kodväg mot en
 * medvetet trasig text.
 */
export function sourceFileProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'filen är tom';
  if (trimmed.includes('\n')) return 'filen har fler än en rad';
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return 'filen är inte ett JSON-objekt';
    if (!parsed.id) return 'JSON-objektet saknar "id"';
    return null;
  } catch {
    return 'filen är inte giltig JSON';
  }
}

// ── SF1: registry skriver en rad + ingen flerradig källfil finns ───────────

if (arg === 'sf1') {
  // ── Negativ kontroll först: detektorn MÅSTE kunna underkänna trasiga filer.
  const badCases: Array<[string, string]> = [
    ['{\n  "id": "x"\n}\n', 'flerradig fil'],
    ['{ "id": "x", }', 'ogiltig JSON'],
    ['{"namn": "x"}', 'saknar id'],
    ['   \n', 'tom fil'],
  ];
  for (const [text, label] of badCases) {
    if (sourceFileProblem(text) === null) {
      fail(`sf1: negativ kontroll — en ${label} accepteras (detektorn kan inte faila)`);
    }
  }
  if (sourceFileProblem('{"id":"x","url":"https://example.com"}') !== null) {
    fail('sf1: positiv kontroll — en korrekt enradig källfil underkänns (detektorn mäter fel sak)');
  }

  // ── Mätning 1: registry skriver EN RAD. Sandbox, inte produktion.
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'ep-srcfmt-'));
  mkdirSync(path.join(sandbox, 'sources'), { recursive: true });
  writeFileSync(
    path.join(sandbox, 'sources', 'sf1-probe.jsonl'),
    JSON.stringify({ id: 'sf1-probe', url: 'https://example.com', name: 'Probe' }) + '\n',
    'utf8',
  );

  let registry: typeof import('../02-Ingestion/tools/sourceRegistry.js');
  try {
    // Miljövariabeln måste sättas FÖRE importen — registret läser den
    // vid moduluppstart för att räkna ut var SOURCES_DIR ligger.
    process.env.EVENTPULSE_SANDBOX_ROOT = sandbox;
    registry = await import('../02-Ingestion/tools/sourceRegistry.js');

    const changed = registry.updateSourceMetadata('sf1-probe', {
      preferredPath: 'render',
      metadata: { categoryUrls: ['https://example.com/c/1'] },
    });
    if (!changed) fail('sf1: registry kunde inte uppdatera källan i sandboxen — mätningen mäter ingenting');

    const written = readFileSync(path.join(sandbox, 'sources', 'sf1-probe.jsonl'), 'utf8');
    const problem = sourceFileProblem(written);
    if (problem !== null) {
      fail(`sf1: registry skrev en trasig källfil (${problem}) — radbaserade läsare ser inte källan`);
    }
    if (!written.includes('"categoryUrls"') || !written.includes('"preferredPath":"render"')) {
      fail('sf1: registry skrev inte metadata — mätningen mäter ingenting');
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  // ── Mätning 2: ingen befintlig källfil är flerradig.
  if (!existsSync(SOURCES_DIR)) fail('sf1: sources/ saknas — mätningen mäter ingenting');
  const files = readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.jsonl'));
  const broken: string[] = [];
  for (const f of files) {
    const problem = sourceFileProblem(readFileSync(path.join(SOURCES_DIR, f), 'utf8'));
    if (problem !== null) broken.push(`${f} (${problem})`);
  }
  if (broken.length > 0) {
    fail(
      `sf1: ${broken.length}/${files.length} källfiler är inte giltig enradig JSON — ` +
        `de är osynliga för radbaserade läsare: ${broken.join(', ')}`,
    );
  }

  ok(
    `sf1: registry skriver en rad och alla ${files.length} källfiler i sources/ är giltig ` +
      'enradig JSON; negativ kontroll: flerradig/ogiltig/tom fil underkänns pass',
  );
}

if (arg !== 'sf1') {
  fail('usage: npx tsx scripts/verify-source-file-format.ts sf1');
}
