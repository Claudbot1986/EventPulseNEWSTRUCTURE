/**
 * Tests for dashboard_lifecycle.ts — start/restart the dashboard subprocess.
 *
 * Uses an isolated port + a fake "already-running" server bound to it to
 * verify wasRunning vs spawned paths without touching the real 7777 port.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { ensureDashboardRunning, readDashboardPid } from '../tools/dashboard_lifecycle';

let tmpRoot: string;
let fakeServer: Server;
let fakePort: number;

beforeEach(async () => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'dash-life-'));
  fakeServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => fakeServer.listen(0, '127.0.0.1', r));
  fakePort = (fakeServer.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((r) => fakeServer.close(() => r()));
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ensureDashboardRunning', () => {
  it('returns wasRunning=true when dashboard already responds on port', () => {
    const prevPort = process.env.PORT;
    process.env.PORT = String(fakePort);
    try {
      const result = ensureDashboardRunning(tmpRoot);
      expect(result.wasRunning).toBe(true);
      expect(result.spawned).toBe(false);
      expect(result.pid).toBeNull();
      expect(result.error).toBeNull();
    } finally {
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
    }
  });

  it('does not crash when nothing is listening on the port', () => {
    const prevPort = process.env.PORT;
    process.env.PORT = '7799';
    try {
      const result = ensureDashboardRunning(tmpRoot);
      // Either it spawned, or it failed because tsx binary path differs in test env.
      // Either way we should NOT have crashed.
      expect(result.error === null || result.spawned).toBe(true);
      // If we did spawn, the pidfile should exist with our PID
      const pidPath = resolve(tmpRoot, 'runtime/scraping-supervisor/dashboard.pid');
      if (result.spawned && result.pid !== null) {
        expect(existsSync(pidPath)).toBe(true);
        const written = readFileSync(pidPath, 'utf-8').trim();
        expect(Number(written)).toBe(result.pid);
      }
    } finally {
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
    }
  });
});

describe('readDashboardPid', () => {
  it('returns null when no pidfile exists', () => {
    expect(readDashboardPid(tmpRoot)).toBeNull();
  });

  it('returns null when pidfile is malformed', () => {
    const pidPath = resolve(tmpRoot, 'runtime/scraping-supervisor/dashboard.pid');
    mkdirSync(resolve(tmpRoot, 'runtime/scraping-supervisor'), { recursive: true });
    writeFileSync(pidPath, 'not-a-number');
    expect(readDashboardPid(tmpRoot)).toBeNull();
  });

  it('returns null when pidfile points at a dead pid', () => {
    const pidPath = resolve(tmpRoot, 'runtime/scraping-supervisor/dashboard.pid');
    mkdirSync(resolve(tmpRoot, 'runtime/scraping-supervisor'), { recursive: true });
    writeFileSync(pidPath, '999999');
    expect(readDashboardPid(tmpRoot)).toBeNull();
  });

  it('returns the pid when it points at a live process', () => {
    const pidPath = resolve(tmpRoot, 'runtime/scraping-supervisor/dashboard.pid');
    mkdirSync(resolve(tmpRoot, 'runtime/scraping-supervisor'), { recursive: true });
    writeFileSync(pidPath, String(process.pid));
    expect(readDashboardPid(tmpRoot)).toBe(process.pid);
  });
});
