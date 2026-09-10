/**
 * scripts/cron/runSmoke.test.ts
 *
 * Smoke wrapper tests (2026-09-10): verifierar att runSmoke.sh finns,
 * är executable, och anropar rätt kommandon.
 *
 * Run: npx vitest run scripts/cron/runSmoke.test.ts
 */

import { describe, test, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT = path.resolve(__dirname, 'runSmoke.sh');

describe('runSmoke.sh', () => {
  test('filen finns', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  test('filen är executable', () => {
    const st = statSync(SCRIPT);
    // S_OK om minst en execute-bit är satt (ägar + grupp + andra)
    const mode = st.mode;
    const isExec = (mode & 0o111) !== 0;
    expect(isExec).toBe(true);
  });

  test('innehåller --smoke flagga', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('--smoke');
  });

  test('innehåller log-skapande', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('runtime/logs');
  });

  test('använder npx tsx för att köra cron-skriptet', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('ingestion-cron.ts');
    expect(content).toContain('npx tsx');
  });

  test('skriver summary-fil med exit_code', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('summary');
    expect(content).toContain('exit_code');
  });
});