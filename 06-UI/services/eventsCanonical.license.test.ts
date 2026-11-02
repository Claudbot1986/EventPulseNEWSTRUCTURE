/**
 * 06-UI/services/eventsCanonical.license.test.ts
 *
 * Regressionstest för licensgrinden på den "döda" kanoniska läsvägen.
 *
 * Bakgrund (2026-11-02): `eventsCanonical.js`/`.cjs` läser BAS-TABELLEN
 * `events`, inte vyn `events_public`. Vyns CASE WHEN-filter
 * (description_license → description_sv/en) gäller därför INTE här.
 * Utan egen gate kringgick vägen rättighetsregeln: källans råa
 * beskrivningstext kunde synas i appen trots `description_license='unknown'`.
 *
 * Beslutet (T0201, 2026-10-05): UI:t får ALDRIG visa rå källtext utan att
 * licensen är tillåtande.
 */

import { describe, it, expect } from 'vitest';

// @ts-expect-error — CJS-mirror utan TS-typer
import { transformEvent } from './eventsCanonical.cjs';

const RAW = 'RÅ KÄLLTEXT som inte får visas i appen.';

function row(license: string | null) {
  return {
    id: 'test-id',
    source: 'some-source',
    title_sv: 'Testevenemang',
    description_sv: RAW,
    description_en: null,
    description_license: license,
    start_time: '2026-11-01T18:00:00Z',
    venue_id: null,
    venues: null,
    category_slug: 'music',
  };
}

describe('eventsCanonical — licensgrind på bas-tabellen', () => {
  it('blockerar råtext när licensen är unknown', () => {
    expect(transformEvent(row('unknown')).description).toBe('');
  });

  it('blockerar råtext när licensen saknas (null)', () => {
    expect(transformEvent(row(null)).description).toBe('');
  });

  it('blockerar råtext när licensen är okänd/upptäckt', () => {
    expect(transformEvent(row('some-future-license')).description).toBe('');
  });

  it.each([
    'pressbild',
    'copyright-with-attribution',
    'partner-licensed',
    'public-domain',
  ])('släpper igenom råtext när licensen är %s', (license) => {
    expect(transformEvent(row(license)).description).toBe(RAW);
  });

  it('läser description_license i select-listan', () => {
    // Om fältet inte vore med i EVENT_SELECT skulle description_license
    // alltid vara undefined → råtext alltid blockerad. SELECT-strängen
    // kontrolleras här så att en tillåtande licens faktiskt kan passera.
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, 'eventsCanonical.cjs'),
      'utf8',
    );
    expect(src).toMatch(/EVENT_SELECT\s*=\s*\n?\s*'[^']*description_license/);
  });
});
