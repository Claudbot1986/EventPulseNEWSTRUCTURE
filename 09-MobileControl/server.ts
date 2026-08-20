/**
 * server.ts — Express + SSE control plane for Phase 2.
 *
 * Architecture (per user spec):
 *   PHONE → (Tailscale) → MOBILE CONTROL SERVER (this) → reads Phase 1 state → REST/SSE
 *
 * REST endpoints (all /api/* require MOBILE_CONTROL_TOKEN):
 *   GET  /                      → dashboard HTML
 *   GET  /api/status            → full StateSnapshot (wrapper + tasks + commits + activity)
 *   GET  /api/activity          → recent activity stream entries
 *   GET  /api/logs?tail=N       → last N lines of loop.log
 *   GET  /api/terminal          → tmux pane content (live)
 *   POST /api/terminal/send     → body {keys} → tmux send-keys
 *   POST /api/instruct          → body {message} → append to runtime/instructions/pending.md
 *   POST /api/tasks             → body {priority, title, verify} → append T<NNNN> to task queue
 *   POST /api/pause             → touch STOP file → wrapper exits on next check
 *   POST /api/resume            → spawn tmux session running autonomous-loop.sh
 *   GET  /api/stream            → SSE: pushes new state every 2s
 *   GET  /health                → tmux_available + tmux_running (no auth)
 *
 * Bind default: 127.0.0.1 (Tailscale tailscale0 interface on user's machine).
 * Override via MOBILE_CONTROL_BIND env.
 *
 * Port default: 8788 (agent is on 8787, scraping dashboard on 7777).
 */

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  readSnapshot,
  readActivity,
  loopLogPath,
  projectRoot,
  type StateSnapshot,
} from './state.ts';
import { recordEvent } from './activity.ts';
import { requireToken, attachToken } from './auth.ts';
import {
  capturePane,
  isTmuxRunning,
  sendKeys,
  spawnSession,
  tmuxAvailable,
} from './tmux.ts';

const PORT = Number(process.env.MOBILE_CONTROL_PORT ?? 8788);
const BIND = process.env.MOBILE_CONTROL_BIND ?? '127.0.0.1';
const TMUX_SESSION_PUBLIC = 'eventpulse';

function instructionsPath(): string {
  return join(projectRoot(), 'runtime/instructions/pending.md');
}

function stopFilePath(): string {
  return join(projectRoot(), 'runtime/autonomous-loop/STOP');
}

function ensureRuntimeDirs(): void {
  for (const dir of [
    join(projectRoot(), 'runtime/autonomous-loop'),
    join(projectRoot(), 'runtime/instructions'),
    join(projectRoot(), '09-MobileControl/runtime'),
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function readTail(path: string, n: number): string {
  if (!existsSync(path)) return '';
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

function appendTaskToQueue(opts: {
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  verify: string;
}): { id: string } {
  const queuePath = join(
    projectRoot(),
    '00-Vault/01-Projects/EventPulse/02-Operations/23-Active-Task-Queue.md'
  );
  if (!existsSync(queuePath)) throw new Error('queue file missing');

  const existing = readFileSync(queuePath, 'utf-8');
  const ids = [...existing.matchAll(/_(T\d{4})_/g)].map((m) =>
    Number.parseInt(m[1].slice(1), 10)
  );
  const next = (ids.length ? Math.max(...ids) : 0) + 1;
  const id = `T${String(next).padStart(4, '0')}`;

  const block = `\n_${id}_ — **${opts.title}** — ${opts.title}\n  *Verify:* ${opts.verify}\n  *Source:* discovered (mobile dashboard)\n  *Status:* \`pending\`\n`;

  const targetSection = `### ${opts.priority}`;
  const re = new RegExp(`^${targetSection}[^\\n]*$`, 'm');
  const match = existing.match(re);
  if (!match || match.index === undefined) {
    throw new Error(`section ${targetSection} not found`);
  }
  const after = existing.slice(match.index + match[0].length);
  const nextSectionIdx = after.search(/^### /m);
  const insertAt =
    nextSectionIdx === -1
      ? match.index + match[0].length
      : match.index + match[0].length + nextSectionIdx;

  const newContent =
    existing.slice(0, insertAt) + '\n' + block + existing.slice(insertAt);
  writeFileSync(queuePath, newContent);
  return { id };
}

function buildApp(): express.Application {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(attachToken);

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(join(projectRoot(), '09-MobileControl/public/index.html'));
  });
  app.get('/style.css', (_req: Request, res: Response) => {
    res
      .type('text/css')
      .sendFile(join(projectRoot(), '09-MobileControl/public/style.css'));
  });
  app.get('/dashboard.js', (_req: Request, res: Response) => {
    res
      .type('application/javascript')
      .sendFile(join(projectRoot(), '09-MobileControl/public/dashboard.js'));
  });

  app.use('/api', requireToken);

  app.get('/api/status', (_req: Request, res: Response) => {
    const snap: StateSnapshot = readSnapshot();
    res.json(snap);
  });

  app.get('/api/activity', (req: Request, res: Response) => {
    const n = Math.min(Number(req.query.limit ?? 50), 200);
    res.json({ entries: readActivity(n) });
  });

  app.get('/api/logs', (req: Request, res: Response) => {
    const n = Math.min(Number(req.query.tail ?? 50), 500);
    res.type('text/plain').send(readTail(loopLogPath(), n));
  });

  app.get('/api/terminal', (_req: Request, res: Response) => {
    if (!tmuxAvailable()) {
      res.status(503).json({ error: 'tmux not installed' });
      return;
    }
    res.json({
      tmux_running: isTmuxRunning(),
      pane: capturePane(200),
    });
  });

  app.post('/api/terminal/send', (req: Request, res: Response) => {
    const keys = String(req.body?.keys ?? '');
    if (!keys) {
      res.status(400).json({ error: 'keys required' });
      return;
    }
    const ok = sendKeys(keys);
    res.json({ ok });
  });

  app.post('/api/instruct', (req: Request, res: Response) => {
    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'message required' });
      return;
    }
    const path = instructionsPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    const stamp = new Date().toISOString();
    appendFileSync(path, `\n## ${stamp} (from mobile)\n\n${message}\n`);
    recordEvent({
      type: 'user_instruction_received',
      detail: `queued via mobile dashboard (${message.slice(0, 80)})`,
    });
    recordEvent({
      type: 'instruction_queued',
      detail: `written to ${path}`,
      meta: { path },
    });
    res.json({ ok: true, queued_to: path, length: message.length });
  });

  app.post('/api/tasks', (req: Request, res: Response) => {
    const priority = String(req.body?.priority ?? 'P3') as
      | 'P0'
      | 'P1'
      | 'P2'
      | 'P3';
    const title = String(req.body?.title ?? '').trim();
    const verify = String(req.body?.verify ?? '').trim();
    if (!title) {
      res.status(400).json({ error: 'title required' });
      return;
    }
    try {
      const { id } = appendTaskToQueue({
        priority,
        title,
        verify: verify || 'manual verification required',
      });
      recordEvent({
        type: 'task_added',
        detail: `${id} ${title} (${priority})`,
        meta: { id, priority, title },
      });
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/pause', (_req: Request, res: Response) => {
    const path = stopFilePath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    recordEvent({
      type: 'autonomous_run_paused',
      detail: 'STOP file written via mobile dashboard',
    });
    res.json({ ok: true, stop_file: path });
  });

  app.post('/api/resume', (_req: Request, res: Response) => {
    const path = stopFilePath();
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // best-effort
      }
    }
    if (!tmuxAvailable()) {
      res
        .status(503)
        .json({ error: 'tmux not installed — start autonomous-loop manually' });
      return;
    }
    const ok = spawnSession(projectRoot());
    if (!ok) {
      res.status(500).json({ error: 'failed to spawn tmux session' });
      return;
    }
    recordEvent({
      type: 'autonomous_run_resumed',
      detail: 'tmux session spawned via mobile dashboard',
    });
    res.json({ ok: true, tmux: TMUX_SESSION_PUBLIC });
  });

  app.get('/api/stream', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = () => {
      try {
        const snap = readSnapshot();
        res.write(`data: ${JSON.stringify(snap)}\n\n`);
      } catch (err) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`
        );
      }
    };
    send();
    const iv = setInterval(send, 2000);
    req.on('close', () => {
      clearInterval(iv);
    });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      tmux_available: tmuxAvailable(),
      tmux_running: isTmuxRunning(),
    });
  });

  return app;
}

function main(): void {
  ensureRuntimeDirs();

  const t = process.env.MOBILE_CONTROL_TOKEN;
  if (!t || t.length < 16) {
    console.error(
      '[09-MobileControl] MOBILE_CONTROL_TOKEN missing or too short (<16 chars).\n' +
        'Generate one: openssl rand -hex 32\n' +
        'Then export MOBILE_CONTROL_TOKEN=<that-string> before starting.'
    );
    process.exit(2);
  }

  const app = buildApp();
  app.listen(PORT, BIND, () => {
    console.log(`[09-MobileControl] listening on http://${BIND}:${PORT}`);
    console.log(`[09-MobileControl] bind=${BIND}  tmux=${tmuxAvailable()}`);
    console.log(`[09-MobileControl] token required for all /api/* endpoints`);
    recordEvent({
      type: 'autonomous_run_started',
      detail: `mobile control server started on ${BIND}:${PORT}`,
    });
  });
}

const isMainModule = (() => {
  try {
    const url = new URL(import.meta.url);
    return (
      process.argv[1] &&
      url.pathname === new URL(`file://${process.argv[1]}`).pathname
    );
  } catch {
    return true;
  }
})();

if (isMainModule) {
  main();
}

export { buildApp };