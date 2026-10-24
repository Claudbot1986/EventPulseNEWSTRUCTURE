#!/usr/bin/env node
/**
 * _backfill_end_time.ts — fyll i (och reparera) sluttiden på events i databasen.
 *
 * BUGG (fixad 2026-10-24 i 03-Queue/importToEventPulse.ts):
 * en adapter lämnar oftast `endTime` som ett REN klockslag ("15:00").
 * Det skickades vidare rakt av, och normalizern kastar bort sluttider som
 * inte innehåller "T" (`normalizer.ts:785` kräver en ISO-stämpel).
 * Följd: 191 rader över 20 källor importerades UTAN sluttid.
 *
 * Skriptet reparerar de redan importerade raderna:
 *   1. läser de extraherade raderna med PRODUKTIONS-funktionerna
 *      (`readExtractedEvents` + `extractEndTime`) — samma sluttid räknas
 *      fram som i importen. Ingen egen kopierad logik → ingen drift.
 *   2. matchar dem mot databasens rader på (source, start_time, titel)
 *      och använder ticket_url som skiljedare när flera rader delar nyckel.
 *   3. skriver BARA `end_time` på raden. `dedup_hash` lämnas orörd.
 *
 * Två sorters ändring:
 *   FILL   — databasen saknar sluttid, artefakten har en → skriv den.
 *   REPAIR — databasen har en sluttid som INTE stämmer med artefakten →
 *            skriv rätt värde (kan vara null: se regeln i extractEndTime —
 *            en sluttid före starten eller med noll längd skrivs inte).
 *
 * Endast rader där artefakten faktiskt bär sluttids-information
 * (`end_date`/`endTime`/`end_time`) påverkas. En rad vars källa inte ger
 * någon sluttid lämnas orörd — där kan en sluttid i databasen komma från
 * en annan artefakt, och den ska inte raderas.
 *
 * Usage:
 *   npx tsx scripts/_backfill_end_time.ts --dry-run
 *   npx tsx scripts/_backfill_end_time.ts
 *   npx tsx scripts/_backfill_end_time.ts --source waldemarsudde
 */
import * as dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  readExtractedEvents,
  toRawEvent,
  extractEndTime,
} from '../03-Queue/importToEventPulse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EXTRACTED_DIR = path.join(REPO_ROOT, '03-Queue', '03-extractedevents');

dotenv.config({ path: path.join(REPO_ROOT, '.env'), override: true });

interface Derived {
  /** Sluttiden produktionen räknar fram (null = ska inte finnas). */
  endTime: string | null;
  /** Sant om källan alls sa något om slut — då får vi röra raden. */
  hasEndSignal: boolean;
  startTime: string;
  title: string;
  source: string;
  ticketUrl: string | null;
}

function keyOf(source: string, startIso: string | null, title: string | null): string | null {
  if (!startIso || !title) return null;
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return null;
  return `${source}|${start}|${title.trim()}`;
}

function listSourceIds(): string[] {
  if (!fs.existsSync(EXTRACTED_DIR)) return [];
  const ids = new Set<string>();
  for (const entry of fs.readdirSync(EXTRACTED_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      ids.add(entry.name.replace(/\.jsonl$/, ''));
    } else if (entry.isDirectory()) {
      for (const f of fs.readdirSync(path.join(EXTRACTED_DIR, entry.name))) {
        if (f.endsWith('.jsonl')) ids.add(f.replace(/\.jsonl$/, ''));
      }
    }
  }
  return [...ids];
}

/** Alla extraherade rader för en källa, med den sluttid produktionen räknar fram. */
function collectExtracted(sourceIds: string[]): Map<string, Derived[]> {
  const map = new Map<string, Derived[]>();
  for (const sourceId of sourceIds) {
    const rows = readExtractedEvents(sourceId, EXTRACTED_DIR);
    const derived: Derived[] = [];
    for (const ev of rows) {
      const raw = toRawEvent(sourceId, ev);
      const hasEndSignal =
        !!ev.end_time || !!String(ev.endDate ?? '').trim() || !!String(ev.endTime ?? '').trim();
      derived.push({
        endTime: extractEndTime(ev),
        hasEndSignal,
        startTime: raw.start_time,
        title: raw.title,
        source: raw.source,
        ticketUrl: raw.ticket_url ?? null,
      });
    }
    map.set(sourceId, derived);
  }
  return map;
}

/** Samma tidpunkt? (DB lagrar "+00:00", vi räknar ".000Z") */
function sameInstant(a: string | null, b: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return a === b;
  return x === y;
}

interface DbRow {
  id: string;
  source: string | null;
  title_sv: string | null;
  title_en: string | null;
  start_time: string | null;
  end_time: string | null;
  ticket_url: string | null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sourceIdx = args.indexOf('--source');
  const onlySources = sourceIdx !== -1 && args[sourceIdx + 1]
    ? new Set(args[sourceIdx + 1].split(',').map((s) => s.trim()).filter(Boolean))
    : null;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[backfill] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas i .env');
    process.exit(1);
  }

  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const allSourceIds = listSourceIds();
  const sourceIds = onlySources
    ? allSourceIds.filter((id) => onlySources.has(id))
    : allSourceIds;

  if (sourceIds.length === 0) {
    console.log('[backfill] inga extraherade artefakter hittades');
    process.exit(0);
  }

  console.log(`[backfill] läser ${sourceIds.length} källors extraherade rader…`);
  const derivedBySource = collectExtracted(sourceIds);

  // Nyckel → rader. Flera artefaktrader kan dela nyckel (samma event från
  // olika gater). Vi väljer den som matchar DB-radens ticket_url.
  const byKey = new Map<string, Derived[]>();
  for (const rows of derivedBySource.values()) {
    for (const d of rows) {
      const k = keyOf(d.source, d.startTime, d.title);
      if (!k) continue;
      const list = byKey.get(k) ?? [];
      list.push(d);
      byKey.set(k, list);
    }
  }

  const PAGE = 1000;
  let offset = 0;
  const rows: DbRow[] = [];
  while (true) {
    const { data, error } = await db
      .from('events')
      .select('id, source, title_sv, title_en, start_time, end_time, ticket_url')
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`[backfill] databasfel: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as DbRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`[backfill] ${rows.length} DB-rader lästa`);

  const changes: { id: string; from: string | null; to: string | null; source: string; title: string }[] = [];
  let fills = 0;
  let repairs = 0;
  let ambiguous = 0;

  for (const row of rows) {
    const title = (row.title_sv ?? row.title_en ?? '') as string;
    const k = keyOf((row.source ?? '') as string, row.start_time, title);
    const candidates = k ? byKey.get(k) : undefined;

    // Välj den artefaktrad som bäst beskriver DB-raden.
    let chosen: Derived | undefined;
    if (candidates && candidates.length === 1) {
      chosen = candidates[0];
    } else if (candidates && candidates.length > 1) {
      chosen = candidates.find((c) => c.ticketUrl && row.ticket_url && c.ticketUrl === row.ticket_url);
      if (!chosen) {
        ambiguous++;
        chosen = candidates.find((c) => c.hasEndSignal) ?? candidates[0];
      }
    }

    if (!chosen || !chosen.hasEndSignal) {
      // Ingen artefaktrad som bär slutinformation — källan säger ingenting
      // om slut (eller artefakten är bortrotad). Rör inte raden — UNLESS
      // den ändå har en sluttid som inte ligger efter starten. Sådan
      // sluttid är trasig oavsett var den kom ifrån, och en trasig sluttid
      // syns i appen som "20:00–00:00".
      if (!row.end_time || !row.start_time) continue;
      if (Date.parse(row.end_time) > Date.parse(row.start_time)) continue;
      changes.push({
        id: row.id,
        from: row.end_time,
        to: null,
        source: (row.source ?? '?') as string,
        title,
      });
      repairs++;
      continue;
    }

    const target = chosen.endTime;
    if (sameInstant(row.end_time, target)) continue;

    if (!row.end_time) fills++;
    else repairs++;
    changes.push({
      id: row.id,
      from: row.end_time,
      to: target,
      source: chosen.source,
      title: chosen.title,
    });
  }

  console.log(`[backfill] ${fills} rader saknar sluttid, ${repairs} har en trasig sluttid`);
  if (ambiguous > 0) console.log(`[backfill] ${ambiguous} rader matchade flera artefakter (ticket_url användes för att välja)`);

  const perSource = new Map<string, number>();
  for (const c of changes) perSource.set(c.source, (perSource.get(c.source) ?? 0) + 1);
  console.log('[backfill] per källa:');
  for (const [src, n] of [...perSource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${src}`);
  }

  if (changes.length > 0) {
    console.log('\n[backfill] ändringar:');
    for (const c of changes.slice(0, 200)) {
      console.log(`  ${c.source} | ${c.title.slice(0, 45)} | ${c.from ?? 'SAKNAS'} → ${c.to ?? 'SAKNAS'}`);
    }
  }

  if (dryRun) {
    console.log('\n[backfill] DRY-RUN — inga rader skrivna.');
    return;
  }

  let updated = 0;
  let failed = 0;
  for (const c of changes) {
    const { error } = await db
      .from('events')
      .update({ end_time: c.to })
      .eq('id', c.id);
    if (error) {
      console.error(`[backfill] ✗ ${c.id}: ${error.message}`);
      failed++;
    } else {
      updated++;
    }
  }
  console.log(`\n[backfill] KLAR — ${updated} rader uppdaterade (${fills} ifyllda, ${repairs} reparerade), ${failed} fel`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[backfill] fatalt fel:', err);
  process.exit(1);
});
