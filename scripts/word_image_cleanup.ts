#!/usr/bin/env tsx
/**
 * scripts/word_image_cleanup.ts — städa biblioteket efter en omkmarkering.
 *
 * Gör två saker efter att gaten har kört om med de aktuella reglerna:
 *
 * 1. QUARANTÄN FALLA BILDER. Bilder som inte längre klarar gaten (t.ex. för att
 *    de byggdes på en felaktig betydelse) flyttas till karantän. De ska inte
 *    ligga kvar i biblioteksmappen och se användbara ut.
 *
 * 2. TA BORT DUBLETTER. Två ord kan ge samma bildnyckel (t.ex. "Ateljé" och
 *    "ateljé"). Då finns två filer med samma nyckel och tilldelningen plockar
 *    godtyckligt mellan dem. Den med högst konfidens behålls, resten flyttas
 *    till karantän.
 *
 * Läser gatestatus från den senaste rapporten i runtime/verification-reports/
 * (word-images-<stamp>.json). Om rapporten saknas körs gaten inte alls.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/word_image_cleanup.ts --dry-run
 *   node --env-file=.env --import tsx scripts/word_image_cleanup.ts
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORD_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2', 'word');
const QUAR_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2_word_quarantine');
const REPORT_DIR = path.join(PROJECT_ROOT, 'runtime', 'verification-reports');

const IS_DRY = process.argv.includes('--dry-run');

interface GateResult {
  ord: string;
  key: string;
  file: string;
  ok: boolean;
  confidence: number;
  shows?: string;
  reason?: string;
  text?: string;
}

function latestGateReport(): { path: string; results: GateResult[] } | null {
  if (!existsSync(REPORT_DIR)) return null;
  const files = readdirSync(REPORT_DIR)
    .filter((f) => f.startsWith('word-images-') && f.endsWith('.json'))
    .sort();
  if (!files.length) return null;
  const p = path.join(REPORT_DIR, files[files.length - 1]);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return { path: p, results: (j.results ?? []) as GateResult[] };
}

function moveToQuarantine(file: string): boolean {
  const src = path.join(WORD_DIR, file);
  const srcSide = `${src}.json`;
  if (!existsSync(src)) return false;
  if (IS_DRY) return true;
  mkdirSync(QUAR_DIR, { recursive: true });
  const dst = path.join(QUAR_DIR, file);
  renameSync(src, dst);
  if (existsSync(srcSide)) renameSync(srcSide, `${dst}.json`);
  return true;
}

function main() {
  const report = latestGateReport();
  if (!report) {
    console.error('FEL: ingen gaterapport i runtime/verification-reports — kör verify-word-images.ts --recheck först');
    process.exit(2);
  }
  console.log(`[cleanup] gaterapport: ${path.basename(report.path)} (${report.results.length} rader)`);

  // ── 1. Dubbletter: gruppera per nyckel ─────────────────────────────────
  const byKey = new Map<string, GateResult[]>();
  for (const r of report.results) {
    const k = r.key.toLowerCase();
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }
  const dupes = [...byKey.entries()].filter(([, rs]) => rs.length > 1);
  let removedDupes = 0;
  for (const [key, rs] of dupes) {
    // Behåll den som klarar gaten med högst konfidens; annars den med
    // högst konfidens överhuvudtaget.
    const sorted = [...rs].sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return b.confidence - a.confidence;
    });
    const keep = sorted[0];
    for (const r of sorted.slice(1)) {
      if (moveToQuarantine(r.file)) {
        removedDupes++;
        console.log(`  [dubblett] "${key}": behåller ${keep.file} (conf ${keep.confidence.toFixed(2)}), ` +
          `flyttar ${r.file} till karantän`);
      }
    }
  }

  // ── 2. Bilder som inte klarar gaten → karantän ─────────────────────────
  let quarantined = 0;
  for (const r of report.results) {
    if (r.ok) continue;
    if (moveToQuarantine(r.file)) {
      quarantined++;
      const why = r.text && r.text !== 'none' ? `text=${r.text}` : (r.shows ? `"${r.shows}"` : 'oklart');
      console.log(`  [fel] ${r.ord.padEnd(14)} ${why}`);
    }
  }

  // ── 3. Uppdatera sidecars som flyttats ────────────────────────────────
  // (granskningsresultatet ligger kvar i sidecaren — det är beviset)

  const remaining = readdirSync(WORD_DIR).filter((f) => f.endsWith('.webp')).length;
  console.log(`\n[cleanup] dubbletter borttagna: ${removedDupes}`);
  console.log(`[cleanup] till karantän: ${quarantined}`);
  console.log(`[cleanup] kvar i biblioteket: ${remaining}`);
  if (!IS_DRY) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const out = path.join(REPORT_DIR, `word-cleanup-${stamp}.json`);
    writeFileSync(out, JSON.stringify({
      cleanup: 'word-images', at: new Date().toISOString(),
      gateReport: report.path, removedDupes, quarantined, remaining,
      quarantinedFiles: report.results.filter((r) => !r.ok).map((r) => r.file),
    }, null, 2));
    console.log(`[cleanup] rapport: ${out}`);
  }
}

main();
