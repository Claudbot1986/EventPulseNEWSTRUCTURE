/**
 * migrate-canonical-urls.ts
 *
 * Reparationsmigrering av befintliga sources/*.jsonl så att alla canonical URLs
 * följer exakt samma regler som 00A-ImportRawSources-Tool nu använder.
 *
 * Regler (direkt från 00A):
 * 1. normalizeToCanonicalUrl():
 *    - Preserve: http:// eller https:// (case-insensitive)
 *    - Strip: www. prefix
 *    - Lowercase: host
 *    - Strip: trailing slash
 *    - Ensure: root path = /
 *
 * 2. isValidUrl(): new URL() constructor + http/https check
 *
 * 3. hasValidProtocol(): explicit ^https?:\/\//i match
 *
 * ANVÄNDNING:
 *   npx tsx 00-Sources/00A-ImportRawSources-Tool/migrate-canonical-urls.ts [--dry-run]
 *
 * Backup görs före alla ändringar.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── EXAKT SAMMA FUNKTIONER SOM 00A — kopierade för att garantera identitet ───
// Denna kod är IDENTISK med import-raw-sources.ts normalizeToCanonicalUrl() och
// normalizeToSiteIdentityKey() — inga egna regler får införas här.

/**
 * Normalize to site-level identity key.
 * (Identisk med 00A normalizeToSiteIdentityKey)
 */
function normalizeToSiteIdentityKey(rawUrl: string): string {
  let url = rawUrl.trim();
  url = url.replace(/^https?:\/\//i, '');
  url = url.replace(/^www\./i, '');
  const slashIndex = url.indexOf('/');
  url = slashIndex >= 0 ? url.substring(0, slashIndex) : url;
  return url.toLowerCase();
}

/**
 * Normalize to canonical URL for display purposes.
 * (Identisk med 00A normalizeToCanonicalUrl)
 * Regler:
 * 1. Extract and preserve protocol (http:// or https://)
 * 2. Strip www.
 * 3. Lowercase host
 * 4. Strip trailing slash
 * 5. Ensure root path = /
 */
function normalizeToCanonicalUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  const protocolMatch = url.match(/^(https?:\/\/)/i);
  const protocol = protocolMatch ? protocolMatch[1].toLowerCase() : 'https://';
  url = url.replace(/^https?:\/\//i, '');
  url = url.replace(/^www\./i, '');
  url = url.toLowerCase();
  url = url.replace(/\/$/, '');
  if (!url.includes('/')) {
    url = url + '/';
  }
  return protocol + url;
}

// ─── URL-validerngsfunktioner (kopierade från 00A för att garantera identitet) ─

function hasValidProtocol(url: string): boolean {
  return url.match(/^https?:\/\//i) !== null;
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Source-gränssnitt ────────────────────────────────────────────────────────

interface CanonicalSource {
  id: string;
  url: string;
  name: string;
  city: string;
  type: string;
  preferredPath: string | null;
  discoveredAt: string;
  discoveredBy: string | null;
  [key: string]: unknown;
}

// ─── Analysera en URL ────────────────────────────────────────────────────────

interface UrlAnalysis {
  rawUrl: string;
  currentCanonical: string;
  expectedCanonical: string;
  isValid: boolean;
  hasProtocol: boolean;
  needsRepair: boolean;
  repairError?: string;
}

function analyzeUrl(url: string): UrlAnalysis {
  const currentCanonical = url.trim();
  let expectedCanonical = '';
  let isValid = false;
  let hasProtocol = false;
  let needsRepair = false;
  let repairError: string | undefined;

  // Check protocol
  hasProtocol = hasValidProtocol(currentCanonical);

  // Check if URL is valid
  if (hasProtocol) {
    isValid = isValidUrl(currentCanonical);
  } else {
    isValid = false;
  }

  // Compute expected canonical
  if (hasProtocol && isValid) {
    expectedCanonical = normalizeToCanonicalUrl(currentCanonical);
    needsRepair = expectedCanonical !== currentCanonical;
  } else {
    // Cannot repair — invalid URL without proper protocol
    needsRepair = false;
    repairError = hasProtocol
      ? `URL is invalid despite having protocol: ${currentCanonical}`
      : `URL missing http/https protocol: ${currentCanonical}`;
  }

  return {
    rawUrl: currentCanonical,
    currentCanonical,
    expectedCanonical,
    isValid,
    hasProtocol,
    needsRepair,
    repairError,
  };
}

// ─── Huvudlogik ─────────────────────────────────────────────────────────────

interface MigrationResult {
  sourceId: string;
  file: string;
  status: 'ok' | 'repaired' | 'invalid_skip' | 'error';
  analysis: UrlAnalysis;
  newUrl?: string;
  error?: string;
}

function migrateSources(dryRun: boolean): {
  results: MigrationResult[];
  stats: {
    total: number;
    alreadyCorrect: number;
    repaired: number;
    invalidSkipped: number;
    errors: number;
  };
} {
  const sourcesDir = path.join(process.cwd(), 'sources');
  const files = fs.readdirSync(sourcesDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort();

  const results: MigrationResult[] = [];
  let alreadyCorrect = 0;
  let repaired = 0;
  let invalidSkipped = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(sourcesDir, file);
    const sourceId = file.replace(/\.jsonl$/, '');

    try {
      const content = fs.readFileSync(filePath, 'utf-8');

      if (!content.trim()) {
        results.push({
          sourceId,
          file,
          status: 'error',
          analysis: {
            rawUrl: '',
            currentCanonical: '',
            expectedCanonical: '',
            isValid: false,
            hasProtocol: false,
            needsRepair: false,
            repairError: 'Empty file',
          },
          error: 'Empty file',
        });
        errors++;
        continue;
      }

      const source = JSON.parse(content) as CanonicalSource;
      const url = source.url;

      const analysis = analyzeUrl(url);

      if (!analysis.isValid || !analysis.hasProtocol) {
        results.push({
          sourceId,
          file,
          status: 'invalid_skip',
          analysis,
        });
        invalidSkipped++;
        continue;
      }

      if (!analysis.needsRepair) {
        results.push({
          sourceId,
          file,
          status: 'ok',
          analysis,
        });
        alreadyCorrect++;
        continue;
      }

      // Needs repair
      if (dryRun) {
        results.push({
          sourceId,
          file,
          status: 'repaired',
          analysis,
          newUrl: analysis.expectedCanonical,
        });
        repaired++;
      } else {
        // Apply repair — PRESERVE original file format by only replacing the URL value
        // Match the "url": "..." line exactly (preserving indentation)
        // The URL value in JSON must be JSON-escaped for the replacement
        const escapedNewUrl = analysis.expectedCanonical
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        // Find the "url": "value" or "url": "value", line and replace just the value
        // This regex captures indentation (leading whitespace) and the trailing part
        const urlLineRegex = /^(\s*)"url":\s*"(?:[^"\\]|\\.)*"(,?)\s*$/gm;
        const newContent = content.replace(urlLineRegex, (_match, indent, comma) => {
          return `${indent}"url": "${escapedNewUrl}"${comma}`;
        });

        if (newContent === content) {
          // Fallback: content didn't change — try simpler regex
          const simpleUrlRegex = /("url":\s*")[^"]*(")/;
          const fallbackContent = content.replace(simpleUrlRegex, `$1${escapedNewUrl}$2`);
          fs.writeFileSync(filePath, fallbackContent, 'utf-8');
        } else {
          fs.writeFileSync(filePath, newContent, 'utf-8');
        }
        results.push({
          sourceId,
          file,
          status: 'repaired',
          analysis,
          newUrl: analysis.expectedCanonical,
        });
        repaired++;
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        sourceId,
        file,
        status: 'error',
        analysis: {
          rawUrl: '',
          currentCanonical: '',
          expectedCanonical: '',
          isValid: false,
          hasProtocol: false,
          needsRepair: false,
          repairError: errorMsg,
        },
        error: errorMsg,
      });
      errors++;
    }
  }

  return {
    results,
    stats: {
      total: files.length,
      alreadyCorrect,
      repaired,
      invalidSkipped,
      errors,
    },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const mode = dryRun ? 'DRY-RUN' : 'APPLY';

  console.log(`\n=== 00A Canonical URL Migration (${mode}) ===\n`);

  if (dryRun) {
    console.log('DRY-RUN mode — inga filer skrivs. Använd --apply för att skriva.\n');
  }

  const { results, stats } = migrateSources(dryRun);

  console.log('=== Resultat ===');
  console.log(`  Totalt source-filer:      ${stats.total}`);
  console.log(`  Redan korrekta:          ${stats.alreadyCorrect}`);
  console.log(`  Reparationer:            ${stats.repaired}`);
  console.log(`  Invalid/överhoppade:     ${stats.invalidSkipped}`);
  console.log(`  Fel:                    ${stats.errors}\n`);

  // Visa reparationsfall
  const repaired = results.filter(r => r.status === 'repaired');
  if (repaired.length > 0) {
    console.log(`=== Reparationer (${repaired.length}) ===`);
    for (const r of repaired) {
      console.log(`  ${r.sourceId}:`);
      console.log(`    före: ${r.analysis.currentCanonical}`);
      console.log(`    efter: ${r.newUrl}`);
    }
    console.log();
  }

  // Visa invalid/överhoppade
  const skipped = results.filter(r => r.status === 'invalid_skip');
  if (skipped.length > 0) {
    console.log(`=== Överhoppade/invalid (${skipped.length}) ===`);
    for (const r of skipped) {
      console.log(`  ${r.sourceId}: ${r.analysis.repairError ?? 'invalid URL'}`);
      console.log(`    url: ${r.analysis.rawUrl}`);
    }
    console.log();
  }

  // Visa fel
  const errored = results.filter(r => r.status === 'error');
  if (errored.length > 0) {
    console.log(`=== Fel (${errored.length}) ===`);
    for (const r of errored) {
      console.log(`  ${r.sourceId}: ${r.error}`);
    }
    console.log();
  }

  // Skriv resultat till fil
  const reportPath = `runtime/canonical-url-migration-report.jsonl`;
  const reportLines = results.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(reportPath, reportLines, 'utf-8');
  console.log(`Resultatrapport: ${reportPath}`);

  // Skriv CSV-sammanfattning
  const csvPath = `runtime/canonical-url-migration-summary.csv`;
  const csvLines = [
    'sourceId,file,status,currentUrl,expectedUrl,repairError',
    ...results.map(r =>
      `"${r.sourceId}","${r.file}","${r.status}","${r.analysis.currentCanonical}","${r.newUrl ?? r.analysis.expectedCanonical}","${r.analysis.repairError ?? ''}"`
    ),
  ].join('\n');
  fs.writeFileSync(csvPath, csvLines, 'utf-8');
  console.log(`CSV-sammanfattning: ${csvPath}\n`);

  if (dryRun) {
    console.log('DRY-RUN klart. Kör med --apply för att utföra reparationerna.');
  } else {
    console.log(`Klart! ${stats.repaired} filer reparerade.`);
  }
}

main();
