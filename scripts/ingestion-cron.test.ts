/**
 * scripts/ingestion-cron.test.ts
 *
 * Smoke wiring tests (2026-09-10): verifierar att --smoke-flaggan i
 * scripts/ingestion-cron.ts propagerar korrekt till ALLA steg som har
 * smoke-specifika argument (D-renderGate, D-images, P3A, P3B, P3C, etc).
 *
 * Detta är en "file content"-test — vi verifierar att den rätta koden finns
 * på rätt plats. Det är inte ett funktionstest av CLI-flagg-parsning
 * (process.argv-test skulle kräva refactor av cron-skriptet till en
 * exporterbar modul, vilket är scope-creep för smoke-läget).
 *
 * Run: npx vitest run scripts/ingestion-cron.test.ts
 */

import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CRON = path.resolve(__dirname, 'ingestion-cron.ts');

describe('ingestion-cron.ts --smoke wiring', () => {
  test('filen finns', () => {
    expect(existsSync(CRON)).toBe(true);
  });

  test('parsar --smoke flaggan', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain('args.includes(\'--smoke\')');
  });

  test('effectiveLimit sätts till 1 i smoke', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain('effectiveLimit = smoke ? 1 : limit');
  });

  test('effectiveDBehavior sätts till static-only i smoke', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain('effectiveDBehavior = smoke ? \'static-only\' : \'premium-only\'');
  });

  test('D-images skickar skipBflFallback=true i smoke', () => {
    const content = readFileSync(CRON, 'utf8');
    // Kontrakt utökat i a1c03a9: SKIP_BFL=1/--skip-bfl tvingar bibliotek-
    // fallback även utanför smoke (BFL-kreditkris 2026-09-05). Smoke ska
    // alltid skippa BFL:  smoke || skipBfl.
    expect(content).toContain('skipBflFallback: ${smoke || skipBfl}');
  });

  test('D-images stödjer SKIP_BFL=1/--skip-bfl override', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain("process.env.SKIP_BFL === '1' || args.includes('--skip-bfl')");
  });

  test('P3A-discovery använder --queries 1 --per-query 1 i smoke', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain('smoke ? \'1\' : \'10\'');
  });

  test('P3B-venue-graph-geo använder --limit 5 i smoke', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain('smoke ? \'5\' : \'50\'');
  });

  test('P3C-rss-discovery lägger till --dry-run i smoke', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain('...(smoke ? [\'--dry-run\'] : [])');
  });

  test('I-pdfExtraction sänker concurrency till 1 i smoke', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain('concurrency\', smoke ? \'1\' : \'3\'');
  });

  test('C-htmlGate sänker max-rounds till 5 i smoke', () => {
    const content = readFileSync(CRON, 'utf8');
    expect(content).toContain('smoke ? \'5\' : \'50\'');
  });
});