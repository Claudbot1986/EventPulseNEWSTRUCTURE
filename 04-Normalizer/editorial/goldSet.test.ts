/**
 * goldSet.test.ts — FAS 10 regression-tester (2026-10-09).
 *
 * Syfte: regression-testa extractEntities + buildEventProfile mot en
 * hand-curated gold-set av 25 events. Detta är det första
 * deterministiska testet som ENBART beror på kända ground-truth-värden,
 * inte på M3 LLM eller live-network.
 *
 * Varje entry verifierar:
 *   - expected_performer_count: antal performers i Profile
 *   - expected_performers: exakt vilka performers (set-equals)
 *   - expected_gazetteer_hits: vilka performers som ska ha metadata
 *   - expected_info_level: hur mycket Profile har
 *
 * När någon ändrar i entityExtractor / eventUnderstanding / gazetteerCache
 * och får en regression på något av dessa 25 events → testet failar →
 * man ser exakt vilken event det gäller och vilken rad som ändrades.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { extractEntities } from './entityExtractor';
import { buildEventProfile, profileInfoLevel } from './eventUnderstanding';
import { lookupArtists } from './gazetteerCache';
import type { EventProfile } from './types';

interface GoldEntry {
  id: string;
  title: string;
  category_slug: string;
  venue_name: string | null;
  city: string | null;
  expected_performers: string[];
  expected_performer_count: number;
  expected_gazetteer_hits: string[];
  expected_info_level: 'RICH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  note: string;
}

function loadGoldSet(): GoldEntry[] {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const path = resolve(__dirname, '../data/goldSetFas10.jsonl');
  const raw = readFileSync(path, 'utf-8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as GoldEntry);
}

const GOLD = loadGoldSet();

/**
 * Kör extractEntities + buildEventProfile mot en gold-entry.
 * Returnerar Profile.performers + per-performer gazetteer-data.
 */
function runPipeline(gold: GoldEntry): {
  performers: string[];
  profile: EventProfile;
  gazetteerHits: string[];
} {
  // 1. extractEntities (FAS 2.5/2.6)
  const entities = extractEntities({
    title: gold.title,
    raw_description: null,
    category_slug: gold.category_slug,
    venue_name: gold.venue_name,
  });
  const PERFORMER_ROLES = new Set([
    'artist', 'ensemble', 'band', 'performer', 'comedian',
    'conductor', 'soloist', 'speaker', 'dj', 'team',
  ]);
  const fromEntities = entities
    .filter((e) => PERFORMER_ROLES.has(e.role))
    .map((e) => e.name);

  // 2. buildEventProfile (FAS 3) — kombinerar performers + performer_metadata
  const profile = buildEventProfile({
    title: gold.title,
    raw_description: null,
    category_slug: gold.category_slug,
    venue_name: gold.venue_name ?? null,
    city: gold.city ?? null,
    source: 'gold-set-fas10',
    performers: fromEntities,
  });

  // 3. Gazeteer-hits (FAS 3.1)
  const lookups = lookupArtists(profile.performers);
  const gazetteerHits = Object.entries(lookups)
    .filter(([_, entry]) => entry !== null)
    .map(([name]) => name);

  return { performers: profile.performers, profile, gazetteerHits };
}

describe('Gold set FAS 10 — entity extraction & profile regression', () => {
  // Pre-load: fånga laddningsfel tidigt.
  beforeAll(() => {
    expect(GOLD.length).toBeGreaterThanOrEqual(20);
  });

  describe('set-level invariants', () => {
    it('innehåller minst 20 hand-curated events', () => {
      expect(GOLD.length).toBeGreaterThanOrEqual(20);
    });

    it('alla ids är unika', () => {
      const ids = new Set(GOLD.map((g) => g.id));
      expect(ids.size).toBe(GOLD.length);
    });

    it('expected_performer_count stämmer med expected_performers.length', () => {
      for (const g of GOLD) {
        expect(g.expected_performer_count, `${g.id}: count mismatch`).toBe(
          g.expected_performers.length,
        );
      }
    });
  });

  describe('per-event assertions', () => {
    for (const gold of GOLD) {
      it(`${gold.id} — "${gold.title.slice(0, 50)}${gold.title.length > 50 ? '…' : ''}"`, () => {
        const { performers, profile, gazetteerHits } = runPipeline(gold);

        // 1. Exakt antal performers
        expect(performers.length, `${gold.id}: performer count`).toBe(
          gold.expected_performer_count,
        );

        // 2. Set-equals på performers (order-oberoende)
        const got = new Set(performers);
        const want = new Set(gold.expected_performers);
        for (const w of want) {
          expect(got.has(w), `${gold.id}: missing performer "${w}"`).toBe(true);
        }
        for (const g of got) {
          if (want.has(g)) continue;
          // Tillåt extra performers BARA om de är kända false-positives —
          // t.ex. 'Veronica Maggio' dyker inte upp här, men om det finns
          // extra performers i framtiden bör testet uppdateras medvetet.
          throw new Error(
            `${gold.id}: unexpected performer "${g}" (not in expected_performers=${[...want].join(', ')})`,
          );
        }

        // 3. Gazetteer-hits
        const gotHits = new Set(gazetteerHits);
        for (const h of gold.expected_gazetteer_hits) {
          expect(gotHits.has(h), `${gold.id}: expected gazetteer hit "${h}"`).toBe(true);
        }

        // 4. Info-level är minst det förväntade (mjuk assertion — Profile
        // kan ha mer info än gold förutspår, men inte mindre).
        const got_il = profileInfoLevel(profile);
        const order = { VERY_LOW: 0, LOW: 1, MEDIUM: 2, RICH: 3 };
        expect(
          order[got_il],
          `${gold.id}: info_level=${got_il} (expected≥${gold.expected_info_level})`,
        ).toBeGreaterThanOrEqual(order[gold.expected_info_level]);
      });
    }
  });

  describe('regression-skydd: specifika kända fall', () => {
    it('Quidam har exakt 6 performers (multi-performer-title)', () => {
      const q = GOLD.find((g) => g.id === 'gold-001')!;
      const { performers } = runPipeline(q);
      expect(performers).toHaveLength(6);
      expect(performers.sort()).toEqual(
        ['Eva Lindal', 'Helene Berg', 'Ida Lundén', 'Paul Pignon', 'Philippe Moenne-Loccoz', 'Thomas Bjelkeborn'].sort(),
      );
    });

    it('Donovan Woods har country=CA i performer_metadata', () => {
      const d = GOLD.find((g) => g.id === 'gold-003')!;
      const { profile } = runPipeline(d);
      expect(profile.performer_metadata?.['Donovan Woods']?.country).toBe('CA');
      expect(profile.performer_metadata?.['Donovan Woods']?.genres).toContain('folk');
    });

    it('Radiokören har type=Choir i performer_metadata (gold-005)', () => {
      const r = GOLD.find((g) => g.id === 'gold-005')!;
      const { profile } = runPipeline(r);
      expect(profile.performer_metadata?.['Radiokören']?.type).toBe('Choir');
    });

    it('Peter Dijkstra har country=NL i performer_metadata (gold-005)', () => {
      const r = GOLD.find((g) => g.id === 'gold-005')!;
      const { profile } = runPipeline(r);
      expect(profile.performer_metadata?.['Peter Dijkstra']?.country).toBe('NL');
    });

    it('Anton Estby + Henrythefreak båda har gazetteer-hits (gold-004)', () => {
      const a = GOLD.find((g) => g.id === 'gold-004')!;
      const { gazetteerHits } = runPipeline(a);
      expect(gazetteerHits).toContain('Anton Estby');
      expect(gazetteerHits).toContain('Henrythefreak');
    });

    it('Chicago - the Musical: 0 performers (work-titel)', () => {
      const c = GOLD.find((g) => g.id === 'gold-012')!;
      const { performers } = runPipeline(c);
      expect(performers).toHaveLength(0);
    });

    it('KÄRLEK ÖVER TANGER: 0 performers (Tanger är stad, inte artist)', () => {
      const k = GOLD.find((g) => g.id === 'gold-014')!;
      const { performers } = runPipeline(k);
      expect(performers).toHaveLength(0);
    });

    it('AIK - BIK Karlskoga: 2 teams, BIK inte feltolkas till en plats', () => {
      const a = GOLD.find((g) => g.id === 'gold-011')!;
      const { performers } = runPipeline(a);
      // Förväntar AIK + BIK Karlskoga (eventuellt 'BIK' ensamt är OK,
      // 'Karlskoga' ensamt är INTE OK).
      expect(performers.length).toBeGreaterThanOrEqual(1);
      expect(performers.some((p) => p.includes('AIK'))).toBe(true);
      // 'Karlskoga' ensamt får inte finnas (skulle vara en plats, inte ett lag)
      expect(performers.some((p) => p === 'Karlskoga')).toBe(false);
      // 'BIK' ensamt ELLER 'BIK Karlskoga' ska finnas
      const hasBik = performers.some((p) => /^BIK(\s|$)/.test(p));
      expect(hasBik, 'BIK eller BIK Karlskoga måste finnas').toBe(true);
    });
  });

  describe('determinism', () => {
    it('Quidam (gold-001) → identiskt output 2x', () => {
      const q = GOLD.find((g) => g.id === 'gold-001')!;
      const r1 = runPipeline(q);
      const r2 = runPipeline(q);
      expect(r1.performers).toEqual(r2.performers);
      expect(r1.gazetteerHits).toEqual(r2.gazetteerHits);
    });

    it('Lars Jansson Quartet (gold-017) → identiskt output 2x', () => {
      const q = GOLD.find((g) => g.id === 'gold-017')!;
      const r1 = runPipeline(q);
      const r2 = runPipeline(q);
      expect(r1.performers).toEqual(r2.performers);
    });
  });
});
