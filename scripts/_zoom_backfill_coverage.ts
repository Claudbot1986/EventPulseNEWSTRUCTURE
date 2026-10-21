/**
 * scripts/_zoom_backfill_coverage.ts
 *
 * Skannar local_image_library_stamped rekursivt efter zoom-*.webp.json
 * och bygger state/zoom-coverage.json fran det. Anvand detta en gang
 * for att bootstrapa state efter att ha genererat bilder utan
 * state-sparning.
 *
 * CLI: tsx scripts/_zoom_backfill_coverage.ts [--dry-run]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadCoverageState, registerCombo, persist as persistCoverage } from '../BFL-generator/lib/zoom-coverage-state';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'local_image_library_stamped');

function walkJsonFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonFiles(p, out);
    else if (e.isFile() && e.name.endsWith('.webp.json')) out.push(p);
  }
  return out;
}

function main(): void {
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) console.log('[zoom-backfill] DRY-RUN');

  if (!fs.existsSync(SRC_DIR)) {
    console.error(`[zoom-backfill] katalogen finns inte: ${SRC_DIR}`);
    process.exit(2);
  }

  const files = walkJsonFiles(SRC_DIR);
  console.log(`[zoom-backfill] hittade ${files.length} .webp.json-filer i ${SRC_DIR}`);

  // Filtrera bort rena EC-bilder (eller andra) om användaren vill —
  // annars: processa alla och registrera i state.
  let state = loadCoverageState(ROOT);
  const initialTotals = JSON.parse(JSON.stringify(state.totals));
  let added = 0;
  let skipped = 0;

  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      const cat = d.category;
      const tag = d.cluster_tag;
      const zoomId = d.zoomId;
      const pose = d.pose;
      const light = d.light;
      if (!cat || !tag || !zoomId || !pose || !light) {
        skipped++;
        continue;
      }
      const before = state.totals[cat] ?? 0;
      state = registerCombo(
        state,
        cat,
        tag,
        [zoomId, pose, light],
        'backfill',
        d.created_at ?? new Date().toISOString(),
        d.stamped_path,
      );
      const after = state.totals[cat] ?? 0;
      if (after > before) added++;
      else skipped++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[zoom-backfill] hoppade över ${f}: ${msg}`);
      skipped++;
    }
  }

  const finalTotal = Object.values(state.totals).reduce((s, n) => s + n, 0);
  const initialTotal = Object.values(initialTotals).reduce((s, n) => s + n, 0);
  console.log(`[zoom-backfill] state innan: ${initialTotal} bilder`);
  console.log(`[zoom-backfill] state efter:  ${finalTotal} bilder`);
  console.log(`[zoom-backfill] tillagda:    ${added}`);
  console.log(`[zoom-backfill] hoppade:     ${skipped}`);

  if (!isDryRun && added > 0) {
    persistCoverage(state, ROOT);
    console.log(`[zoom-backfill] state sparat till state/zoom-coverage.json`);
  } else if (isDryRun) {
    console.log('[zoom-backfill] DRY-RUN: inget sparat');
  } else {
    console.log('[zoom-backfill] inga ändringar, inget sparat');
  }
}

main();
