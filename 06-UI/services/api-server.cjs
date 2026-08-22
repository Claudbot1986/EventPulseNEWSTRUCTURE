#!/usr/bin/env node
/**
 * EventPulse API wrapper — canonical read path for UI and tools.
 * Port 7777 (override with EVENTPULSE_API_PORT).
 *
 * GET /supabase-events?limit=200&offset=0&days=365&source=
 * GET /health
 */

const http = require('node:http');
const { URL } = require('node:url');
const path = require('node:path');
const { fetchCanonicalEvents } = require('./eventsCanonical.cjs');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch {
  // dotenv optional
}

const PORT = Number(process.env.EVENTPULSE_API_PORT || process.env.PORT || 7777);
const HOST = process.env.EVENTPULSE_API_HOST || '0.0.0.0';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

async function handleSupabaseEvents(url) {
  const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
  const offset = Number(url.searchParams.get('offset') || 0);
  const days = Number(url.searchParams.get('days') || 365);
  const source = url.searchParams.get('source') || null;
  const city = url.searchParams.get('city') || 'Stockholm';

  const result = await fetchCanonicalEvents({ limit, offset, days, source, city });
  return result;
}

async function handleHealth() {
  try {
    const sample = await fetchCanonicalEvents({ limit: 1, offset: 0 });
    return {
      status: 'ok',
      supabase: 'connected',
      total_published_events: sample.total_published_events,
      port: PORT,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      supabase: 'error',
      error: error.message,
      port: PORT,
      timestamp: new Date().toISOString(),
    };
  }
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
      return sendJson(res, 200, await handleHealth());
    }

    if (url.pathname === '/supabase-events') {
      const result = await handleSupabaseEvents(url);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, {
      error: 'Not found',
      endpoints: ['/health', '/supabase-events'],
    });
  } catch (error) {
    console.error('[api-server]', error);
    return sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n📡 EventPulse API wrapper`);
  console.log(`   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`   GET /supabase-events  — canonical events (Supabase)`);
  console.log(`   GET /health\n`);
});
