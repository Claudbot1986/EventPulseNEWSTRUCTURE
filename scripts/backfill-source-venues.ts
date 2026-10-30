#!/usr/bin/env node
/**
 * backfill-source-venues.ts — backfill källspecifika platsnamn på befintliga
 * event-rader.
 *
 * ROTSAK (2026-10-30): "Upploppet" syndes två gånger i Utforska (livespot
 * "Kulturhuset Stadsteatern" + kulturhuset "Husby"). kulturhusets API
 * skriver OMRÅDET i tixVenue[].label, inte salnamnet — så samma föreställning
 * fick två olika platsnamn och matchade aldrig.
 *
 * Regeln ligger i 02-Ingestion/lib/sourceVenueRules.ts och appliceras
 * nugränt vid persistensgränsen (normalizern) för framtida ingestion.
 * Det här skriptet gör samma sak för de rader som redan finns.
 *
 * Kör:  npx tsx scripts/backfill-source-venues.ts [--dry]
 *
 * Efteråt: kör `npx tsx scripts/audit-duplicates.ts --apply` — den slår ihop
 * det som blevi dubbletter när platsnamnen rättades.
 */

import 'dotenv/config';
import { Client } from 'pg';
import { SOURCE_VENUE_RULES, VENUE_NAME_ALIASES } from '../02-Ingestion/lib/sourceVenueRules';

const dry = process.argv.includes('--dry');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set in .env');
  const db = new Client({ connectionString: url });
  await db.connect();

  try {
    let totalUpdated = 0;

    for (const [source, rule] of Object.entries(SOURCE_VENUE_RULES)) {
      // 1. Hitta eller skapa den kanoniska venue-raden.
      const { rows: existing } = await db.query(
        `SELECT id, name FROM venues WHERE lower(name) = lower($1) LIMIT 1`,
        [rule.canonicalVenue],
      );
      let venueId: string;
      if (existing.length > 0) {
        venueId = existing[0].id;
      } else {
        if (dry) {
          console.log(`[backfill] ${source}: venue "${rule.canonicalVenue}" saknas — skapas (${dry ? 'dry' : 'live'})`);
          continue;
        }
        const created = await db.query(
          `INSERT INTO venues (name, address, lat, lng, location)
           VALUES ($1, '', 59.3293, 18.0686, 'POINT(18.0686 59.3293)')
           RETURNING id`,
          [rule.canonicalVenue],
        );
        venueId = created.rows[0].id;
        console.log(`[backfill] ${source}: skapade venue "${rule.canonicalVenue}" (${venueId})`);
      }

      // 2. Räkta rader som har fel platsnamn.
      const { rows: affected } = await db.query(
        `SELECT id, venue_full_name FROM events
          WHERE source = $1 AND status = 'published'
            AND (venue_id IS DISTINCT FROM $2::uuid
                 OR venue_full_name IS DISTINCT FROM $3)`,
        [source, venueId, rule.canonicalVenue],
      );

      if (affected.length === 0) {
        console.log(`[backfill] ${source}: inga rader att rätta`);
        continue;
      }

      if (!dry) {
        await db.query(
          `UPDATE events SET venue_id = $2, venue_full_name = $3 WHERE source = $1`,
          [source, venueId, rule.canonicalVenue],
        );
      }
      totalUpdated += affected.length;
      console.log(
        `[backfill] ${source}: rättade ${affected.length} rad(er) → "${rule.canonicalVenue}" ` +
          `(tidigare: ${[...new Set(affected.map((r) => r.venue_full_name ?? 'NULL'))].slice(0, 6).join(', ')})`,
      );
    }

    // ── Granskade plats-alias på befintliga rader ────────────────────────
    for (const [from, to] of VENUE_NAME_ALIASES) {
      const { rows: aliased } = await db.query(
        // Endast rader som faktiskt har det alias-namnet. (Får INTE
        // ta med NULL-raderna — 2026-10-30: en tidigare version av den här
        // frågan hade "OR venue_full_name IS NULL" och döpte om 1 789
        // rader med saknad plats till fel lokal.)
        `SELECT id FROM events
          WHERE status = 'published'
            AND venue_full_name = $1`,
        [from],
      );
      if (aliased.length === 0) continue;
      if (!dry) {
        await db.query(
          `UPDATE events SET venue_full_name = $2 WHERE id = ANY($1::uuid[])`,
          [aliased.map((r) => r.id), to],
        );
      }
      totalUpdated += aliased.length;
      console.log(`[backfill] alias: ${aliased.length} rad(er) "${from}" → "${to}"`);
    }

    console.log('');
    console.log(
      dry
        ? `[backfill] DRY RUN — ${totalUpdated} rad(er) skulle rättas.`
        : `[backfill] ${totalUpdated} rad(er) rättade. Kör nu: npx tsx scripts/audit-duplicates.ts --apply`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error('[backfill] FEL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
