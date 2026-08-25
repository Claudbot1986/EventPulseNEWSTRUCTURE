/**
 * 08-Agent/scripts/smoketest_lib — shared helpers for the AI image
 * smoketest generators (OpenAI + Flux).
 *
 * Extracted from `generate_ai_image_smoketest.ts` so the Flux variant
 * (`generate_ai_image_flux_smoketest.ts`) can reuse the same:
 *   - CLI arg parsing
 *   - manifest load/save (idempotent across providers via `model` tag)
 *   - Supabase row → SafePromptInput adapter
 *   - errors.jsonl appender
 *
 * Behavior is unchanged from the previous private implementations. Type
 * signatures are the contract — do not modify without coordinating with
 * both generator scripts.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type {
  AiImageManifest,
  AiImageManifestEntry,
  SafePromptInput,
} from '../types/ai_image';

// ─── CLI args ─────────────────────────────────────────────────────────────

export interface SmoketestArgs {
  limit: number;
  outDir: string;
  force: boolean;
  maxCostUsd: number;
}

export function parseArgs(argv: ReadonlyArray<string>): SmoketestArgs {
  const args: SmoketestArgs = {
    limit: 10,
    outDir: process.env.AI_IMAGE_SMOKETEST_DIR
      ? path.resolve(process.env.AI_IMAGE_SMOKETEST_DIR)
      : path.resolve(process.cwd(), 'runtime', 'ai-image-smoketest'),
    force: false,
    maxCostUsd: 1.0,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--limit' && next) {
      args.limit = Math.max(1, parseInt(next, 10) || 10);
      i++;
    } else if (a === '--out' && next) {
      args.outDir = path.resolve(next);
      i++;
    } else if (a === '--force') {
      args.force = true;
    } else if (a === '--max-cost' && next) {
      args.maxCostUsd = Math.max(0.01, parseFloat(next) || 1.0);
      i++;
    }
  }

  return args;
}

// ─── Manifest helpers ─────────────────────────────────────────────────────

export function entriesForModel(
  manifest: AiImageManifest,
  model: string,
): Set<string> {
  return new Set(
    manifest.entries
      .filter((e) => e.model === model)
      .map((e) => e.event_id),
  );
}

export async function loadIndex(indexPath: string): Promise<AiImageManifest> {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as AiImageManifest;
    if (parsed?.version === 1 && Array.isArray(parsed.entries)) return parsed;
  } catch {
    // fall through — empty manifest
  }
  return { version: 1, entries: [] };
}

export async function saveIndex(
  indexPath: string,
  manifest: AiImageManifest,
): Promise<void> {
  await fs.writeFile(indexPath, JSON.stringify(manifest, null, 2), 'utf8');
}

export async function appendError(
  errorsPath: string,
  record: Record<string, unknown>,
): Promise<void> {
  await fs.appendFile(errorsPath, `${JSON.stringify(record)}\n`, 'utf8');
}

// ─── Supabase adapter ─────────────────────────────────────────────────────

export interface EventsPublicRow {
  id: string;
  title_sv: string | null;
  title_en: string | null;
  start_time: string;
  category_slug: string | null;
  is_free: boolean | null;
  venue_id: string | null;
  venues: { name: string | null; city: string | null } | null;
}

export function rowToInput(row: EventsPublicRow): SafePromptInput {
  return {
    id: row.id,
    title: row.title_sv || row.title_en || '',
    category_slug: row.category_slug || '',
    venue_name: row.venues?.name || '',
    city: row.venues?.city || 'Stockholm',
    is_free: Boolean(row.is_free),
    start_time: row.start_time,
  };
}

export function createSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before running the smoketest generator.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function fetchUpcomingEvents(
  supabase: SupabaseClient,
  limit: number,
): Promise<EventsPublicRow[]> {
  const { data, error } = await supabase
    .from('events_public')
    .select(
      'id, title_sv, title_en, start_time, category_slug, is_free, venue_id, ' +
        'venues:venue_id(name, city)',
    )
    .gt('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(limit * 2); // fetch 2x so we still get N after skipping already-done

  if (error) {
    throw new Error(`supabase fetch failed: ${error.message}`);
  }
  return (data ?? []) as unknown as EventsPublicRow[];
}

// ─── Manifest entry builder ───────────────────────────────────────────────

export interface BuildEntryInput {
  /** Output of buildSafePrompt or rowToInput. */
  input: SafePromptInput;
  /** prompt_hash from buildSafePrompt (sha256[:16]). */
  promptHash: string;
  /** Provider tag, e.g. 'gpt-image-1' or 'flux-schnell'. */
  model: string;
  /** Per-image cost estimate (USD), null if unknown. */
  costUsd: number | null;
  /** Subdirectory under outDir for the PNG (e.g. 'images' or 'flux-images'). */
  imageSubdir: string;
}

export interface BuildEntryOutput {
  entry: AiImageManifestEntry;
  relativeImagePath: string;
}

export function buildEntry(input: BuildEntryInput): BuildEntryOutput {
  const subdir = input.imageSubdir || 'images';
  const relativeImagePath = `${subdir}/${input.input.id}.png`;
  return {
    entry: {
      event_id: input.input.id,
      title: input.input.title,
      start_time: input.input.start_time,
      venue_name: input.input.venue_name,
      path: relativeImagePath,
      prompt_hash: input.promptHash,
      generated_at: new Date().toISOString(),
      model: input.model,
      cost_usd: input.costUsd,
    },
    relativeImagePath,
  };
}

// Suppress unused-import lint for path (kept for symmetry with consumer scripts).
void path;