#!/usr/bin/env tsx
/**
 * scripts/verify-word-images.mjs — verifiering 1 + 2 för titalanpassad bildgen.
 *
 * Test 1: finns ordet i titeln?      (deterministisk, ingen LLM)
 * Test 2: visar bilden ordet?        (M3 vision läser av bilden)
 *
 * Båda testerna körs mot de RIKTIG genererade bilderna i
 * local_image_library_stamped_v2/word/ — inte mot fixtures.
 *
 * Exit 0 = alla ord klarar båda testerna. Exit 1 = minst ett ord faller.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/verify-word-images.mjs
 *   node --env-file=.env --import tsx scripts/verify-word-images.mjs --word=bastu
 *   node --env-file=.env --import tsx scripts/verify-word-images.mjs --recheck
 *     (--recheck kör om M3-vision även om sidecaren redan har ett resultat)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { verifyImageFile, verdictPasses, verdictReason, type WordVerdict } from './lib/word-image-verdict.js';
import { buildWordIndex, matchKeysInTitle } from './lib/word-image-match.js';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORD_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2', 'word');
const REPORT_DIR = path.join(PROJECT_ROOT, 'runtime', 'verification-reports');
const INVENTORY_CSV = path.join(PROJECT_ROOT, 'docs', 'audit', 'data', 'huvudattraktioner-2026-10-31-ord-inventering.csv');
const NAMES_CSV = path.join(PROJECT_ROOT, 'docs', 'audit', 'data', 'huvudattraktioner-2026-10-31-namn.csv');

/**
 * Antal bilder som granskas samtidigt. M3-vision tar ~4 s per bild och
 * biblioteket har hundratals bilder — sekventiellt tog en omkmarkning
 * 45 min. MiniMax har ingen egen gräns för chat/completions som slår 429,
 * men 6 är konservativt.
 */
const CONCURRENCY = 6;

const arg = (n: string) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : '';
};
const WORD_ARG = arg('word').toLowerCase();
const RECHECK = process.argv.includes('--recheck');

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw) return raw;
  try {
    const m = readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}
const KEY = env('MINIMAX_API_KEY');

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') { inQ = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

async function main() {
  if (!existsSync(WORD_DIR)) {
    console.error(`FEL: ${WORD_DIR} saknas — kör word_image_gen.ts först`);
    process.exit(1);
  }
  const inventory = new Set(parseCsv(readFileSync(INVENTORY_CSV, 'utf8')).map((r) => (r.ord ?? '').toLowerCase()));
  const nameWords = new Set(parseCsv(readFileSync(NAMES_CSV, 'utf8')).map((r) => (r.ord ?? '').toLowerCase()));
  // Ordlistan är facit — samma index som tilldelningen använder.
  const invRows = parseCsv(readFileSync(INVENTORY_CSV, 'utf8'));
  const wordIndex = buildWordIndex(invRows.map((r) => ({ ord: r.ord ?? '', stam: r.stam ?? '' })));

  const allFiles = readdirSync(WORD_DIR).filter((f) => f.endsWith('.webp'));
  const files = WORD_ARG
    ? allFiles.filter((f) => {
        const side = path.join(WORD_DIR, `${f}.json`);
        const ord = existsSync(side) ? (JSON.parse(readFileSync(side, 'utf8')).ord ?? '') : '';
        return ord.toLowerCase() === WORD_ARG;
      })
    : allFiles;
  const results: Record<string, unknown>[] = [];
  let fail = 0;
  let cursor = 0;

  console.log('=== GATE: ord i titel + bild visar ordet ===\n');

  /** Granskar EN bildfil. Flera filer granskas parallellt. */
  async function checkFile(f: string): Promise<void> {
    const sidecar = `${path.join(WORD_DIR, f)}.json`;
    const j = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')) : {};
    const ord: string = j.ord ?? f.split('__')[0];
    const key: string = j.image_key ?? f.split('__')[0];
    const meaning: string = j.meaning ?? j.stam ?? ord;
    const titles: string[] = j.exempel_titlar ?? [];

    // ── TEST 1: finns ordet i titeln? (deterministisk) ──────────────────
    // Samma matchning som tilldelningen: ordlistan är facit, ingen
    // suffixgissning ("Ludwig Hart" slutar med "art" men är INTE konst).
    const titleHit = titles.some((t) => {
      const tk = matchKeysInTitle(t, wordIndex);
      return tk.has(key.toLowerCase()) || tk.has(ord.toLowerCase());
    });
    const inInventory = inventory.has(ord.toLowerCase()) || inventory.has(key.toLowerCase());
    const isName = nameWords.has(ord.toLowerCase());

    // ── TEST 2: visar bilden ordet? (M3 vision) ─────────────────────────
    let verdict = j.verify ?? null;
    if (RECHECK || !verdict || verdict.verified_at === undefined) {
      if (!KEY) { console.error('FEL: MINIMAX_API_KEY saknas'); process.exit(1); }
      verdict = await verifyImageFile(path.join(WORD_DIR, f), ord, meaning, KEY!, titles);
      j.verify = verdict;
      j.verified_match = verdict.match;
      j.verified_appropriate = verdict.appropriate;
      j.verified_ok = verdictPasses(verdict);
      j.verified_text = verdict.text;
      j.verified_foreground_face = verdict.foreground_face;
      j.reverified_at = new Date().toISOString();
      writeFileSync(sidecar, JSON.stringify(j, null, 2));
    }

    const t1 = titleHit && inInventory;
    const t2 = verdictPasses(verdict);
    const ok = t1 && t2 && !isName;
    if (!ok) fail++;

    console.log(`${ok ? '✓' : '✗'} ${ord.padEnd(14)} key=${key.padEnd(11)} ` +
      `T1(ord i titel)=${t1 ? 'ja' : 'NEJ'} T2(bilden visar ordet)=${t2 ? 'ja' : 'NEJ'} ` +
      `conf=${(verdict.confidence ?? 0).toFixed(2)} lämplig=${verdict.appropriate ? 'ja' : 'NEJ'}`);
    if (!ok) {
      if (!titleHit) console.log(`    ↳ ordet "${ord}" hittades inte i någon av: ${titles.slice(0, 2).join(' | ')}`);
      if (!inInventory) console.log(`    ↳ ordet saknas i ord-inventeringen`);
      if (isName) console.log(`    ↳ ordet är klassat som NAMN — ska inte ha någon bild`);
      if (!verdict.match) console.log(`    ↳ bilden visar: "${verdict.shows}" (${verdict.reason})`);
      if (!verdict.appropriate) console.log(`    ↳ olämplig: ${verdict.appropriateness_note}`);
      if (verdict.text !== 'none') console.log(`    ↳ text i bilden: ${verdict.text}`);
      if (verdict.foreground_face) console.log(`    ↳ ansikte i förgrunden`);
    }
    results.push({
      ord, key, file: f, test1_title: t1, test1_in_inventory: inInventory,
      is_name: isName, test2_match: verdict.match === true, test2_appropriate: verdict.appropriate === true,
      confidence: verdict.confidence ?? 0, shows: verdict.shows ?? '', reason: verdict.reason ?? '',
      text: verdict.text ?? 'none', foreground_face: verdict.foreground_face === true,
      ok,
    });
  }

  async function worker(): Promise<void> {
    for (;;) {
      const f = files[cursor++];
      if (!f) return;
      await checkFile(f);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = path.join(REPORT_DIR, `word-images-${stamp}.json`);
  writeFileSync(report, JSON.stringify({ gate: 'word-images', at: new Date().toISOString(), fail, results }, null, 2));

  console.log(`\n${fail === 0 ? '✓ GATE GRÖN' : '✗ GATE RÖD'} — ${results.length - fail}/${results.length} ord klarar båda testerna`);
  console.log(`Bevis: ${report}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FEL:', e); process.exit(1); });
