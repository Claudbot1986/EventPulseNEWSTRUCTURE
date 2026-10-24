#!/usr/bin/env node
/**
 * verify-c0-root-fallback.mjs — bevis för C0:s rot-fallback.
 *
 * Bakgrund (2026-10-24). Källans URL pekar ofta på EN event-sida
 * (/evenemang/musik-show/robyn/). När evenemanget är slut ger sidan 404,
 * och C0 avslutade då med 0 kandidater FÖRE sitemap-discovery — även om
 * domänroten levde och hade en sitemap full med eventsidor.
 *
 * Mätt på riktiga spårade källor (`scripts/probe-root-fallback.mjs`):
 * 4 av 189 hade död URL men levande rot, över 3 domäner:
 *   3arenase 404→200 · aviciiarenase 404→200 ·
 *   candidate-71e94a05-aviciiarenase 404→200 · billetto-stockholm 403→200
 *
 * Gates:
 *   rf1 — LIVE: en spårad källa med död URL hittar ändå kandidater via
 *         domänroten. Kör den riktiga C0-funktionen — ingen mock.
 *
 * Negativ kontroll: `C0-htmlFrontierDiscovery.test.ts` innehåller testet
 * "avslutar med 0 kandidater när BÅDE URL:en och roten är döda", som
 * bevisar att fallbacken INTE är en "alltid lyckas"-kortslutning.
 *
 * Anropas som `npx tsx scripts/verify-c0-root-fallback.mjs <rf1>` (tsx
 * behövs för att C0-modulens extensionless TS-importer ska lösas).
 * Skriver ut `rf1: <status> pass` på stdout vid PASS, annars `rf1: FAIL …`
 * på stderr + exit 1. Utskriften matchas av GATES.md:s `EXPECT:`.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceFile } from './lib/readSourceFile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const arg = process.argv[2];

/** Källan som beviset körs mot: död URL, levande rot, och ett denom som
 *  INTE är begravd. Måste finnas kvar i sources/ — annars vore gaten
 *  tom (den mäter ingenting). */
const SOURCE_ID = 'billetto-stockholm';

function ok(msg) { console.log(msg); }
function fail(msg) { console.error(msg); process.exit(1); }

function readSource(sourceId) {
  const file = path.join(ROOT, 'sources', `${sourceId}.jsonl`);
  if (!existsSync(file)) return null;
  return readSourceFile(file);
}

// ── RF1: live — död URL, levande rot, kandidater hittas ───────────────────

if (arg === 'rf1') {
  const source = readSource(SOURCE_ID);
  if (!source) {
    fail(`rf1: källan ${SOURCE_ID} finns inte i sources/ — gaten mäter ingenting`);
  }
  if (!source.url || !source.url.startsWith('http')) {
    fail(`rf1: källan ${SOURCE_ID} har ingen användbar URL (${source.url})`);
  }

  const { discoverEventCandidates } = await import(
    path.join(ROOT, '02-Ingestion/C-htmlGate/C0-htmlFrontierDiscovery/C0-htmlFrontierDiscovery.ts')
  );

  const r = await discoverEventCandidates(source.url, undefined, SOURCE_ID);

  if (!r.rootFallbackUrl) {
    fail(
      `rf1: ingen rot-fallback skedde för ${SOURCE_ID} (${source.url}) — ` +
      `winnerReason=${r.winnerReason}. Kanske sidan svarar nu, eller så är fixen bort.`,
    );
  }
  if (r.candidatesFound <= 0) {
    fail(
      `rf1: rot-fallbacken skedde till ${r.rootFallbackUrl} men hittade 0 kandidater — ` +
      'fallbacken räddar ingenting.',
    );
  }
  if (!r.winner) {
    fail(`rf1: rot-fallbacken hittade ${r.candidatesFound} kandidater men ingen vinnare`);
  }
  ok(
    `rf1: ${SOURCE_ID} (${source.url}) föll tillbaka till ${r.rootFallbackUrl} och hittade ` +
    `${r.candidatesFound} kandidater (vinnare ${r.winner.url}) pass`,
  );
}

if (arg !== 'rf1') {
  fail('usage: node scripts/verify-c0-root-fallback.mjs <rf1>');
}
