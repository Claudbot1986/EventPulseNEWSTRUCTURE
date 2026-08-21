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
 * Accepts either:
 *   - A single event:        { event_type, page, payload, device_id_hash, session_id }
 *   - A batch of events:     { events: [...] }
 *
 * Returns 204 on success (all events persisted), 207 if some failed,
 * 400 on total schema failure, 500 on storage failure.
 */
app.post('/api/events', async (req: Request, res: Response) => {
  const body = req.body;

  // Normalize to array.
  let rawEvents: unknown[];
  if (Array.isArray(body)) {
    rawEvents = body;
  } else if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).events)) {
    rawEvents = (body as { events: unknown[] }).events;
  } else {
    // Treat as a single event.
    rawEvents = [body];
  }

  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    res.status(400).json({ error: 'invalid_body', message: 'expected event or { events: [...] }' });
    return;
  }

  const now = new Date().toISOString();
  const results: { index: number; ok: boolean; error?: string }[] = [];
  let storageFailed = false;

  for (let i = 0; i < rawEvents.length; i++) {
    const parsed = eventSchema.safeParse(rawEvents[i]);
    if (!parsed.success) {
      results.push({
        index: i,
        ok: false,
        error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      });
      continue;
    }
    const event: StoredEvent = { ...parsed.data, ts: now, received_at: now };
    try {
      await persistEvent(event);
      results.push({ index: i, ok: true });
    } catch (err) {
      storageFailed = true;
      results.push({
        index: i,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length === results.length) {
    // Total failure — 400 so the client knows to retry the whole batch.
    res.status(400).json({ error: 'invalid_event', failures });
    return;
  }
  if (failures.length > 0) {
    // Partial failure — 207 so the client can reconcile.
    res.status(207).json({ error: 'partial_failure', results });
    return;
  }
  res.status(204).end();
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

/**
 * GET /api/metrics/top-strip
 * Admin. Returns aggregate KPIs for the dashboard top-strip:
 *   - dau: unique devices in last 24h
 *   - wau: unique devices in last 7d
 *   - mau: unique devices in last 30d
 *   - stickiness: dau/wau ratio (0-1)
 *   - save_rate: event_save / event_view over last 7d
 *   - last_seen: ISO timestamp of most recent event
 *
 * Reads ALL events from JSONL once; small dataset (Phase 1). Phase 2
 * switches to SQL aggregates.
 */
app.get('/api/metrics/top-strip', requireBearer, async (_req: Request, res: Response) => {
  try {
    const events = await readEvents({});
    if (events.length === 0) {
      res.json({
        success: true,
        data: {
          dau: 0, wau: 0, mau: 0,
          stickiness: 0,
          save_rate: null,
          last_seen: null,
          window_events: 0,
        },
      });
      return;
    }
    const now = Date.now();
    const day = 86_400_000;
    const dayCutoff = new Date(now - 1 * day).toISOString();
    const weekCutoff = new Date(now - 7 * day).toISOString();
    const monthCutoff = new Date(now - 30 * day).toISOString();

    const dau = new Set<string>();
    const wau = new Set<string>();
    const mau = new Set<string>();
    let saves = 0;
    let views = 0;
    let lastSeen = '';
    for (const ev of events) {
      if (!ev.device_id_hash) continue;
      if (ev.ts >= dayCutoff) dau.add(ev.device_id_hash);
      if (ev.ts >= weekCutoff) {
        wau.add(ev.device_id_hash);
        if (ev.event_type === 'event_save') saves++;
        if (ev.event_type === 'event_view') views++;
      }
      if (ev.ts >= monthCutoff) mau.add(ev.device_id_hash);
      if (!lastSeen || ev.ts > lastSeen) lastSeen = ev.ts;
    }
    const stickiness = wau.size > 0 ? dau.size / wau.size : 0;
    const saveRate = views > 0 ? saves / views : null;

    res.json({
      success: true,
      data: {
        dau: dau.size,
        wau: wau.size,
        mau: mau.size,
        stickiness: Number(stickiness.toFixed(3)),
        save_rate: saveRate === null ? null : Number(saveRate.toFixed(3)),
        last_seen: lastSeen || null,
        window_events: events.filter((e) => e.ts >= weekCutoff).length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    res.status(500).json({ error: 'metrics_failed', message });
  }
});

// ---------------------------------------------------------------------------
// Public dashboard + health
// ---------------------------------------------------------------------------

/**
 * GET /dashboard — serves the analytics dashboard UI.
 * Registered before the static mount so the exact path is handled
 * without an express.static directory redirect.
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
 * Static assets under /dashboard (dashboard.js, style.css, etc.) served
 * from ./public.
 */
app.use('/dashboard', express.static(PUBLIC_DIR));

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
