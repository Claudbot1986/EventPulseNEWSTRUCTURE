#!/usr/bin/env -S npx tsx
/**
 * scripts/_backfill_library_tags.ts — Steg B1: M3-tagg:ar library-bilder med tom cluster_tags.
 *
 * Problem (2026-10-14): 2011 av 5490 library-bilder har tom cluster_tags. De blir
 * "default" i pickLibraryFallback och matchar mot i princip alla events i sin
 * kategori (topp 1-bilden har använts 5055 gånger).
 *
 * Lösning: för varje bild utan tags, anropa M3 med bildens tags[] + kategori
 * och be om 3-5 visuella sökord. Skriv tillbaka till cluster_tags.
 *
 * Säkerhet:
 *   - MINIMAX_API_KEY läses från env
 *   - Idempotent: skriver bara över rader där cluster_tags fortfarande är tomt
 *   - 5 parallella M3-anrop
 *   - --dry-run default
 *
 * Användning:
 *   npx tsx scripts/_backfill_library_tags.ts --dry-run          # se plan
 *   npx tsx scripts/_backfill_library_tags.ts --apply            # kör
 *   npx tsx scripts/_backfill_library_tags.ts --limit=100 --apply
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const M3_KEY = process.env.MINIMAX_API_KEY;
if (!M3_KEY) {
  console.error('Missing MINIMAX_API_KEY — behövs för tagg-generering');
  process.exit(2);
}

const isApply = process.argv.includes('--apply');
function argValue(name: string): string | null {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(name + '=')) return a.slice(name.length + 1);
    if (a === name) {
      const i = process.argv.indexOf(a);
      return process.argv[i + 1] ?? null;
    }
  }
  return null;
}
const limitStr = argValue('--limit');
const limit = limitStr ? parseInt(limitStr, 10) : null;

const M3_ENDPOINT = 'https://api.minimax.io/v1/text/chatcompletion_v2';
const M3_MODEL = 'MiniMax-M3';
const CONCURRENCY = 5;

interface LibraryRow {
  id: string;
  storage_path: string;
  category_slug: string | null;
  tags: string[];
  cluster_tags: string[];
}

const TAG_PROMPT = (category: string | null, existingTags: string[], filename: string): string => `Du hjälper till att tagga AI-genererade bilder i ett evenemangs-bibliotek.

Kategori: ${category ?? '(ingen)'}
Befintliga taggar: ${JSON.stringify(existingTags)}
Filnamn (innehåller kluster-tagg): """${filename}"""

Ge 3-5 korta VISUELLA SÖKORD (svenska, lowercase, 1-2 ord) som beskriver VAD BILDEN VISAR — t.ex. "hårdrock", "gitarr", "mörk scen", "symfoniorkester", "monolog", "fars", "utställning", "workshop", "matlagning", "vinprovning", "dansgolv", "talare", "loop", "hängmatta", "barnkalas", etc.

Taggarna ska hjälpa framtida matchning mot evenemang. Baseras på filnamn + befintliga taggar + kategori.

Svara BARA med JSON-array. Exempel: ["hårdrock","elgitarr","mörk scen"]`;

async function callM3Tags(category: string | null, existingTags: string[], filename: string): Promise<string[]> {
  // En M3-anrop kan returnera tomt svar (rate-limit, tillfälligt fel).
  // Vi gör 2 försök — andra gången brukar fungera.
  for (let attempt = 1; attempt <= 2; attempt++) {
    // 30s timeout per M3-anrop — om API hänger, ge upp och skippa.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(M3_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${M3_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: M3_MODEL,
          messages: [{ role: 'user', content: TAG_PROMPT(category, existingTags, filename) }],
          temperature: 0.2,
          max_tokens: 256,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt < 2) continue; // retry
      return [];
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      if (attempt < 2) continue;
      return [];
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      if (attempt < 2) continue;
      return [];
    }

    // Hantera ofullständig JSON från M3
    let jsonText = content;
    const arrMatch = jsonText.match(/\[[\s\S]*/);
    if (!arrMatch) {
      if (attempt < 2) continue;
      return [];
    }
    let candidate = arrMatch[0];
    const opens = (candidate.match(/"/g) || []).length;
    if (opens % 2 === 1) candidate += '"';
    candidate = candidate.replace(/[\s,]+$/, '');
    if (!candidate.endsWith(']')) candidate += ']';
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        if (attempt < 2) continue;
        return [];
      }
      return parsed
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t.length > 0 && t.length < 30 && !/[\s,{}"]/.test(t))
        .slice(0, 5);
    } catch {
      if (attempt < 2) continue;
      return [];
    }
  }
  return [];
}

function extractFilename(storagePath: string): string {
  const parts = storagePath.split('/');
  return parts[parts.length - 1] ?? storagePath;
}

async function fetchEmptyTagRows(): Promise<LibraryRow[]> {
  const out: LibraryRow[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await db
      .from('image_library')
      .select('id, storage_path, category_slug, tags, cluster_tags')
      .or('cluster_tags.is.null,cluster_tags.eq.{}')
      .range(off, off + 999);
    if (error) {
      console.error('Supabase fel:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...(data as LibraryRow[]));
    if (data.length < 1000) break;
    off += 1000;
  }
  return out;
}

interface Result {
  id: string;
  ok: boolean;
  tags: string[];
  error?: string;
}

async function processOne(row: LibraryRow): Promise<Result> {
  const filename = extractFilename(row.storage_path);
  try {
    const tags = await callM3Tags(row.category_slug, row.tags ?? [], filename);
    if (tags.length === 0) {
      return { id: row.id, ok: false, tags: [], error: 'inga tags från M3' };
    }
    if (isApply) {
      const { error: upErr } = await db
        .from('image_library')
        .update({ cluster_tags: tags })
        .eq('id', row.id);
      if (upErr) return { id: row.id, ok: false, tags, error: upErr.message };
    }
    return { id: row.id, ok: true, tags };
  } catch (err) {
    return { id: row.id, ok: false, tags: [], error: err instanceof Error ? err.message : 'okänt' };
  }
}

async function main(): Promise<void> {
  console.log(`[backfill-tags] läge: ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('[backfill-tags] hämtar library-rader med tomma cluster_tags...');

  let rows = await fetchEmptyTagRows();
  console.log(`[backfill-tags] hittade ${rows.length} rader med tom cluster_tags`);

  if (limit !== null && limit > 0) {
    rows = rows.slice(0, limit);
    console.log(`[backfill-tags] begränsar till ${rows.length} rader (--limit=${limit})`);
  }

  if (rows.length === 0) {
    console.log('[backfill-tags] inget att göra.');
    return;
  }

  // Fördelning per kategori
  const byCat = new Map<string, number>();
  for (const r of rows) {
    const c = r.category_slug ?? '(null)';
    byCat.set(c, (byCat.get(c) ?? 0) + 1);
  }
  console.log(`[backfill-tags] fördelning (topp 10):`);
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${cat.padEnd(25)} ${n}`);
  }

  const t0 = Date.now();
  const results: Result[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const idx = cursor++;
      const r = await processOne(rows[idx]);
      results.push(r);
      if (results.length % 50 === 0 || cursor === rows.length) {
        const ok = results.filter((x) => x.ok).length;
        const err = results.filter((x) => !x.ok).length;
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const rate = (results.length / ((Date.now() - t0) / 1000)).toFixed(1);
        process.stdout.write(`\r  ${results.length}/${rows.length} (ok=${ok}, fel=${err}, ${rate}/s)         `);
      }
    }
  }

  console.log(`[backfill-tags] startar ${CONCURRENCY} workers...`);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  process.stdout.write('\n');

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = results.filter((x) => x.ok).length;
  const err = results.filter((x) => !x.ok).length;

  // Visa exempel
  console.log('\n[backfill-tags] exempel (5 första OK):');
  for (const r of results.filter((x) => x.ok).slice(0, 5)) {
    const row = rows.find((row) => row.id === r.id);
    console.log(`  ${row?.storage_path} → ${JSON.stringify(r.tags)}`);
  }
  if (err > 0) {
    console.log('\n[backfill-tags] exempel fel:');
    for (const r of results.filter((x) => !x.ok).slice(0, 3)) {
      const row = rows.find((row) => row.id === r.id);
      console.log(`  ${row?.storage_path}: ${r.error}`);
    }
  }

  console.log(`\n[backfill-tags] KLART på ${elapsed}s`);
  console.log(`  ok:  ${ok}`);
  console.log(`  fel: ${err}`);
  if (!isApply) {
    console.log('\n[backfill-tags] DRY-RUN: inget skrivet. Kör med --apply för att verkställa.');
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});