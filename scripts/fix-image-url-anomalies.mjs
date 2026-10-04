#!/usr/bin/env node
/**
 * scripts/fix-image-url-anomalies.mjs — En-gångs-fix för image_url-kontraktet.
 *
 * Bakgrund (2026-10-04):
 *   270 events från livespot-stockholm hade image_url pekandes mot
 *   livespot.se-CDN (scrape-original). image_ai_generated=false,
 *   image_generation_status != 'library_fallback', image_ai_optout=false
 *   → useAiImageUrl-hookens regelträd returnerar tom placeholder. UI
 *   visade 270 tomma rutor i Hem-karusellerna.
 *
 *   Kontraktet säger (se migration 20261004-0001-events-image-url-
 *   contract-check.sql): image_url får bara vara satt om något av
 *   image_ai_generated=true / image_ai_optout=true / status='library_fallback'
 *   också är sant.
 *
 * Vad detta script gör:
 *   1. Hittar ALLA events där image_url is not null men INTE uppfyller
 *      kontraktet (anomalier).
 *   2. Nollar image_url + nollställer image_generation_status till 'pending'
 *      → matchLibraryFirst kan plocka upp dem.
 *   3. Anropar matchLibraryFirst med hög limit för att tilldela biblioteks-
 *      bilder. För varje event försöker den venue+category → category →
 *      default (NULL-category-bild).
 *
 * Körning:
 *   node scripts/fix-image-url-anomalies.mjs              # faktiskt kör
 *   node scripts/fix-image-url-anomalies.mjs --dry-run    # bara lista
 *
 * Idempotent: en andra körning hittar 0 anomalier och avslutar tidigt.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const dryRun = process.argv.includes('--dry-run');
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

// 1. Hitta alla anomalier: image_url satt men inget av ai_generated/optout/library_fallback.
async function findAnomalies() {
  // Paginerad hämtning — Supabase default 1000 rader, vi har 6500+.
  let all = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('events')
      .select('id, source, image_url, image_ai_generated, image_ai_optout, image_generation_status')
      .gte('start_time', new Date().toISOString())
      .not('image_url', 'is', null)
      .range(from, from + step - 1);
    if (error) throw new Error(`fetch anomalies failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < step) break;
    from += step;
  }
  return all.filter((r) => {
    const okAi = r.image_ai_generated === true;
    const okOpt = r.image_ai_optout === true;
    const okLib = r.image_generation_status === 'library_fallback';
    return !okAi && !okOpt && !okLib;
  });
}

// 2. Nolla image_url + återställ pending state på alla anomalier.
async function nullAnomalies(anomalies) {
  if (anomalies.length === 0) return 0;
  if (dryRun) {
    console.log(`[dry-run] skulle nulla image_url på ${anomalies.length} events`);
    return anomalies.length;
  }
  // Batch om 200 för att inte stressa Supabase.
  let total = 0;
  const BATCH = 200;
  for (let i = 0; i < anomalies.length; i += BATCH) {
    const batch = anomalies.slice(i, i + BATCH);
    const ids = batch.map((r) => r.id);
    const { error, count } = await supabase
      .from('events')
      .update(
        {
          image_url: null,
          image_ai_generated: false,
          image_ai_optout: false,
          image_generation_status: 'pending',
          image_generation_error: null,
          image_generation_attempts: 0,
          image_license: null,
          image_attribution: null,
        },
        { count: 'exact' },
      )
      .in('id', ids);
    if (error) throw new Error(`update failed (batch ${i / BATCH}): ${error.message}`);
    total += count || batch.length;
    if (i % 1000 === 0) console.log(`  nullade ${total}/${anomalies.length}`);
  }
  console.log(`  nullade ${total}/${anomalies.length} totalt`);
  return total;
}

// 3. Kör matchLibraryFirst för att tilldela biblioteks-bilder.
//    Körs i chunks om behövs (production har 6500+ events).
async function runMatchLibraryFirst() {
  if (dryRun) {
    console.log('[dry-run] skulle köra matchLibraryFirst (limit 1000, i chunks)');
    return { libraryMatched: 0, unmatched: 0, totalFetched: 0 };
  }
  console.log('Anropar matchLibraryFirst i chunks om 1000 — kan ta flera minuter...');
  const { spawnSync } = await import('child_process');
  let totalMatched = 0;
  let totalFetched = 0;
  let chunkNum = 0;
  while (true) {
    chunkNum++;
    const res = spawnSync(
      'npx',
      [
        'tsx',
        '--eval',
        `import('./08-Agent/services/imageGen.matchLibraryFirst.ts').then(m => m.matchLibraryFirst({ limit: 1000, onlyMissing: true, libraryConcurrency: 5, bflConcurrency: 0, skipBflFallback: true })).then(r => console.log('MLF_RESULT:' + JSON.stringify(r))).catch(e => { console.error(e); process.exit(1); })`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'], env: process.env, encoding: 'utf-8' },
    );
    if (res.status !== 0) {
      console.warn(`matchLibraryFirst chunk ${chunkNum} avslutade med kod ${res.status}`);
      break;
    }
    // Parse stdout för MLF_RESULT-rad
    const out = res.stdout || '';
    const m = out.match(/MLF_RESULT:(.+)/);
    if (!m) break;
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      break;
    }
    totalMatched += parsed.libraryMatched || 0;
    totalFetched += parsed.totalFetched || 0;
    console.log(`  chunk ${chunkNum}: matched=${parsed.libraryMatched}, totalFetched=${parsed.totalFetched}, unmatched=${parsed.unmatched}`);
    // Avsluta om inga fler events hämtades (sidan är tömd)
    if ((parsed.totalFetched || 0) === 0 || (parsed.libraryMatched || 0) === 0) break;
    // Säkerhetsmax — undvik oändlig loop om något är trasigt
    if (chunkNum >= 10) {
      console.warn('  nådd max chunks (10) — avbryter för säkerhet');
      break;
    }
  }
  console.log(`Totalt: matched=${totalMatched}, totalFetched=${totalFetched}`);
  return { libraryMatched: totalMatched, totalFetched };
}

async function main() {
  console.log(`=== fix-image-url-anomalies.mjs ${dryRun ? '(DRY RUN)' : ''} ===`);

  // Step 1: hitta anomalier
  const anomalies = await findAnomalies();
  const bySrc = {};
  for (const r of anomalies) {
    const s = r.source || '(null)';
    bySrc[s] = (bySrc[s] || 0) + 1;
  }
  console.log(`Anomalier hittade: ${anomalies.length}`);
  for (const [s, n] of Object.entries(bySrc)) {
    console.log(`  ${s}: ${n}`);
  }

  if (anomalies.length === 0) {
    console.log('Inga anomalier — allt är redan OK. Avslutar.');
    return;
  }

  // Step 2: nolla scrape-original image_url
  const nulled = await nullAnomalies(anomalies);
  console.log(`Steg 2 klar: ${nulled} events har fått image_url=null + status=pending`);

  // Step 3: kör matchLibraryFirst (skipBflFallback=true för att undvika att
  // bränna BFL-credits om biblioteket inte täcker alla events).
  await runMatchLibraryFirst();

  console.log('Klar. Verifiera med t.ex.:');
  console.log("  node -e \"import('@supabase/supabase-js').then(...)\"  # se top-of-script för query");
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});