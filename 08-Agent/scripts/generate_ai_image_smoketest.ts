/**
 * 08-Agent/scripts/generate_ai_image_smoketest — Step A batch generator.
 *
 * Run from project root:
 *   npx tsx 08-Agent/scripts/generate_ai_image_smoketest.ts --limit=10
 *
 * What it does:
 *   1. Pulls the next 10 upcoming events from events_public (ordered by
 *      start_time ASC). Idempotent: skips events already in index.json.
 *   2. For each event, calls buildSafePrompt → generateOne → addWatermark.
 *   3. Writes <runtime>/images/<event_id>.png + appends to index.json.
 *   4. Logs any per-event failures to errors.jsonl and continues.
 *
 * NEVER mutates Supabase. Reads events_public only.
 */

import path from 'node:path';
import fs from 'node:fs/promises';

import {
  buildSafePrompt,
  generateOne,
} from '../tools/ai_image';
import { applyAiCompliance } from '../tools/ai_compliance';
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

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const imagesDir = path.join(args.outDir, 'images');
  const indexPath = path.join(args.outDir, 'index.json');
  const errorsPath = path.join(args.outDir, 'errors.jsonl');

  await fs.mkdir(imagesDir, { recursive: true });

  // Load existing manifest for idempotency.
  const manifest: AiImageManifest = args.force
    ? { version: 1, entries: [] }
    : await loadIndex(indexPath);
  // Per-provider idempotency: skip events that already have an OpenAI
  // entry (a Flux entry does NOT block OpenAI from also generating).
  const alreadyDone = entriesForModel(manifest, 'gpt-image-1');

  // Supabase connection — required for fetching the candidate events.
  const supabase = createSupabase();

  console.log(`[smoketest] fetching up to ${args.limit} upcoming events from events_public…`);
  const rows = await fetchUpcomingEvents(supabase, args.limit);

  const todo = rows
    .filter((r) => r.id && !alreadyDone.has(r.id))
    .slice(0, args.limit);

  console.log(
    `[smoketest] ${rows.length} fetched, ${alreadyDone.size} already done, ` +
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
      `[smoketest] ${input.id.slice(0, 8)}… ` +
        `"${input.title.slice(0, 40)}" (${input.category_slug || 'no-cat'}) ` +
        `hash=${safe.prompt_hash} fallback=${safe.fallback_used}`,
    );

    try {
      const gen = await generateOne({ prompt: safe.prompt, negative_prompt: safe.negative_prompt });
      // EU AI Act Art. 50 disclosure: synlig stämpel + XMP-metadata.
      // applyAiCompliance ersätter addWatermark (som bara satte EXIF —
      // inte maskinkläsbar XMP, och täckte bara ~50 % av Art. 50-kraven).
      const watermarked = await applyAiCompliance({
        buffer: gen.png_bytes,
        prompt: safe.prompt,
        model: 'gpt-image-1',
      });

      const { entry, relativeImagePath } = buildEntry({
        input,
        promptHash: safe.prompt_hash,
        model: 'gpt-image-1',
        costUsd: gen.cost_usd,
        imageSubdir: 'images',
      });
      const absoluteImagePath = path.join(args.outDir, relativeImagePath);
      await fs.writeFile(absoluteImagePath, watermarked);

      manifest.entries.push(entry);
      generated += 1;
      totalCost += gen.cost_usd ?? 0;

      console.log(
        `  ✓ generated ${watermarked.length.toLocaleString()} bytes ` +
          `(revised_prompt=${gen.revised_prompt ? 'yes' : 'no'})`,
      );

      if (totalCost > args.maxCostUsd) {
        console.log(`[smoketest] cost cap reached ($${totalCost.toFixed(2)}) — stopping batch`);
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
  console.log(`[smoketest] DONE in ${elapsedSec}s`);
  console.log(`  generated: ${generated}`);
  console.log(`  skipped:   ${skipped}`);
  console.log(`  total entries in index.json: ${manifest.entries.length}`);
  console.log(`  estimated cost: $${totalCost.toFixed(2)} (cap was $${args.maxCostUsd.toFixed(2)})`);
  console.log(`  index:    ${indexPath}`);
  console.log(`  images:   ${imagesDir}`);
  console.log(`  errors:   ${errorsPath}`);
  console.log('');
  console.log(`[smoketest] next step: set AI_SMOKETEST_ENABLED=1 and restart 08-Agent,`);
  console.log(`[smoketest] then open Expo Go on the Home tab to see the AI-bilder section.`);
}

main().catch((err: unknown) => {
  console.error('[smoketest] FATAL:', err);
  process.exit(1);
});
