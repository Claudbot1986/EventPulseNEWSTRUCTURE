/**
 * 08-Agent/middleware/ai_image_static — Step A smoketest image serving.
 *
 * Two endpoints:
 *
 *   GET /agent/ai-image/:eventId.png
 *     Serves the generated PNG from
 *     <runtime>/ai-image-smoketest/images/<eventId>.png. Sets
 *     Cache-Control: public, max-age=86400, immutable + an ETag derived
 *     from the entry's prompt_hash.
 *
 *   GET /agent/feed-ai-images
 *     Lists every successfully generated event with its image_url,
 *     prompt_hash, generated_at, and a watermark disclosure label.
 *
 * Both endpoints fail closed (404) when:
 *   - the feature flag AI_SMOKETEST_ENABLED is not '1'
 *   - the runtime index is missing
 *   - the requested event has no generated image
 *
 * This is the read side of the AI image library the Expo app pulls from.
 * The write side is `scripts/generate_ai_image_smoketest.ts`.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { Request, Response, Router } from 'express';
import express from 'express';

import type {
  AiImageManifest,
  AiImageManifestEntry,
  FeedAiImagesResponse,
} from '../types/ai_image';

// ─── Config ───────────────────────────────────────────────────────────────

/**
 * Resolve the smoketest runtime directory.
 *
 * Resolution order:
 *   1. process.env.AI_IMAGE_SMOKETEST_DIR (absolute)
 *   2. <project>/runtime/ai-image-smoketest  (default — created by the script)
 *
 * The script writes here; this middleware reads here. Sharing the env var
 * lets a developer override the path for ad-hoc testing without changing
 * the server code.
 */
function resolveRuntimeDir(): string {
  const explicit = process.env.AI_IMAGE_SMOKETEST_DIR;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return path.resolve(explicit);
  }
  // Default: <project>/runtime/ai-image-smoketest
  // The project root is two levels up from this file's location
  // (08-Agent/middleware/ → 08-Agent/ → <root>).
  return path.resolve(process.cwd(), 'runtime', 'ai-image-smoketest');
}

function isSmoketestEnabled(): boolean {
  const raw = process.env.AI_SMOKETEST_ENABLED;
  return raw === '1' || raw === 'true';
}

// ─── Manifest reader (in-memory cache, refresh per request) ───────────────

let cachedManifest: { manifest: AiImageManifest | null; loadedAt: number; mtimeMs: number } = {
  manifest: null,
  loadedAt: 0,
  mtimeMs: -1,
};

/**
 * Load + cache the manifest. Returns null if the file does not exist or
 * fails to parse. The cache invalidates on file mtime change so a new
 * run of the generator script is reflected within one request — without
 * a server restart.
 */
async function loadManifest(runtimeDir: string): Promise<AiImageManifest | null> {
  const indexPath = path.join(runtimeDir, 'index.json');
  try {
    const stat = await fs.stat(indexPath);
    if (cachedManifest.manifest && cachedManifest.mtimeMs === stat.mtimeMs) {
      return cachedManifest.manifest;
    }
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as AiImageManifest;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      return null;
    }
    cachedManifest = { manifest: parsed, loadedAt: Date.now(), mtimeMs: stat.mtimeMs };
    return parsed;
  } catch {
    return null;
  }
}

// ─── ETag helper ──────────────────────────────────────────────────────────

function makeEtag(entry: AiImageManifestEntry): string {
  return `W/"ai-${entry.prompt_hash}"`;
}

// ─── Router factory ───────────────────────────────────────────────────────

export interface AiImageRouterOptions {
  /**
   * Override for the runtime dir (used by tests). Defaults to
   * resolveRuntimeDir() in production.
   */
  runtimeDir?: string;
}

export function createAiImageRouter(opts: AiImageRouterOptions = {}): Router {
  const router = express.Router();
  const runtimeDir = opts.runtimeDir ?? resolveRuntimeDir();

  // ─── GET /agent/ai-image/:eventId.png ────────────────────────────────
  // The manifest's `entry.path` is the single source of truth for the
  // on-disk location — Flux entries live at `flux-images/<uuid>.png`,
  // OpenAI entries at `images/<uuid>.png`. Previously this handler
  // hardcoded `images/${eventId}.png`, which silently 404'd for Flux.

  router.get('/ai-image/:eventId.png', async (req: Request, res: Response) => {
    if (!isSmoketestEnabled()) {
      res.status(404).json({ error: 'ai_image_smoketest_disabled' });
      return;
    }

    const eventId = typeof req.params.eventId === 'string' ? req.params.eventId : '';
    // Strict uuid check — matches the events_public.id shape and
    // prevents any path traversal via the parameter.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(eventId)) {
      res.status(400).json({ error: 'invalid event id' });
      return;
    }

    const manifest = await loadManifest(runtimeDir);
    if (!manifest) {
      res.status(404).json({ error: 'manifest_not_found' });
      return;
    }

    const entry = manifest.entries.find((e) => e.event_id === eventId);
    if (!entry) {
      res.status(404).json({ error: 'image_not_generated', event_id: eventId });
      return;
    }

    const filePath = path.join(runtimeDir, entry.path);
    // Defence in depth via path.relative() — defends against both
    // symlink escapes and `..` segments that the old startsWith()
    // check would have missed (e.g. `flux-images/../../etc/passwd`).
    const resolved = path.resolve(filePath);
    const resolvedRoot = path.resolve(runtimeDir) + path.sep;
    const rel = path.relative(resolvedRoot, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      res.status(400).json({ error: 'invalid path' });
      return;
    }

    try {
      await fs.access(resolved);
    } catch {
      res.status(404).json({ error: 'image_file_missing' });
      return;
    }

    const stat = await fs.stat(resolved);
    const etag = makeEtag(entry);

    // Honour If-None-Match for cheap 304s — the manifest updates
    // are infrequent (post-batch script run), so the client cache is
    // safe to hold for the full max-age.
    if (req.header('if-none-match') === etag) {
      res.status(304).end();
      return;
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('X-AI-Watermark', 'AI-genererad');
    res.setHeader('X-AI-Prompt-Hash', entry.prompt_hash);

    // Stream the file — sharp already wrote it; no need to buffer in
    // Node memory. Express handles the request lifecycle.
    createReadStream(resolved).pipe(res);
  });

  // ─── GET /agent/feed-ai-images ───────────────────────────────────────
  // Query params:
  //   ?provider=<model>  — filter to entries where entry.model === provider
  //                        (e.g. "flux-2-klein-4b", "gpt-image-1")
  //   ?limit=<n>         — cap response size (default 50, max 50)
  // The `model` field on each event lets the client show a per-card
  // model chip and lets the dedicated *-tab smoketest screen pin a
  // single provider.

  router.get('/feed-ai-images', async (req: Request, res: Response) => {
    if (!isSmoketestEnabled()) {
      res.status(404).json({ error: 'ai_image_smoketest_disabled' });
      return;
    }

    const manifest = await loadManifest(runtimeDir);
    if (!manifest) {
      res.status(200).json({ events: [], warnings: ['manifest_not_found'] });
      return;
    }

    const provider = typeof req.query.provider === 'string' && req.query.provider.length > 0
      ? req.query.provider
      : null;
    const limitRaw = parseInt(typeof req.query.limit === 'string' ? req.query.limit : '', 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 50;

    const filtered = provider
      ? manifest.entries.filter((e) => e.model === provider)
      : manifest.entries;
    const events = filtered.slice(0, limit).map((entry) => ({
      id: entry.event_id,
      title: entry.title,
      start_time: entry.start_time,
      venue_name: entry.venue_name,
      image_url: `/agent/ai-image/${entry.event_id}.png`,
      prompt_hash: entry.prompt_hash,
      generated_at: entry.generated_at,
      model: entry.model,
      watermark: 'AI-genererad' as const,
    }));

    const payload: FeedAiImagesResponse = { events, warnings: [] };
    res.setHeader('Cache-Control', 'no-store');
    res.json(payload);
  });

  return router;
}
