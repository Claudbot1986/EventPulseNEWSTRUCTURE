#!/usr/bin/env node
/**
 * verify-census-classification.mjs — bevis för att censusen kan skilja
 * "fastnar" från "verifierat tom" (2026-10-25).
 *
 * VARFÖR: censusen listar aktiva källor med noll rader i databasen. Två
 * helt olika saker hamnar i den listan:
 *
 *   fastnar          — källan BORDE ge events. Detta är listan operatören
 *                      ska jobba ifrån.
 *   verifierat-tom   — källan har ingen eventyta. 0 rader är det riktiga
 *                      svaret, och auditen ligger i källfilens metadata.
 *
 * Om censusen alltid sa "verifierat-tom" skulle den dölja varje verklig
 * fastnad källa. Om den alltid sa "fastnar" skulle den larmar om de tre
 * källor som är utredda. Båda felen gör listan oanvändbar.
 *
 * Gaten har två delar:
 *   1. POSITIV — den riktiga censusen mot den riktiga databasen: varje
 *      nollradskälla ska ha en komplett audit (status + reason + evidence).
 *   2. NEGATIV KONTROLL — auditen tas BORT ur en kopia av registret, och
 *      samma källa ska då rapporteras som fastnar. Annars bevisar del 1
 *      ingenting.
 *
 * Kopian skrivs till en temporär katalog — produktionsregistret rörs
 * aldrig.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CENSUS = path.join(ROOT, 'scripts', 'census-zero-sources.mjs');

const failures = [];
let checksRun = 0;
function check(name, ok, detail) {
  checksRun++;
  if (ok) {
    console.log(`  ok ${name}`);
    return true;
  }
  failures.push(`${name}: ${detail}`);
  return false;
}

function runCensus(extraArgs = []) {
  const res = spawnSync(process.execPath, [CENSUS, '--json', ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`censusen avslutade med ${res.status}: ${res.stderr.slice(0, 400)}`);
  }
  return JSON.parse(res.stdout);
}

// ── 1. POSITIV: den riktiga censusen ──────────────────────────────────────
const census = runCensus();
const zero = census.zero ?? [];

check(
  'censusen rapporterar fastnar och verifierat tomma i skilda hinkar',
  typeof census.zeroStuck === 'number' && typeof census.zeroVerified === 'number',
  `JSON saknar zeroStuck/zeroVerified: ${Object.keys(census).join(',')}`,
);

check(
  `antalet nollradskällor stämmer mellan listorna (${zero.length})`,
  census.zeroStuck + census.zeroVerified === zero.length,
  `zeroStuck=${census.zeroStuck} + zeroVerified=${census.zeroVerified} != ${zero.length}`,
);

const missingAudit = zero.filter((s) => s.state === 'verifierat-tom' && !s.audit?.evidence);
check(
  'varje verifierat tom källa har bevis (audit_evidence)',
  missingAudit.length === 0,
  `saknar bevis: ${missingAudit.map((s) => s.id).join(', ')}`,
);

const mislabelled = zero.filter((s) => s.state === 'fastnar' && s.audit !== null);
check(
  'en fastnad källa har ingen audit (listorna är disjunkta)',
  mislabelled.length === 0,
  `både fastnar och audit: ${mislabelled.map((s) => s.id).join(', ')}`,
);

if (zero.length === 0) {
  console.log('  (inga nollradskällor just nu — del 2 hoppas över)');
} else {
  // ── 2. NEGATIV KONTROLL: auditen bort ur en KOPIA av registret ──────────
  const target = zero.find((s) => s.state === 'verifierat-tom') ?? zero[0];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'census-negctl-'));
  try {
    const srcDir = path.join(ROOT, 'sources');
    for (const file of fs.readdirSync(srcDir)) {
      if (!file.endsWith('.jsonl')) continue;
      fs.copyFileSync(path.join(srcDir, file), path.join(tmpDir, file));
    }

    // Ta bort auditen ur KOPIAN — produktionsfilen rörs inte.
    const targetFile = path.join(tmpDir, `${target.id}.jsonl`);
    const original = fs.readFileSync(targetFile, 'utf8');
    const parsed = JSON.parse(original.split('\n')[0]);
    if (parsed.metadata) {
      delete parsed.metadata.audit_status;
      delete parsed.metadata.audit_reason;
      delete parsed.metadata.audit_evidence;
    }
    const lines = original.split('\n');
    lines[0] = JSON.stringify(parsed);
    fs.writeFileSync(targetFile, lines.join('\n'), 'utf8');

    const negCensus = runCensus(['--sources-dir', tmpDir]);
    const negEntry = (negCensus.zero ?? []).find((s) => s.id === target.id);

    check(
      `negativ kontroll — ${target.id} utan audit rapporteras som fastnar`,
      negEntry?.state === 'fastnar',
      `state=${negEntry?.state ?? '(saknas)'} (förväntat fastnar)`,
    );
    check(
      'negativ kontroll — kopian gav samma antal nollradskällor',
      (negCensus.zero ?? []).length === zero.length,
      `kopian gav ${(negCensus.zero ?? []).length}, originalet ${zero.length}`,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`cc: FAIL ${failures.join(' | ')}`);
  process.exit(1);
}
console.log(
  `cc: censusen skiljer fastnar från verifierat tomma — fastnar=${census.zeroStuck} verifierat=${census.zeroVerified} nollrad=${zero.length} kontroller=${checksRun} pass`,
);
