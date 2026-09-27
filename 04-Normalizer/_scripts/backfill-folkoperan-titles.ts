/**
 * Backfill for the 106 events with title="Folkoperan" (bug 2026-09-27).
 *
 * Root cause: folkoperan buyingflow /tickets/20311 is a subscription bundle
 * page where the page <title> is literally "Folkoperan". The adapter used
 * the page title as the event title, producing 106 events with title=
 * "Folkoperan" instead of the real show names (Nietzsche kontra Wagner,
 * Jag är Ulla Winblad, etc.).
 *
 * Adapter fix landed in commit 73edb73 (item_name is now authoritative).
 * Title quality gate (also in 73edb73) blocks new events with generic
 * titles going forward.
 *
 * This script backfills the 106 existing rows by extracting the real
 * titles from the live buyingflow HTML and mapping (date, time) → new
 * title. Verified with curl on 2026-09-27 — 134 unique mappings.
 *
 * Idempotent: only updates rows where title_sv='Folkoperan' AND source='folkoperan'.
 * If a row already has a different title (e.g. updated by a future cronjob
 * run), it's left alone.
 *
 * Run:  npx tsx 04-Normalizer/_scripts/backfill-folkoperan-titles.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BUYINGFLOW_URL = 'https://biljetter.folkoperan.se/sv/buyingflow/tickets/20311/';

function extractTitleMap(html: string): Array<{ date: string; time: string; title: string }> {
  // Använd samma regex som adaptern — men i enklare form (item_name + datum)
  const ITEM_RX = /"item_name":\s*"([^"]+?)-(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2})"/g;
  const decodeHtml = (s: string) =>
    s
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&amp;/g, '&')
      .trim();
  const seen = new Set<string>();
  const out: Array<{ date: string; time: string; title: string }> = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(ITEM_RX.source, 'g');
  while ((m = rx.exec(html)) !== null) {
    const title = decodeHtml(m[1]);
    const dtMatch = m[2].match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2}):\d{2}$/);
    if (!dtMatch) continue;
    const date = dtMatch[1];
    const time = `${dtMatch[2].padStart(2, '0')}:${dtMatch[3]}`;
    const key = `${date}|${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, time, title });
  }
  return out;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('🟡 DRY-RUN — inga DB-rader ändras\n');

  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 1. Hämta HTML från buyingflow
  console.log(`Hämtar HTML från ${BUYINGFLOW_URL} ...`);
  const res = await fetch(BUYINGFLOW_URL, {
    headers: { 'user-agent': 'EventPulse backfill (claude-code, 2026-09-27)' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} från ${BUYINGFLOW_URL}`);
  }
  const html = await res.text();
  console.log(`  ${(html.length / 1024).toFixed(1)} KB HTML mottagen\n`);

  // 2. Bygg (date, time) → title mapping
  const titleMap = extractTitleMap(html);
  console.log(`Extraherade ${titleMap.length} unika (date, time) → title mappningar\n`);

  // 3. Räkna events att uppdatera
  const { count: totalFolkoperan, error: countErr } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan');
  if (countErr) throw countErr;
  console.log(`Events i DB med titel="Folkoperan": ${totalFolkoperan}\n`);

  // 4. Hämta alla events med titel="Folkoperan" och source='folkoperan'
  const { data: staleRows, error: staleErr } = await c
    .from('events')
    .select('id, source, title_sv, title_en, start_time')
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan')
    .eq('source', 'folkoperan');
  if (staleErr) throw staleErr;
  console.log(`Stale rows att backfilla: ${staleRows?.length ?? 0}\n`);

  if (!staleRows || staleRows.length === 0) {
    console.log('Inga rader att uppdatera — avslutar.');
    return;
  }

  // 5. Bygg map för snabb lookup: (date, time) → title
  const lookup = new Map<string, string>();
  for (const { date, time, title } of titleMap) {
    lookup.set(`${date}|${time}`, title);
  }

  // 6. För varje stale row, hitta matchande titel och UPDATE
  let updated = 0;
  let skipped = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  for (const row of staleRows) {
    if (!row.start_time) {
      skipped++;
      failures.push({ id: row.id, reason: 'no start_time' });
      continue;
    }
    // start_time är ISO timestamp — konvertera till date + time
    const d = new Date(row.start_time);
    const date = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const key = `${date}|${time}`;
    const newTitle = lookup.get(key);
    if (!newTitle) {
      skipped++;
      failures.push({ id: row.id, reason: `no mapping for ${key}` });
      continue;
    }

    if (!dryRun) {
      // title_en är NOT NULL — lämna orörd. Nästa cronjob normaliserar den.
      const { error: updateErr } = await c
        .from('events')
        .update({ title_sv: newTitle })
        .eq('id', row.id);
      if (updateErr) {
        skipped++;
        failures.push({ id: row.id, reason: updateErr.message });
        continue;
      }
    }
    updated++;
  }

  console.log(`\n=== RESULTAT ===`);
  console.log(`Uppdaterade: ${updated}`);
  console.log(`Skippade:   ${skipped}`);
  if (failures.length > 0) {
    console.log(`\nFörsta 5 misslyckade:`);
    for (const f of failures.slice(0, 5)) {
      console.log(`  ${f.id.slice(0, 8)} — ${f.reason}`);
    }
  }

  // 7. Verifiering
  const { count: remaining } = await c
    .from('events')
    .select('id', { count: 'exact', head: true })
    .or('title_sv.eq.Folkoperan,title_en.eq.Folkoperan');
  console.log(`\nEvents kvar med titel="Folkoperan" efter backfill: ${remaining}`);
}

main().catch((e) => { console.error(e); process.exit(1); });