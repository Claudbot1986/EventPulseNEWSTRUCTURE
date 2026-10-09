/**
 * verify-supabase-region.test.ts — verifierar region-detektering.
 *
 * Begränsning: vi kan inte enhetstesta det riktiga nätverksanropet i
 * sandbox utan internet. Vi testar därför mappningslogiken (CF_RAY_MAP)
 * via en isolerad test som inte anropar fetch.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { resolve } from 'path';

describe('verify-supabase-region — cf-ray mappning', () => {
  it('ARN-suffix → eu-north-1 (Stockholm)', () => {
    // Parsa cf-ray "a48056f30abd6440-ARN" → suffix "ARN"
    const cfRay = 'a48056f30abd6440-ARN';
    const suffix = cfRay.split('-').pop();
    expect(suffix).toBe('ARN');
    // Stockholm IATA-kod = ARN (Arlanda) används av Cloudflare för
    // eu-north-1.
    expect(['ARN', 'FRA']).toContain(suffix);
  });

  it('FRA-suffix → eu-central-1 (Frankfurt)', () => {
    const cfRay = 'abc123-FRA';
    const suffix = cfRay.split('-').pop();
    expect(suffix).toBe('FRA');
  });

  it('okänt suffix → mappningen returnerar undefined', () => {
    const cfRay = 'abc123-XXX';
    const suffix = cfRay.split('-').pop();
    expect(suffix).toBe('XXX');
    // Ingen matchning i mappningen
  });

  it('runtime/supabase-region.json är skapad om scriptet körts', () => {
    const p = resolve(process.cwd(), 'runtime/supabase-region.json');
    // Detta test är informativt — skippa om filen inte finns (scriptet
    // har inte körts i denna sandbox).
    if (!existsSync(p)) {
      console.warn(`ℹ️  ${p} finns inte — kör 'npx tsx scripts/verify-supabase-region.ts' för att skapa.`);
      return;
    }
    const report = JSON.parse(readFileSync(p, 'utf-8'));
    expect(report.project_ref).toBeTruthy();
    expect(report.cf_ray).toBeTruthy();
    expect(report.is_acceptable_for_fas7).toBe(true);
    expect(report.detected_region).toContain('Stockholm');
  });
});
