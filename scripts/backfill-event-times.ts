/**
 * backfill-event-times — rätta eventtimes som lagrades som LOKAL tid.
 *
 * ROTSAK (2026-10-30). Två ingestionsvägar skrev tiden olika:
 *
 *   F-gate-vägen   (adaptrar → normalizer → DB) lagrar ett korrekt
 *                  UTC-instant: "President" 19:30 lokal → 18:30Z.
 *   Kö-vägen       (C/D-gatens extraherade filer → importToEventPulse)
 *                  behandlade `date`+`time` som UTC: "President" 19:30
 *                  lokal → 19:30Z.
 *
 * Följden: appen visade kvällsevenemang 1–2 timmar för sent, och — det
 * som triggade hela uppdraget — samma evenemang från två vägar fick
 * olika identitetsnyckel och syndes som två kort i Utforska.
 *
 * Det här skriptet rättar de rader som bevisligen kom via kö-vägen.
 *
 * VARFÖR ENDA VERIFIERADE RADER RÄTTAS
 *
 * Beviset kommer från de extraherade filerna själva
 * (`03-Queue/03-extractedevents/**`): där står den lokala tiden som
 * källan skrev den. En rad vars DB-värde har SAMMA UTC-klocka som den
 * lokala tiden i filen har lagrats som lokal tid → den ska skiftas.
 *
 * En rad vars DB-värde redan är UTC (skillnaden är 60/120 min = zons-
 * skillnaden) lämnas orörd. Rader utan matchning i någon fil lämnas
 * också orörda — de är antingen redan rätt eller går inte att bevisa.
 *
 * SKIFTET
 *
 *   (start_time AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Stockholm'
 *
 * Först tas UTC-klockan fram som en "naiv" väggtid (= den lokala tiden
 * som lagrades fel), sedan tolkas den som Stockholms lokal tid och
 * omvandlas till ett korrekt UTC-instant. Postgres tidszonsregler
 * hanterar DST (CEST +02:00 sommar, CET +01:00 vinter).
 *
 * ANVÄNDNING
 *   npx tsx scripts/backfill-event-times.ts --dry     # bara rapport
 *   npx tsx scripts/backfill-event-times.ts --apply   # utför + backup
 */

import 'dotenv/config';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

interface Args {
  apply: boolean;
  json?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--dry') args.apply = false;
    else if (a === '--json') args.json = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

/** 'YYYY-MM-DDTHH:MM' → 'YYYY-MM-DDTHH:MM:SS' (jämförbar tidsstämpel). */
function normStamp(value: string): string {
  const s = value.trim();
  return s.length === 16 ? `${s}:00` : s;
}

/** Alla extraherade filer i köerna (C/D/A/B + legacy på rotnivå). */
function queueFiles(): string[] {
  const base = '03-Queue/03-extractedevents';
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(base);
  return out;
}

interface QueueRow {
  date?: string;
  time?: string;
  url?: string;
  source?: string;
  title?: string;
  endDate?: string;
  endTime?: string;
}

/**
 * Källans egen SLUTTID som en lokal väggtid ("YYYY-MM-DDTHH:MM").
 *
 * Samma logik som importens `extractEndTime`:
 *   - slutdatum utan sluttid → slutet av dagen (23:59:59)
 *   - slutklockslag FÖRE startklockan → sluttiden ligger på följande dag
 *
 * Returnerar null när filen inte ger någon sluttid.
 */
function localEndStamp(r: QueueRow): string | null {
  const endDay = (r.endDate ?? '').trim() || (r.date ?? '').trim();
  if (!endDay) return null;
  const endClock = (r.endTime ?? '').trim();
  if (!endClock) return `${endDay}T23:59:59`;
  const startClock = (r.time ?? '').trim();
  if (startClock && endClock < startClock) {
    // Midnattspassage — sluttiden hamnar på nästa dag.
    const d = new Date(`${endDay}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    const next = d.toISOString().slice(0, 10);
    return `${next}T${endClock}`;
  }
  return `${endDay}T${endClock}`;
}

/**
 * Matchar en körad mot en DB-rad på två sätt.
 *
 * 1. `url` — exakt ticket_url. Starkast bevis.
 * 2. `source + datum + klockslag` — för rader vars ticket_url inte
 *    matchar filen. Matchningen är entydig i praktiken: den skiftade
 *    raden har UTC-klockan LIKA MED den lokala tiden i filen (det är
 *    just det felet vi rättar), så "källa + datum + klockslag" pekar
 *    ut exakt den raden. Även om två rader från samma källa råkar ha
 *    samma datum och klockslag spelar det ingen roll — skiftet är
 *    likadant för båda.
 */
interface Candidate {
  id: string;
  source: string;
  localTime: string;
  match: 'url' | 'source-datetime';
  /** Källans egen sluttid (lokal väggtid), om filen ger en. */
  localEnd?: string | null;
  /** DB-radens sluttid, formaterad som UTC-väggtid. */
  endUtc?: string | null;
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  // ── 1. Hitta rader som lagrats som lokal tid ─────────────────────────
  const shifted = new Map<string, Candidate>();
  let alreadyCorrect = 0;

  // Sluttider räknas i en egen karta: en rad kan ha en KORREKT starttid
  // men en sluttid som lagrats som lokal tid (och tvärtom).
  const endShifted = new Map<
    string,
    { id: string; source: string; localEnd: string; endUtc: string; match: 'url' | 'source-datetime' }
  >();
  let endAlreadyCorrect = 0;

  for (const file of queueFiles()) {
    const parsed: QueueRow[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        parsed.push(JSON.parse(line) as QueueRow);
      } catch {
        /* trasig rad — hoppas över */
      }
    }
    const urls = parsed.map((r) => r.url).filter(Boolean);
    const withDateTime = parsed.filter((r) => r.source && r.date && r.time);
    if (urls.length === 0 && withDateTime.length === 0) continue;

    // Matchning 1: ticket_url.
    const byUrl = new Map<string, { id: string; source: string; utc: string; end_utc: string | null }[]>();
    if (urls.length > 0) {
      const { rows } = await db.query(
        `SELECT e.id, e.source, e.ticket_url,
                to_char(e.start_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') AS utc,
                to_char(e.end_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') AS end_utc
           FROM events e WHERE e.ticket_url = ANY($1::text[])`,
        [urls],
      );
      for (const r of rows) {
        const list = byUrl.get(r.ticket_url) ?? [];
        list.push(r);
        byUrl.set(r.ticket_url, list);
      }
    }

    // Matchning 2: källa + datum + klockslag (fallback).
    const bySourceTime = new Map<string, { id: string; source: string; utc: string; end_utc: string | null }[]>();
    const keys = withDateTime.map((r) => `${r.source}|${r.date}T${r.time}`);
    if (keys.length > 0) {
      const { rows } = await db.query(
        `SELECT e.id, e.source,
                to_char(e.start_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') AS utc,
                to_char(e.start_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') AS key,
                to_char(e.end_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') AS end_utc
           FROM events e
          WHERE e.source = ANY($1::text[])
            AND to_char(e.start_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') = ANY($2::text[])`,
        [[...new Set(withDateTime.map((r) => r.source!))], keys],
      );
      for (const r of rows) {
        const key = `${r.source}|${r.utc}`;
        const list = bySourceTime.get(key) ?? [];
        list.push(r);
        bySourceTime.set(key, list);
      }
    }

    for (const r of parsed) {
      if (!r.date) continue;
      const local = `${r.date}T${r.time ?? '00:00'}`;

      // Matchning 1 före matchning 2 — URL-beviset är starkare.
      const urlRows = r.url ? byUrl.get(r.url) ?? [] : [];
      const candidates: Array<{ row: { id: string; source: string; utc: string; end_utc: string | null }; match: 'url' | 'source-datetime' }> = [];
      for (const row of urlRows) {
        candidates.push({ row, match: 'url' });
      }
      if (candidates.length === 0 && r.source && r.time) {
        for (const row of bySourceTime.get(`${r.source}|${local}`) ?? []) {
          candidates.push({ row, match: 'source-datetime' });
        }
      }

      for (const { row, match } of candidates) {
        // ── Sluttid: samma bevis, egen karta ─────────────────────────────
        // Källans egen sluttid (lokal väggtid) jämförs med radens
        // lagrade sluttid (UTC-väggtid). Är de LIKA har sluttiden lagrats
        // som lokal tid → den ska skiftas. Skiljer de sig med 60/120
        // minuter (zonskillnaden) är sluttiden redan korrekt.
        const localEnd = localEndStamp(r);
        if (localEnd && row.end_utc && !endShifted.has(row.id)) {
          // EXAKT matchning (sekund för sekund). En avrundad skillnad
          // släppte in nästan-träffar: 60 sekunder rundades till 0
          // minuter och såg ut som "lagrad som lokal tid".
          const endDiffSec = Math.round(
            (Date.parse(`${normStamp(row.end_utc)}Z`) -
              Date.parse(`${normStamp(localEnd)}Z`)) /
              1000,
          );
          if (endDiffSec === 0) {
            endShifted.set(row.id, {
              id: row.id,
              source: row.source ?? r.source ?? '',
              localEnd,
              endUtc: row.end_utc,
              match,
            });
          } else if (endDiffSec === 3600 || endDiffSec === 7200 ||
                     endDiffSec === -3600 || endDiffSec === -7200) {
            endAlreadyCorrect++;
          }
        }

        if (shifted.has(row.id)) continue;
        const diff = Math.round(
          (Date.parse(`${row.utc}Z`) - Date.parse(`${local}Z`)) / 60000,
        );
        if (diff === 0) {
          shifted.set(row.id, {
            id: row.id,
            source: row.source ?? r.source ?? '',
            localTime: local,
            match,
          });
        } else if (diff === 60 || diff === 120) {
          alreadyCorrect++;
        }
        // Annan diff → raden går inte att bevisa; lämnas orörd.
      }
    }
  }

  const ids = [...shifted.values()].map((v) => v.id);
  console.log(`[backfill-times] rader som lagrats som lokal tid : ${ids.length}`);
  console.log(`[backfill-times] rader som redan har rätt UTC    : ${alreadyCorrect}`);

  const bySource = new Map<string, number>();
  for (const v of shifted.values()) bySource.set(v.source, (bySource.get(v.source) ?? 0) + 1);
  console.log(`[backfill-times] källor: ${bySource.size}`);
  console.log(
    `[backfill-times] SLUTTIDER lagrade som lokal tid : ${endShifted.size}` +
      `  (redan korrekta: ${endAlreadyCorrect})`,
  );

  // ── 2. Visa vad som händer (alltid, även vid --apply) ───────────────
  if (ids.length > 0) {
    const sample = [...shifted.values()].slice(0, 5);
    const { rows: preview } = await db.query(
      `SELECT e.id,
              to_char(e.start_time AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS lokal_innan,
              to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Stockholm')
                      AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS lokal_efter
         FROM events e WHERE e.id = ANY($1::uuid[])`,
      [sample.map((s) => s.id)],
    );
    const byId = new Map(preview.map((p) => [p.id, p]));
    console.log('\n[backfill-times] bevis — lokal tid EFTER ska vara källans egen tid:');
    for (const s of sample) {
      const p = byId.get(s.id);
      const ok = p?.lokal_efter === s.localTime.slice(0, 16).replace('T', ' ');
      console.log(
        `  ${ok ? 'OK ' : 'FEL'} ${s.source}: ${p?.lokal_innan} → ${p?.lokal_efter}` +
          `  (källan: ${s.localTime.replace('T', ' ')})`,
      );
    }
  }

  if (endShifted.size > 0) {
    // ALLA rader kontrolleras — inte ett urval. Skiftet ska ge
    // EXAKT källans egen sluttid, annars är beviset inte hållbart.
    const { rows: preview } = await db.query(
      `SELECT e.id,
              to_char(e.end_time AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS') AS lokal_innan,
              to_char(((e.end_time AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Stockholm')
                      AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS') AS lokal_efter
         FROM events e WHERE e.id = ANY($1::uuid[])`,
      [[...endShifted.keys()]],
    );
    const byId = new Map(preview.map((p) => [p.id, p]));
    let okCount = 0;
    const bad: string[] = [];
    for (const s of endShifted.values()) {
      const p = byId.get(s.id);
      // Källans tid har ofta INGEN sekund — jämför bara så mycket som
      // källan faktiskt angav.
      const raw = s.localEnd.replace('T', ' ');
      const expected = raw.length > 16 ? raw.slice(0, 19) : raw.slice(0, 16);
      const got = (p?.lokal_efter ?? '').slice(0, expected.length);
      if (got === expected) okCount++;
      else if (bad.length < 10) {
        bad.push(
          `  FEL ${s.source}: ${p?.lokal_innan} → ${p?.lokal_efter} (källan: ${expected})`,
        );
      }
    }
    console.log(
      `\n[backfill-times] bevis för sluttider: ${okCount}/${endShifted.size} rader ger ` +
        'lokal tid EFTER = källans egen tid',
    );
    for (const b of bad) console.log(b);
    if (okCount !== endShifted.size) {
      console.error(
        '[backfill-times] AVBRYTER — beviset håller inte för alla rader. Ingenting skrivs.',
      );
      await db.end();
      return;
    }
  }

  if (!args.apply) {
    console.log('\n[backfill-times] DRY RUN — inga rader ändrade. Kör med --apply.');
    await db.end();
    return;
  }

  if (ids.length === 0) {
    console.log('\n[backfill-times] inga rader att rätta.');
    await db.end();
    return;
  }

  // ── 3. Backup ────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = 'runtime/verification-reports/time-backup';
  mkdirSync(backupDir, { recursive: true });
  // Backupen måste innehålla de rader vars SLUTTID skiftsas också — annars
  // finns ingen väg tillbaka för dem.
  const backupIds = [...new Set([...ids, ...endShifted.keys()])];
  const { rows: backupRows } = await db.query(
    `SELECT id, start_time::text AS start_time, end_time::text AS end_time
       FROM events WHERE id = ANY($1::uuid[])`,
    [backupIds],
  );
  const backupPath = join(backupDir, `event-times-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backupRows, null, 1));
  console.log(`\n[backfill-times] backup: ${backupPath} (${backupRows.length} rader)`);

  // ── 4. Skift ─────────────────────────────────────────────────────────
  await db.query('BEGIN');
  try {
    const { rowCount } = await db.query(
      `UPDATE events e
          SET start_time = (e.start_time AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Stockholm'
        WHERE e.id = ANY($1::uuid[])`,
      [ids],
    );
    console.log(`[backfill-times] skiftade ${rowCount} rader`);

    // Samma skift på sluttiderna. Utan det skulle en rad som fick rätt
    // starttid behålla en sluttid 1–2 timmar för sent.
    if (endShifted.size > 0) {
      const { rowCount: endCount } = await db.query(
        `UPDATE events e
            SET end_time = (e.end_time AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Stockholm'
          WHERE e.id = ANY($1::uuid[])`,
        [[...endShifted.keys()]],
      );
      console.log(`[backfill-times] skiftade ${endCount} sluttider`);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }

  console.log(
    '\n[backfill-times] KLART. Kör nu `npx tsx scripts/audit-duplicates.ts --apply` ' +
      'så att identitetsnycklarna räknas om och dubbletter slås ihop.',
  );

  await db.end();
}

main().catch((err: unknown) => {
  console.error('[backfill-times] FEL:', err instanceof Error ? err.message : err);
  process.exit(2);
});
