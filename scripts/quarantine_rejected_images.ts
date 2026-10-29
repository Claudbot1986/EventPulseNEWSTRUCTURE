#!/usr/bin/env tsx
/**
 * scripts/quarantine_rejected_images.ts
 *
 * Flyttar underkända bilder till karantän.
 *
 * Bakgrund: `scripts/adaptive_image_gen.ts` skriver bilden till disk FÖRE
 * M3-granskningen. Fram till 2026-10-29 fanns inget steg som raderade eller
 * flyttade en underkänd bild — den laddades upp till Supabase och räknades
 * som "klara" i nästa körnings inventering (bara för att den råde ha rätt
 * format). Mätt 2026-10-29: 41 av 537 granskade bilder var underkända och
 * alla 41 fanns kvar på disk med sina sidecars.
 *
 * Det här skriptet är engångsfixen för de redan genererade bilderna.
 * Från och med commit "quarantän i generatorn" sker det direkt i
 * generatorn — men de gamla filerna ligger kvar, så de måste flyttas
 * separat.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/quarantine_rejected_images.ts            # dry-run
 *   node --env-file=.env --import tsx scripts/quarantine_rejected_images.ts --apply    # flytta
 *
 * Källa för underkända bilder: verify.ndjson i varje körningsmapp
 * (runtime/adaptive-image-gen/runs/<runId>/verify.ndjson) plus den äldre
 * (runtime/adaptive-image-gen/verify.ndjson).
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const LIB = 'local_image_library_stamped_v2';
const QUARANTINE = 'local_image_library_stamped_v2_quarantine';
const VERIFY_DIRS = [
  'runtime/adaptive-image-gen',
  'runtime/adaptive-image-gen/runs',
];

const isApply = process.argv.includes('--apply');

interface VerdictRow {
  file?: string;
  verdict?: { pass?: boolean; reason?: string };
}

function collectVerifyFiles(): string[] {
  const out: string[] = [];
  for (const dir of VERIFY_DIRS) {
    if (!existsSync(dir)) continue;
    // Körningsmapp: runs/<runId>/verify.ndjson
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        const vp = path.join(p, 'verify.ndjson');
        if (existsSync(vp)) out.push(vp);
      } else if (entry === 'verify.ndjson') {
        out.push(p);
      }
    }
  }
  return out;
}

function main(): void {
  const verifyFiles = collectVerifyFiles();
  console.log(`[quarantine] ${isApply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[quarantine] ${verifyFiles.length} granskningsloggar: ${verifyFiles.join(', ')}`);

  // Samla underkända filer (sista verdicten per fil vinner).
  const rejected = new Map<string, string>();
  let totalRows = 0;
  for (const vf of verifyFiles) {
    const rows = readFileSync(vf, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as VerdictRow);
    totalRows += rows.length;
    for (const r of rows) {
      if (!r.file) continue;
      if (r.verdict?.pass === false) rejected.set(r.file, r.verdict?.reason ?? '');
      else rejected.delete(r.file);
    }
  }

  // Finns filen kvar i biblioteket? (Den kan redan vara flyttad.)
  const toMove: Array<{ file: string; reason: string; category: string }> = [];
  let alreadyGone = 0;
  for (const [file, reason] of rejected) {
    if (!existsSync(file)) {
      alreadyGone++;
      continue;
    }
    const category = path.basename(path.dirname(file));
    toMove.push({ file, reason, category });
  }

  console.log(`[quarantine] granskade rader totalt: ${totalRows}`);
  console.log(`[quarantine] underkända filer: ${rejected.size} (varav ${alreadyGone} redan borta)`);
  console.log(`[quarantine] att flytta: ${toMove.length}`);

  const byReason = new Map<string, number>();
  for (const t of toMove) {
    const key = t.reason.split('(')[0].trim().slice(0, 48);
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)} × ${r}`);
  }

  if (!isApply) {
    console.log('\n[quarantine] DRY-RUN. Kör med --apply för att flytta.');
    return;
  }

  let moved = 0;
  for (const t of toMove) {
    const dir = path.join(QUARANTINE, t.category);
    mkdirSync(dir, { recursive: true });
    const target = path.join(dir, path.basename(t.file));
    try {
      if (existsSync(target)) rmSync(target, { force: true });
      renameSync(t.file, target);
      const sidecar = `${t.file}.json`;
      if (existsSync(sidecar)) {
        const st = `${target}.json`;
        if (existsSync(st)) rmSync(st, { force: true });
        renameSync(sidecar, st);
      }
      moved++;
    } catch (e) {
      console.error(`  ✗ ${t.file}: ${String((e as Error)?.message ?? e)}`);
    }
  }
  console.log(`[quarantine] flyttade ${moved} filer till ${QUARANTINE}/`);

  // Verifiera att biblioteket inte längre innehåller dem.
  let left = 0;
  for (const t of toMove) if (existsSync(t.file)) left++;
  console.log(`[quarantine] kvar i biblioteket: ${left}`);
  if (left > 0) process.exitCode = 1;
}

main();
