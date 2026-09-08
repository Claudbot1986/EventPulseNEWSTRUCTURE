/**
 * scripts/purge_yesterday_events.ts
 *
 * Daglig radering av events som passerade (start_time < midnatt igår).
 *
 * Policy (2026-09-06): Supabase lagrar bara events som är aktuella eller
 * i framtiden. Inga historiska events äldre än 1 dygn. Det håller
 * databasen konstant liten och möjliggör nergradering till Free-plan.
 *
 * Vad skriptet gör:
 *   1. Hittar events med start_time < midnatt igår
 *   2. Sparade events (user_interaction_save) flyttas till
 *      runtime/archive/saved-events.jsonl som backup (förstörs inte)
 *   3. Övriga events raderas permanent från Supabase
 *
 * Säkerhet:
 *   - --dry-run som default (ingen data ändras)
 *   - --apply för skarp körning (från launchd-jobb eller manuellt)
 *   - Idempotent: kan köras flera gånger utan sidoeffekter
 *
 * Körs dagligen kl 03:00 via scripts/com.eventpulse.purge.plist.
 *
 * Miljövariabler (läses från ../../.env vid uppstart):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, appendFileSync } from 'node:fs';

// ── Env loading ─────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = resolve(__dirname, '../.env');

try {
  const envText = readFileSync(ENV_PATH, 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch (err) {
  console.warn('[purge] could not load .env from', ENV_PATH, (err as Error).message);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[purge] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(1);
}

const ARCHIVE_DIR = resolve(__dirname, '../runtime/archive');
const ARCHIVE_PATH = resolve(ARCHIVE_DIR, 'saved-events.jsonl');

// ── Helpers ────────────────────────────────────────────────────────────────

function yesterdayMidnightIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  const isApply = process.argv.includes('--apply');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const cutoff = yesterdayMidnightIso();

  console.log(`[purge] cutoff: ${cutoff}`);

  // 1. Hämta events som ska raderas
  const { data: oldEvents, error: fetchErr } = await supabase
    .from('events')
    .select('*')
    .lt('start_time', cutoff)
    .order('start_time');

  if (fetchErr) {
    console.error(`[purge] fetch misslyckades: ${fetchErr.message}`);
    process.exit(1);
  }

  console.log(`[purge] hittade ${oldEvents?.length ?? 0} events äldre än cutoff`);

  if (!oldEvents || oldEvents.length === 0) {
    console.log('[purge] inget att göra, avslutar');
    return;
  }

  // 2. Separera: events med saves (skyddade) vs utan
  const { data: savedRows, error: savedErr } = await supabase
    .from('user_interaction_save')
    .select('event_id');

  if (savedErr) {
    console.warn(`[purge] kunde inte hämta saves (fortsätter utan skydd): ${savedErr.message}`);
  }

  const savedSet = new Set((savedRows ?? []).map((r) => r.event_id));
  const toArchive = oldEvents.filter((e) => savedSet.has(e.id));
  const toDelete = oldEvents.filter((e) => !savedSet.has(e.id));

  console.log(`[purge]   → ${toArchive.length} sparas lokalt (har saves)`);
  console.log(`[purge]   → ${toDelete.length} raderas permanent (inga saves)`);

  if (!isApply) {
    console.log('[purge] dry-run — ingen data ändrad. Kör med --apply för skarp körning.');
    return;
  }

  // 3. Arkivera events med saves (JSONL)
  if (toArchive.length > 0) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    for (const e of toArchive) {
      appendFileSync(ARCHIVE_PATH, JSON.stringify(e) + '\n');
    }
    console.log(`[purge] arkiverade ${toArchive.length} events med saves → ${ARCHIVE_PATH}`);
  }

  // 4. Radera events utan saves (i batcher om 500)
  if (toDelete.length > 0) {
    const ids = toDelete.map((e) => e.id);
    const BATCH = 500;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const { error: delErr } = await supabase
        .from('events')
        .delete()
        .in('id', batch);
      if (delErr) {
        console.error(`[purge] delete batch misslyckades: ${delErr.message}`);
        continue;
      }
      deleted += batch.length;
    }
    console.log(`[purge] raderade ${deleted} events permanent`);
  }

  console.log('[purge] klar');
}

main().catch((err) => {
  console.error('[purge] fatal error:', err);
  process.exit(1);
});
