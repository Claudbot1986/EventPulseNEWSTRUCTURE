/**
 * scripts/measure_supabase_size.ts
 *
 * Loggar Supabase-storlek (database + storage + per-tabell row counts) till
 * runtime/supabase-size-history.jsonl. Används för att verifiera att
 * Spår A+B (purge + WebP) har önskad effekt.
 *
 * Körs manuellt eller via launchd (t.ex. dagligen kl 02:55, strax före
 * purge-jobbet).
 *
 * Miljövariabler (läses från ../.env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STORAGE_BUCKET (default: 'event-posters')
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  console.warn('[measure] could not load .env from', ENV_PATH, (err as Error).message);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'event-posters';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[measure] SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas i .env');
  process.exit(1);
}

const HISTORY_PATH = resolve(__dirname, '../runtime/supabase-size-history.jsonl');

interface TableRowCount {
  table: string;
  rows: number;
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // 1. Hämta databas-storlek via RPC (om tillgängligt)
  // Annars: använd HEAD-förfrågan med count=exact på en tabell
  const { count: eventsCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });

  const { count: userIntCount } = await supabase
    .from('user_interaction_outbound')
    .select('*', { count: 'exact', head: true });

  const { count: savesCount } = await supabase
    .from('user_interaction_save')
    .select('*', { count: 'exact', head: true });

  const { count: notifCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });

  // 2. Hämta storage-filstorlek via list API
  // Vi listar bara filnamn, inte hela storage-storleken — Supabase Storage
  // API har ingen enkel getBucketSize. Vi loggar file count + path-prefix
  // för att se struktur över tid.
  const { data: stampedFiles } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list('import-stamped', { limit: 1000 });
  const { data: originalFiles } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list('import-original', { limit: 1000 });

  const tables: TableRowCount[] = [
    { table: 'events', rows: eventsCount ?? 0 },
    { table: 'user_interaction_outbound', rows: userIntCount ?? 0 },
    { table: 'user_interaction_save', rows: savesCount ?? 0 },
    { table: 'notifications', rows: notifCount ?? 0 },
  ];

  const snapshot = {
    ts: new Date().toISOString(),
    db_table_rows: tables,
    storage: {
      bucket: STORAGE_BUCKET,
      import_stamped_count: stampedFiles?.length ?? 0,
      import_original_count: originalFiles?.length ?? 0,
      // Vi kan inte mäta bytes utan att ladda ner — lämna som note
      note: 'byte_size requires downloading — use Storage UI dashboard',
    },
  };

  console.log(JSON.stringify(snapshot, null, 2));

  // Logga till history
  mkdirSync(dirname(HISTORY_PATH), { recursive: true });
  appendFileSync(HISTORY_PATH, JSON.stringify(snapshot) + '\n');
  console.log(`[measure] loggad till ${HISTORY_PATH}`);
}

main().catch((err) => {
  console.error('[measure] fatal error:', err);
  process.exit(1);
});
