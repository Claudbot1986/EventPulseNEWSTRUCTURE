/**
 * 08-Agent/scripts/generate_ai_image_flux_smoketest — Step A smoketest
 * batch generator using BFL Flux Schnell.
 *
 * Run from project root:
 *   npx tsx --env-file=.env 08-Agent/scripts/generate_ai_image_flux_smoketest.ts --limit=10
 *
 * What it does:
 *   1. Pulls the next 10 upcoming events from events_public (ordered by
 *      start_time ASC). Idempotent per provider: skips events that
 *      already have a Flux entry in index.json (OpenAI entries don't
 *      block Flux from also processing the same event).
 *   2. For each event, calls buildSafePrompt → generateOneFlux → addWatermark.
 *   3. Writes <outDir>/flux-images/<event_id>.png + appends to index.json.
 *   4. Logs any per-event failures to errors.flux.jsonl and continues.
 *
 * NEVER mutates Supabase. Reads events_public only.
 *
 * Differs from `generate_ai_image_smoketest.ts` (the OpenAI variant) by:
 *   - Imports `generateOneFlux` (BFL provider) instead of `generateOne`
 *   - Writes images under `flux-images/` subdir (not `images/`)
 *   - Marks every entry with `model: 'flux-schnell'` so the combined
 *     preview page can distinguish the two providers
 *   - Idempotency is per-provider, not global
 */

import path from 'node:path';
import fs from 'node:fs/promises';

import {
  buildSafePrompt,
} from '../tools/ai_image';
import { applyAiCompliance } from '../tools/ai_compliance';
import { generateOneFlux } from '../tools/ai_image_flux';
import type { AiImageManifest } from '../types/ai_image';
import {
  parseArgs,
  loadIndex,
  saveIndex,
  appendError,
  rowToInput,
  createSupabase,
  fetchUpcomingEvents,
  buildEntry,
  entriesForModel,
} from './smoketest_lib';

const FLUX_MODEL = 'flux-2-klein-4b';
const FLUX_IMAGES_SUBDIR = 'flux-images';

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  // Default to a sibling dir of the OpenAI smoketest if the user didn't
  // pass --out. The combined preview.html can then reference both.
  if (!process.env.AI_IMAGE_SMOKETEST_DIR) {
    args.outDir = path.resolve(process.cwd(), 'runtime', 'ai-image-smoketest');
  }

  const imagesDir = path.join(args.outDir, FLUX_IMAGES_SUBDIR);
  const indexPath = path.join(args.outDir, 'index.json');
  const errorsPath = path.join(args.outDir, 'errors.flux.jsonl');

  await fs.mkdir(imagesDir, { recursive: true });

  // Load existing manifest for idempotency.
  const manifest: AiImageManifest = args.force
    ? { version: 1, entries: [] }
    : await loadIndex(indexPath);

  // Idempotency is per-provider: an event already in the manifest under
  // 'gpt-image-1' should still be processed by Flux. We only skip entries
  // that already have a Flux result.
  const fluxDone = entriesForModel(manifest, FLUX_MODEL);

  // Supabase connection.
  const supabase = createSupabase();

  console.log(`[flux-smoketest] fetching up to ${args.limit} upcoming events from events_public…`);
  const rows = await fetchUpcomingEvents(supabase, args.limit);

  const todo = rows
    .filter((r) => r.id && !fluxDone.has(r.id))
    .slice(0, args.limit);

  console.log(
    `[flux-smoketest] ${rows.length} fetched, ${fluxDone.size} already done (Flux), ` +
      `${todo.length} to process (max_cost=$${args.maxCostUsd.toFixed(2)})`,
  );

  let generated = 0;
  let skipped = 0;
  let totalCost = 0;
  const startMs = Date.now();

  for (const row of todo) {
    const input = rowToInput(row);
    const safe = buildSafePrompt(input);

    console.log(
      `[flux-smoketest] ${input.id.slice(0, 8)}… ` +
        `"${input.title.slice(0, 40)}" (${input.category_slug || 'no-cat'}) ` +
        `hash=${safe.prompt_hash} fallback=${safe.fallback_used}`,
    );

    try {
      const gen = await generateOneFlux({
        prompt: safe.prompt,
        negative_prompt: safe.negative_prompt,
      });
      // EU AI Act Art. 50 disclosure: synlig stämpel + XMP-metadata.
      // applyAiCompliance ersätter addWatermark (som bara satte EXIF —
      // inte maskinkläsbar XMP, och täckte bara ~50 % av Art. 50-kraven).
      const watermarked = await applyAiCompliance({
        buffer: gen.png_bytes,
        prompt: safe.prompt,
        model: FLUX_MODEL,
      });

      const { entry, relativeImagePath } = buildEntry({
        input,
        promptHash: safe.prompt_hash,
        model: FLUX_MODEL,
        costUsd: gen.cost_usd,
        imageSubdir: FLUX_IMAGES_SUBDIR,
      });
      const absoluteImagePath = path.join(args.outDir, relativeImagePath);
      await fs.writeFile(absoluteImagePath, watermarked);

      manifest.entries.push(entry);
      generated += 1;
      totalCost += gen.cost_usd ?? 0;

      console.log(
        `  ✓ generated ${watermarked.length.toLocaleString()} bytes ` +
          `(model=${FLUX_MODEL}, cost=$${(gen.cost_usd ?? 0).toFixed(4)})`,
      );

      if (totalCost > args.maxCostUsd) {
        console.log(`[flux-smoketest] cost cap reached ($${totalCost.toFixed(2)}) — stopping batch`);
        break;
      }
    } catch (err: unknown) {
      skipped += 1;
      const msg = err instanceof Error ? err.message : 'unknown error';
      console.error(`  ✗ skipped: ${msg}`);
      await appendError(errorsPath, {
        event_id: input.id,
        title: input.title,
        error: msg,
        at: new Date().toISOString(),
      });
    }
  }

  await saveIndex(indexPath, manifest);

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('');
  console.log(`[flux-smoketest] DONE in ${elapsedSec}s`);
  console.log(`  generated: ${generated}`);
  console.log(`  skipped:   ${skipped}`);
  console.log(`  total entries in index.json: ${manifest.entries.length}`);
  console.log(`  estimated cost: $${totalCost.toFixed(4)} (cap was $${args.maxCostUsd.toFixed(2)})`);
  console.log(`  index:    ${indexPath}`);
  console.log(`  images:   ${imagesDir}`);
  console.log(`  errors:   ${errorsPath}`);
  console.log('');
  console.log(`[flux-smoketest] next step: combine with OpenAI section in preview.html,`);
  console.log(`[flux-smoketest] then start python3 -m http.server + ngrok for the public URL.`);
}

main().catch((err: unknown) => {
  console.error('[flux-smoketest] FATAL:', err);
  process.exit(1);
});