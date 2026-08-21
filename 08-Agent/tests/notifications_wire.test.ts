/**
 * Wire test for /agent/notifications, /agent/notifications/read, and
 * /agent/notifications/scan (T0048 / MVP-gap §77).
 *
 * Wires buildApp() to a free local port with a mocked Supabase client so
 * the new route handlers run end-to-end without touching the network.
 *
 * Focus: wire contract (uuid validation, status codes, admin gating).
 * The detailed data-flow logic (listNotifications, markNotificationRead,
 * generateRemindersForUser) is covered in notification_center.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const NOTIF_ID = '99999999-9999-9999-9999-999999999999';

function makeMockSupabase(): SupabaseClient {
  // Permissive fallback: every chain resolves to an empty success.
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    gt: () => chain,
    gte: () => chain,
    lte: () => chain,
    in: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    update: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
    insert: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: any, reject: any) => {
      Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  const from = () => chain;
  return { from } as unknown as SupabaseClient;
}

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;

beforeAll(async () => {
  const app = buildApp({ supabase: makeMockSupabase() });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe('GET /agent/notifications', () => {
  it('returns 400 on bad client_user_id', async () => {
    const res = await fetch(`${baseUrl}/agent/notifications?client_user_id=not-a-uuid`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when client_user_id is missing', async () => {
    const res = await fetch(`${baseUrl}/agent/notifications`);
    expect(res.status).toBe(400);
  });

  it('returns 200 with empty list on valid uuid', async () => {
    const res = await fetch(`${baseUrl}/agent/notifications?client_user_id=${USER_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toEqual([]);
  });
});

describe('POST /agent/notifications/read', () => {
  it('returns 400 on bad client_user_id', async () => {
    const res = await fetch(`${baseUrl}/agent/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_user_id: 'bad', notification_id: NOTIF_ID }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on bad notification_id', async () => {
    const res = await fetch(`${baseUrl}/agent/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_user_id: USER_ID, notification_id: 'bad' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 on valid input', async () => {
    const res = await fetch(`${baseUrl}/agent/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_user_id: USER_ID, notification_id: NOTIF_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('POST /agent/notifications/scan (admin-gated)', () => {
  it('returns 503 when AGENT_ADMIN_TOKEN is unset', async () => {
    const res = await fetch(`${baseUrl}/agent/notifications/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_user_id: USER_ID }),
    });
    expect(res.status).toBe(503);
  });

  it('returns 400 on bad client_user_id when admin token is set', async () => {
    process.env.AGENT_ADMIN_TOKEN = 'test-admin-token';
    try {
      const res = await fetch(`${baseUrl}/agent/notifications/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-admin-token',
        },
        body: JSON.stringify({ client_user_id: 'bad' }),
      });
      expect(res.status).toBe(400);
    } finally {
      delete process.env.AGENT_ADMIN_TOKEN;
    }
  });

  it('returns 200 with summary when admin token matches and user has no saves', async () => {
    process.env.AGENT_ADMIN_TOKEN = 'test-admin-token';
    try {
      const res = await fetch(`${baseUrl}/agent/notifications/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-admin-token',
        },
        body: JSON.stringify({ client_user_id: USER_ID }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // Empty user → 0 inserted, 0 skipped, 0 eligible.
      expect(body.inserted).toBe(0);
      expect(body.skipped).toBe(0);
      expect(body.eligible).toBe(0);
    } finally {
      delete process.env.AGENT_ADMIN_TOKEN;
    }
  });
});
