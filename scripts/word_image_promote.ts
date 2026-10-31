#!/usr/bin/env tsx
/**
 * scripts/word_image_promote.ts — ge karantänbilderna en andra chans.
 *
 * När granskningsreglerna skärps (t.ex. match-frågan ändrades från
 * "visar bilden ordet?" till "visar bilden ordets INNEBÖRD?") så underkänns
 * ord som "is" (isbana med skridskor) och "tour" (turnébuss) felaktigt.
 * De bilderna ligger i karantän med en gammel granskning.
 *
 * Det här skriptet:
 *   1. Läser alla bilder i karantänkatalogen.
 *   2. Granskar dem på nytt med de aktuella reglerna (M3-vision).
 *   3. De som NU klarar gaten flyttas tillbaka till biblioteksmappen och
 *      sidecarens granskning uppdateras — tilldelningen plockar sedan upp
 *      dem automatiskt (den läser `verify` ur sidecaren).
 *   4. De som fortfarande underkänns LIGGER KVAR i karantän.
 *
 * Det är en engångsoperation per regeländring — inte en automatik.
 *
 * Kör:
 *   node --env-file=.env --import tsx scripts/word_image_promote.ts
 *   node --env-file=.env --import tsx scripts/word_image_promote.ts --dry-run
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyImageFile, verdictPasses, verdictReason } from './lib/word-image-verdict.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORD_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2', 'word');
const QUAR_DIR = path.join(PROJECT_ROOT, 'local_image_library_stamped_v2_word_quarantine');
const REPORT_DIR = path.join(PROJECT_ROOT, 'runtime', 'verification-reports');

const IS_DRY = process.argv.includes('--dry-run');
const CONCURRENCY = 3;

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw) return raw;
  try {
    const m = readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}
const KEY = env('MINIMAX_API_KEY');

interface Sidecar {
  ord?: string;
  image_key?: string;
  meaning?: string;
  stam?: string;
  verify?: unknown;
  verified_ok?: boolean;
  verified_match?: boolean;
  verified_appropriate?: boolean;
  verified_text?: string;
  verified_foreground_face?: boolean;
  [k: string]: unknown;
}

async function main() {
  if (!KEY) { console.error('FEL: MINIMAX_API_KEY saknas'); process.exit(2); }
  if (!existsSync(QUAR_DIR)) { console.log('Ingen karantänkatalog — inget att göra.'); return; }
  mkdirSync(WORD_DIR, { recursive: true });

  const files = readdirSync(QUAR_DIR).filter((f) => f.endsWith('.webp')).sort();
  console.log(`[promote] karantänbilder: ${files.length}`);

  // Nycklar som redan har en godkänd bild i biblioteksmappen. Utan detta
  // skulle en gammal karantänbild kunna släppas in bredvid en nyare bild för
  // samma ord — och tilldelningen plockar bara en av dem, godtyckligt.
  const takenKeys = new Set<string>();
  if (existsSync(WORD_DIR)) {
    for (const f of readdirSync(WORD_DIR).filter((x) => x.endsWith('.webp'))) {
      const side = path.join(WORD_DIR, `${f}.json`);
      let key = f.split('__')[0].toLowerCase();
      if (existsSync(side)) {
        try {
          const j = JSON.parse(readFileSync(side, 'utf8')) as Sidecar;
          key = String(j.image_key ?? key).toLowerCase();
        } catch { /* trasig sidecar → använd filnamnet */ }
      }
      takenKeys.add(key);
    }
  }
  console.log(`[promote] ord som redan har en godkänd bild: ${takenKeys.size}`);

  const promoted: string[] = [];
  const superseded: string[] = [];
  const stillFailing: Array<{ ord: string; why: string }> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const f = files[cursor++];
      if (!f) return;
      const qFile = path.join(QUAR_DIR, f);
      const qSide = `${qFile}.json`;
      if (!existsSync(qSide)) { console.log(`  [hoppar] ${f} — ingen sidecar`); continue; }

      const j = JSON.parse(readFileSync(qSide, 'utf8')) as Sidecar;
      const ord = String(j.ord ?? f.split('__')[0]);
      const meaning = String(j.meaning ?? j.stam ?? ord);
      const key = String(j.image_key ?? f.split('__')[0]).toLowerCase();

      // Ord som redan har en godkänd bild: den gamla karantänbilden är
      // överflödig. Den lämnas i karantän (som bevis) och räknas inte.
      if (takenKeys.has(key)) { superseded.push(ord); continue; }

      const verdict = await verifyImageFile(qFile, ord, meaning, KEY!, (j.exempel_titlar as string[]) ?? []);
      if (!verdict) { stillFailing.push({ ord, why: 'ingen granskning' }); continue; }

      if (!verdictPasses(verdict)) {
        stillFailing.push({ ord, why: verdictReason(verdict) });
        console.log(`  [FEL ] ${ord.padEnd(16)} ${verdictReason(verdict)}`);
        continue;
      }

      // Blicka INTE före granskningen — bara den sista granskningen gäller.
      j.verify = verdict;
      j.verified_ok = true;
      j.verified_match = verdict.match;
      j.verified_appropriate = verdict.appropriate;
      j.verified_text = verdict.text;
      j.verified_foreground_face = verdict.foreground_face;
      j.reverified_at = new Date().toISOString();

      const target = path.join(WORD_DIR, f);
      if (existsSync(target)) {
        // Namnkollision: lägg till en tidsstämpel så ingen bild skrivs över.
        const stamped = path.join(WORD_DIR, `${f.split('__')[0]}__p${Date.now().toString(36)}.webp`);
        if (IS_DRY) { console.log(`  [dry ] ${ord} → ${path.basename(stamped)}`); }
        else {
          renameSync(qFile, stamped);
          renameSync(qSide, `${stamped}.json`);
          writeFileSync(`${stamped}.json`, JSON.stringify(j, null, 2));
        }
        promoted.push(ord);
        console.log(`  [OK  ] ${ord.padEnd(16)} conf=${verdict.confidence.toFixed(2)} → ${path.basename(stamped)}`);
        continue;
      }

      if (IS_DRY) {
        console.log(`  [dry ] ${ord} → ${f}`);
      } else {
        renameSync(qFile, target);
        renameSync(qSide, `${target}.json`);
        writeFileSync(`${target}.json`, JSON.stringify(j, null, 2));
      }
      promoted.push(ord);
      takenKeys.add(key);
      console.log(`  [OK  ] ${ord.padEnd(16)} conf=${verdict.confidence.toFixed(2)} → ${f}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = path.join(REPORT_DIR, `word-promote-${stamp}.json`);
  writeFileSync(report, JSON.stringify({
    promote: 'word-images', at: new Date().toISOString(), dryRun: IS_DRY,
    inspected: files.length, promoted, superseded, stillFailing,
  }, null, 2));

  console.log(`\n[promote] ${IS_DRY ? 'dry-run — ' : ''}släppta in: ${promoted.length} / ${files.length}`);
  console.log(`[promote] överkörda av nyare bild: ${superseded.length}`);
  console.log(`[promote] kvar i karantän: ${stillFailing.length}`);
  console.log(`[promote] rapport: ${report}`);
}

main().catch((e) => { console.error('FEL:', e); process.exit(1); });
