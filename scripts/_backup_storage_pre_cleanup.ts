#!/usr/bin/env -S npx tsx
/**
 * _backup_storage_pre_cleanup.ts — pre-destroy säkerhetsnät.
 *
 * Listar ALLA filer i Supabase Storage `event-posters/import-stamped/`
 * och sparar metadata till JSON. Inte pixel-data, bara inventory som
 * låter oss återställa paths om något går fel under radering.
 *
 * Bakgrund (2026-10-14): vi ska radera 2 122 orphan-filer. Inventory
 * behövs för att veta exakt vad som fanns om vi måste rulla tillbaka.
 *
 * Säkerhet:
 *   - Default = --dry-run (bara stdout)
 *   - Med --apply: skriver local_image_library_backup/pre-cleanup-2026-10-14/storage-inventory.json
 *   - Idempotent: overskriver gammal inventory
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(2);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BUCKET = 'event-posters';
const PREFIX = 'import-stamped';
const OUT_DIR = join(process.cwd(), 'local_image_library_backup', 'pre-cleanup-2026-10-14');
const OUT_FILE = join(OUT_DIR, 'storage-inventory.json');

const isApply = process.argv.includes('--apply');

interface StorageEntry {
  name: string;          // filnamn utan prefix
  path: string;          // e.g. "import-stamped/foo.webp"
  size_bytes?: number;
  mimetype?: string;
  updated_at?: string;
}

async function listAll(): Promise<StorageEntry[]> {
  const all: StorageEntry[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await db.storage.from(BUCKET).list(PREFIX, { limit: 1000, offset: off });
    if (error) { console.error('storage list error:', error.message); return all; }
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (f.name === '.emptyFolderPlaceholder') continue;
      all.push({
        name: f.name,
        path: `${PREFIX}/${f.name}`,
        size_bytes: (f.metadata as any)?.size ?? (f.metadata as any)?.contentLength,
        mimetype: (f.metadata as any)?.mimetype,
        updated_at: f.updated_at,
      });
    }
    if (data.length < 1000) break;
    off += 1000;
  }
  return all;
}

async function main() {
  console.log(`[backup-inventory] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[backup-inventory] bucket: ${BUCKET}/${PREFIX}`);
  console.log(`[backup-inventory] out: ${OUT_FILE}`);

  console.log('[backup-inventory] listar storage (kan ta 30s)...');
  const t0 = Date.now();
  const entries = await listAll();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[backup-inventory] hittade ${entries.length} filer på ${elapsed}s`);

  // Fördelning per ext
  const byExt: Record<string, number> = {};
  for (const e of entries) {
    const ext = e.name.split('.').pop()?.toLowerCase() || '(none)';
    byExt[ext] = (byExt[ext] || 0) + 1;
  }
  console.log('[backup-inventory] per ext:', byExt);

  // Total size
  const totalBytes = entries.reduce((s, e) => s + (e.size_bytes ?? 0), 0);
  console.log(`[backup-inventory] total size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  if (!isApply) {
    console.log('\n[backup-inventory] DRY-RUN. Kör med --apply för att skriva inventory.');
    console.log(`[backup-inventory] skulle skriva ${entries.length} entries till ${OUT_FILE}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    bucket: BUCKET,
    prefix: PREFIX,
    total_files: entries.length,
    total_size_bytes: totalBytes,
    by_ext: byExt,
    entries,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[backup-inventory] skrev ${OUT_FILE} (${entries.length} entries)`);
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
