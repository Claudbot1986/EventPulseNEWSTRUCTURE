#!/usr/bin/env node
/**
 * EventPulse API wrapper — port 7777
 * GET /supabase-events  GET /health
 */

import http from 'node:http';
import { URL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCanonicalEvents } from './eventsCanonical.js';

try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
} catch {
  // optional
}

const PORT = Number(process.env.EVENTPULSE_API_PORT || process.env.PORT || 7777);
const HOST = process.env.EVENTPULSE_API_HOST || '0.0.0.0';

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/health') {
      const sample = await fetchCanonicalEvents({ limit: 1, offset: 0 });
      return sendJson(res, 200, {
        status: 'ok',
        supabase: 'connected',
        total_published_events: sample.total_published_events,
        port: PORT,
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/supabase-events') {
      const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
      const offset = Number(url.searchParams.get('offset') || 0);
      const source = url.searchParams.get('source') || null;
      const city = url.searchParams.get('city') || 'Stockholm';
      const result = await fetchCanonicalEvents({ limit, offset, source, city });
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'Not found', endpoints: ['/health', '/supabase-events'] });
  } catch (error) {
    console.error('[api-server]', error);
    return sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n📡 EventPulse API wrapper`);
  console.log(`   http://localhost:${PORT}/supabase-events`);
  console.log(`   http://localhost:${PORT}/health\n`);
});
