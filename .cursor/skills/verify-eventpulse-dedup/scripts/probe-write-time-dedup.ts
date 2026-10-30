/**
 * probe-write-time-dedup.ts — bevisa att INGESTION inte lägger in dubbletter.
 *
 * TEST-ENDA ENTRÉ (aldrig en "klara"-verktyg). Körs av
 * `.cursor/skills/verify-eventpulse-dedup`.
 *
 * SÅ HÄR FUNGERAR DET
 *
 *   1. Proben ÄGER sina rader. Den skapar en "föregångare"-rad med en
 *      egen source (`verify-dedup-probe`) och en identitetsnyckel som
 *      räknas med samma modul som normalizern använder. Sedan kör den
 *      den RIKTIGA normalizern (processRawEvent) på samma evenemang
 *      men med en ANNAN source och en ANNAN ticket_url.
 *
 *      Det är exakt MAFFIA-situationen: samma evenemang, listat av två
 *      olika källor som använder olika url:er. Den gamla kodsökvägen
 *      (dedup_hash = sha256(source::source_id) och ticket_url) kan INTE
 *      fånga den — källan ingår i hashen, och url:erna skiljer sig.
 *
 *   2. Kontrollera att INGEN ny rad skapades — att raden med samma
 *      identitetsnyckel fortfarande är en och samma rad.
 *
 *   3. Städa: båda prob-raderna raderas.
 *
 * VARFÖR PROBEN INTE SKRIVER PÅ EN RIKTIG RAD
 *
 *   Tidigare version skrev på en riktig event-rad och försökte återställa
 *   den efteråt. Det var riskabelt: normalizerns update-väg skriver
 *   bland annat `image_url = null` och `ticket_url` (probens egen url),
 *   och de kolumnerna fanns inte i återställningslistan. Dessutom fanns
 *   det bara EN publicerad rad i hela databasen utan AI-bild, så
 *   urvalet "utan bild" blev tomt.
 *
 *   Nu äger proben sina egna rader: en riktig event-rad rörs aldrig.
 *   Platsen är fortfarande en riktig venue-rad, så normalizern skapar
 *   ingen ny plats (inga skräp-rader i venues).
 *
 * SIDOEFFEKTER OCH HUR DE UNDVIKS
 *
 * - Bildpipelinen stängs av i processen (`AI_IMAGE_PIPELINE_ENABLED=0`)
 *   innan normalizern importeras. Annars skulle proben köa en riktig
 *   AI-bildjobb.
 * - Proben raderar sina egna rader i ett `finally`-block, även om
 *   normalizern kastar.
 * - Om normalizern skulle skapa en ny venue-rad städas den bort.
 *
 * Förutsättningar: `.env` med `DATABASE_URL`, `SUPABASE_URL`,
 * `SUPABASE_SERVICE_ROLE_KEY` och en nåbar Redis (normalizern importerar
 * kön). Redis används bara för att läsa, proben skriver inga jobb.
 *
 * Kör:  npx tsx .cursor/skills/verify-eventpulse-dedup/scripts/probe-write-time-dedup.ts
 */

// Bildpipelinen ska inte köas av proben. Sätts FÖR normalizern importeras.
process.env.AI_IMAGE_PIPELINE_ENABLED = '0';

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import type { Job } from 'bullmq';
import type { RawEventInput } from '../../../../packages/shared/src/types/ingestion';

const PROBE_SOURCE = 'verify-dedup-probe';
const PROBE_SOURCE_SECOND = 'verify-dedup-probe-second';

interface ProbeVenue {
  id: string;
  name: string;
  address: string | null;
  name_rows: number;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set in .env');
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!process.env[key]) throw new Error(`${key} saknas i .env`);
  }
  const db = new Client({ connectionString: url });
  await db.connect();

  const knownVenueIds = new Set<string>();

  const { crossSourceIdentity, normalizeIdentityTitle } = await import(
    '../../../../04-Normalizer/deduplication/crossSourceIdentity'
  );
  const { canonicalVenueName } = await import('../../../../02-Ingestion/lib/sourceVenueRules');

  try {
    // ── 0. Snapshot av venue-ids (för städning) ───────────────────────────
    const { rows: venueIdsBefore } = await db.query('SELECT id FROM venues');
    for (const v of venueIdsBefore as Array<{ id: string }>) knownVenueIds.add(v.id);

    // ── 1. Välj en riktig venue-rad ──────────────────────────────────────
    // Krav: namnet är unikt (annars kan normalizern matcha en annan rad
    // med samma namn), det är INTE ett alias-nyckelnamn (annars
    // kanoniseras namnet och normalizern letar upp en annan venue-rad),
    // och det normaliserar till en användbar text (t.ex. inte "???").
    const { rows: venueRows } = await db.query<ProbeVenue>(
      `SELECT v.id, v.name, v.address,
              (SELECT count(*)::int FROM venues v2 WHERE lower(v2.name) = lower(v.name)) AS name_rows
         FROM venues v
        WHERE v.name IS NOT NULL AND trim(v.name) <> '' AND length(v.name) > 2
        ORDER BY (SELECT count(*)::int FROM venues v2 WHERE lower(v2.name) = lower(v.name)), v.name
        LIMIT 500`,
    );
    const venue = venueRows.find(
      (v) =>
        v.name_rows === 1 &&
        canonicalVenueName(v.name) === null &&
        normalizeIdentityTitle(v.name).length > 2 &&
        /[a-zåäö]/i.test(normalizeIdentityTitle(v.name)),
    );
    if (!venue) {
      throw new Error(
        'Ingen lämplig venue-rad hittades (krav: unikt namn, inget alias-namn, användbart namn)',
      );
    }
    console.log(`[probe] plats: "${venue.name}" (${venue.id})`);

    // ── 2. Bygg ett eget, entydigt evenemang ─────────────────────────────
    // Titeln får INTE innehålla "test event"/"sample event" m.m. — det
    // är placeholder-fraser som normalizerns title-gate avvisar.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const title = `PROBE write-time dedup ${stamp}`;
    const startIso = new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString();

    // Identitetsnyckeln räknas med SAMMA modul som normalizern använder,
    // så läs- och skrivväg kan inte glida isär.
    const identity = crossSourceIdentity({
      title,
      startTime: startIso,
      venueId: venue.id,
      venueName: venue.name,
    });
    if (!identity) throw new Error('Kunde inte räkna fram identitetsnyckeln');
    console.log(`[probe] identitetsnyckel: ${identity}`);

    // ── 3. Skapa "föregångare"-raden (proben äger den) ────────────────────
    const copyUrl = `https://probe.invalid/copy/${stamp}`;
    const copyHash = createHash('sha256').update(`${PROBE_SOURCE}::${stamp}`).digest('hex');
    const { rows: inserted } = await db.query<{ id: string }>(
      `INSERT INTO events (
         title_sv, title_en, description_sv, description_en, start_time, end_time,
         venue_id, venue_full_name, venue_full_address, venue_city, lat, lng,
         category_slug, is_free, status, link_status, event_identity,
         dedup_hash, ticket_url, source, source_id
       ) VALUES (
         $1, $2, NULL, NULL, $3, NULL,
         $4, $5, $6, NULL, NULL, NULL,
         'music', false, 'published', 'live', $7,
         $8, $9, $10, NULL
       ) RETURNING id`,
      [
        title,
        title,
        startIso,
        venue.id,
        venue.name,
        venue.address,
        identity,
        copyHash,
        copyUrl,
        PROBE_SOURCE,
      ],
    );
    const copyId = inserted[0].id;
    console.log(`[probe] föregångare-rad: ${copyId} (source=${PROBE_SOURCE})`);
    const { rows: copyAfterInsert } = await db.query<{ updated_at: Date }>(
      `SELECT updated_at FROM events WHERE id = $1`,
      [copyId],
    );
    const updatedAtBefore = copyAfterInsert[0]?.updated_at ?? null;

    // ── 4. Kör den riktiga normalizern med en ANNAN källa och url ────────
    const raw: RawEventInput = {
      title,
      description: null,
      start_time: startIso,
      end_time: null,
      venue_name: venue.name,
      venue_address: venue.address,
      lat: null,
      lng: null,
      categories: ['music'],
      is_free: false,
      price_min_sek: null,
      price_max_sek: null,
      // ANNAN url än föregångarens — annars fångar den gamla
      // ticket_url-vägen proben och bevisar ingenting om den nya vägen.
      ticket_url: `https://probe.invalid/input/${stamp}`,
      image_url: null,
      source: PROBE_SOURCE_SECOND,
      source_id: null,
      detected_language: 'sv',
      raw_payload: { probe: true, predecessorId: copyId },
      status_expanded: null,
    } as unknown as RawEventInput;

    const { processRawEvent } = await import('../../../../04-Normalizer/normalizer');
    let error: string | null = null;
    try {
      await processRawEvent({ data: raw } as unknown as Job<RawEventInput>);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (error) console.error(`[probe] normalizern kastade: ${error}`);

    // ── 5. Verifiera ─────────────────────────────────────────────────────
    // (a) Ingen INSERT: ingen rad fick den andra källan.
    const { rows: createdRows } = await db.query<{ id: string }>(
      `SELECT id FROM events WHERE source = $1`,
      [PROBE_SOURCE_SECOND],
    );
    // (b) Fortfarande EN rad med identitetsnyckeln.
    const { rows: identityRows } = await db.query<{ id: string }>(
      `SELECT id FROM events
        WHERE event_identity = $1 AND status='published' AND merged_into IS NULL`,
      [identity],
    );
    // (c) Föregångarraden uppdaterades (UPDATE-vägen kördes).
    const { rows: updatedRows } = await db.query<{ updated_at: Date }>(
      `SELECT updated_at FROM events WHERE id = $1`,
      [copyId],
    );

    const created = createdRows.map((r) => r.id);
    const withIdentity = identityRows.map((r) => r.id);
    const updated = updatedRows[0]?.updated_at ?? null;
    const wasUpdated =
      updated !== null &&
      updatedAtBefore !== null &&
      updated.getTime() > updatedAtBefore.getTime();

    // PROBEN FÅR INTE PASSA OM NORMALIZERN KASTADE. Utan detta vikande
    // skulle proben "bevisa" att ingen dubblett lades in just för att
    // normalizern dog innan den skrev något — 2026-10-30 hände exakt det
    // (ReferenceError: venueId is not defined i normalizer.ts) och proben
    // rapporterade ändå OK.
    const ok =
      error === null &&
      created.length === 0 &&
      withIdentity.length === 1 &&
      wasUpdated;

    console.log('');
    console.log(`[probe] rader med samma identitetsnyckel: ${withIdentity.length}`);
    console.log(`[probe] rader skapade av proben: ${created.length}`);
    console.log(
      wasUpdated
        ? `[probe] föregångarraden uppdaterades: ${updated!.toISOString()}`
        : '[probe] föregångarraden uppdaterades: NEJ — update-vägen kördes inte',
    );
    if (error) {
      console.error(`[probe] normalizern kastade: ${error}`);
    }
    console.log(
      ok
        ? '[probe] OK — ingestion lade inte in någon dubblett'
        : '[probe] FAIL — dubblett lades in, eller normalizern kördes inte klart',
    );

    if (!ok && created.length > 0) {
      console.error(
        `[probe] diagnos: nyckeln på den nya raden var "${createdRows[0].id}" — ` +
          'jämför med den förväntade nyckeln ovan.',
      );
    }

    if (!ok) process.exitCode = 1;
  } finally {
    // ── 6. Städa — alltid, även om normalizern kastade ───────────────────
    await db.query(`DELETE FROM events WHERE source = ANY($1::text[])`, [
      [PROBE_SOURCE, PROBE_SOURCE_SECOND],
    ]);
    const { rows: venueIdsAfter } = await db.query('SELECT id FROM venues');
    const newVenues = venueIdsAfter
      .map((v: { id: string }) => v.id)
      .filter((id: string) => !knownVenueIds.has(id));
    if (newVenues.length > 0) {
      await db.query('DELETE FROM venues WHERE id = ANY($1::uuid[])', [newVenues]);
      console.log(`[probe] städade bort ${newVenues.length} nyskapade venue-rad(er)`);
    }
    const { rows: leftover } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM events WHERE source = ANY($1::text[])`,
      [[PROBE_SOURCE, PROBE_SOURCE_SECOND]],
    );
    console.log(`[probe] kvarvarande probe-rader: ${leftover[0].n}`);
    await db.end();
  }
}

main()
  .then(() => {
    // Normalizern importerar kön, som håller en Redis-anslutning öppen.
    // Utan explicit exit skulle eventloopen aldrig avslutas och gaten
    // skulle h hanga fast i evigheter.
    process.exit(process.exitCode ?? 0);
  })
  .catch((err: unknown) => {
    console.error('[probe] FEL:', err instanceof Error ? err.message : err);
    process.exit(2);
  });
