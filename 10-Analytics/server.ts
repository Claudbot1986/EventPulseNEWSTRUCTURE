/**
 * server.ts — Express HTTP server for the EventPulse analytics backend.
 *
 * Listens on port 7778 (configurable via PORT env). Four surfaces:
 *
 *   1. Public ingest    — POST /api/events (anonymous, device_id_hash only)
 *   2. Admin (bearer)   — GET  /api/events, GET /api/stats
 *   3. Public dashboard — GET  /dashboard, GET /api/health
 *   4. GDPR rights      — GET  /api/gdpr/export, POST /api/gdpr/erase, POST /api/gdpr/opt-out
 *
 * Persistence is JSONL via storage.ts. Supabase swap is a Phase 2 concern.
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { eventSchema, type StoredEvent } from './analytics.js';
import {
  persistEvent,
  readEvents,
  storageStats,
} from './storage.js';
import {
  exportForDevice,
  eraseForDevice,
  isValidDeviceHash,
  retentionDays,
} from './gdpr.js';
import { requireBearer } from './auth.js';

const PORT = Number(process.env.PORT || 7778);
const PUBLIC_DIR = './public';

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// JSON body parser — analytics events are small.
app.use(express.json({ limit: '64kb' }));

// Permissive CORS for localhost dev. The Expo app and the dashboard both
// run on dev machines and need to talk to this server.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Request log — terse, one line per request.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.warn(`[analytics] ${req.method} ${req.url} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ---------------------------------------------------------------------------
// Public ingest
// ---------------------------------------------------------------------------

/**
 * POST /api/events
 * Public. Authenticates the caller only by the device_id_hash in the body
 * (pseudonymous). No bearer token required — this is the fire-and-forget
 * client path.
 *
 * Body must validate against eventSchema in analytics.ts.
 * Returns 204 on success, 400 on schema failure, 500 on storage failure.
 */
app.post('/api/events', async (req: Request, res: Response) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_event',
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }

  const now = new Date().toISOString();
  const event: StoredEvent = {
    ...parsed.data,
    ts: now,
    received_at: now,
  };

  try {
    await persistEvent(event);
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[analytics] persistEvent failed:', message);
    res.status(500).json({ error: 'persist_failed' });
  }
});

// ---------------------------------------------------------------------------
// Admin endpoints (bearer token required)
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10_000).default(1000),
  since: z.string().datetime().optional(),
});

/**
 * GET /api/events?limit=1000&since=2026-08-01T00:00:00Z
 * Admin. Returns the most recent N events (default 1000).
 */
app.get('/api/events', requireBearer, async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_query',
      issues: parsed.error.issues,
    });
    return;
  }
  try {
    const events = await readEvents({
      limit: parsed.data.limit,
      since: parsed.data.since,
    });
    res.json({
      success: true,
      data: events,
      meta: {
        count: events.length,
        limit: parsed.data.limit,
        since: parsed.data.since ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: 'read_failed', message });
  }
});

/**
 * GET /api/stats
 * Admin. Storage health — bytes on disk + event count. The dashboard
 * polls this to populate the header.
 */
app.get('/api/stats', requireBearer, async (_req: Request, res: Response) => {
  try {
    const stats = await storageStats();
    res.json({
      success: true,
      data: {
        ...stats,
        retention_days: retentionDays(),
        phase: 1,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: 'stats_failed', message });
  }
});

// ---------------------------------------------------------------------------
// Public dashboard + health
// ---------------------------------------------------------------------------

/**
 * Static assets under /dashboard (dashboard.js, style.css, etc.) are
 * served from ./public. The exact-match /dashboard route below returns
 * the HTML index.
 */
app.use('/dashboard', express.static(PUBLIC_DIR));

/**
 * GET /dashboard — serves the analytics dashboard UI.
 * Falls back to an inline minimal HTML if public/index.html is absent.
 */
app.get('/dashboard', (_req: Request, res: Response) => {
  const indexPath = join(PUBLIC_DIR, 'index.html');
  if (existsSync(indexPath)) {
    res.type('html').send(readFileSync(indexPath, 'utf8'));
    return;
  }
  res.type('html').send(INLINE_DASHBOARD_HTML);
});

/**
 * GET /api/health — liveness probe. No auth.
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, phase: 1, port: PORT, ts: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// GDPR endpoints (public — caller proves identity via device_id_hash)
// ---------------------------------------------------------------------------

/**
 * GET /api/gdpr/export?device_id_hash=...
 * Returns all events for the device. The hash itself is the auth — only
 * the device owner knows it.
 */
app.get('/api/gdpr/export', async (req: Request, res: Response) => {
  const deviceHash = req.query.device_id_hash;
  if (typeof deviceHash !== 'string' || !isValidDeviceHash(deviceHash)) {
    res.status(400).json({ error: 'invalid_device_id_hash' });
    return;
  }
  try {
    const events = await exportForDevice(deviceHash);
    res.json({
      success: true,
      data: events,
      meta: {
        device_id_hash: deviceHash,
        count: events.length,
        exported_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: 'export_failed', message });
  }
});

const eraseBodySchema = z.object({
  device_id_hash: z.string().regex(/^[a-f0-9]{64}$/),
});

/**
 * POST /api/gdpr/erase  body: { device_id_hash }
 * Deletes all events for the device. Returns the deletion count.
 */
app.post('/api/gdpr/erase', async (req: Request, res: Response) => {
  const parsed = eraseBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_body',
      issues: parsed.error.issues,
    });
    return;
  }
  try {
    const deleted = await eraseForDevice(parsed.data.device_id_hash);
    res.json({
      success: true,
      data: {
        device_id_hash: parsed.data.device_id_hash,
        deleted,
        erased_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: 'erase_failed', message });
  }
});

/**
 * POST /api/gdpr/opt-out  body: { device_id_hash }
 * Public endpoint that acknowledges opt-out. The actual stop-list is a
 * Phase 2 concern (Supabase opt_out table). For now we acknowledge 200.
 */
app.post('/api/gdpr/opt-out', (req: Request, res: Response) => {
  const deviceHash = (req.body as { device_id_hash?: unknown })?.device_id_hash;
  if (typeof deviceHash !== 'string' || !isValidDeviceHash(deviceHash)) {
    res.status(400).json({ error: 'invalid_device_id_hash' });
    return;
  }
  // TODO Phase 2: persist opt-out flag in Supabase opt_out table.
  res.json({
    success: true,
    data: {
      device_id_hash: deviceHash,
      opted_out_at: new Date().toISOString(),
      note: 'acknowledged — ingest gate is Phase 2',
    },
  });
});

// ---------------------------------------------------------------------------
// Inline dashboard fallback
// ---------------------------------------------------------------------------

const INLINE_DASHBOARD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>EventPulse Analytics</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        background: #000;
        color: #e5e5e5;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        padding: 24px;
      }
      h1 { font-size: 18px; margin: 0 0 16px; }
      .stat { font-size: 14px; opacity: 0.8; margin-bottom: 24px; }
      code { background: #111; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>EventPulse Analytics</h1>
    <p class="stat">
      Public dashboard file not yet provisioned. Use
      <code>GET /api/stats</code> with <code>Authorization: Bearer &lt;ANALYTICS_TOKEN&gt;</code>.
    </p>
  </body>
</html>`;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.warn(`[analytics] listening on http://localhost:${PORT}`);
  console.warn(`[analytics] dashboard:  http://localhost:${PORT}/dashboard`);
  console.warn(`[analytics] ingest:     POST http://localhost:${PORT}/api/events`);
  console.warn(`[analytics] admin auth: Bearer <ANALYTICS_TOKEN>`);
  console.warn(`[analytics] retention:  ${retentionDays()} days`);
});
