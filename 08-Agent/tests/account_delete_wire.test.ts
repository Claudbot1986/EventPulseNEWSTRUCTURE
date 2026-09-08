/**
 * Wire test for DELETE /agent/account (Fas 2.5 / App Store §5.1.1(v)).
 *
 * Verifies the GDPR / Apple-required account-deletion endpoint:
 *   - 401 without Bearer token
 *   - 400 when body.confirmation is present but not 'DELETE'
 *   - 200 on success: explicit user_preferences.delete + auth.admin.deleteUser
 *   - 500 when admin.deleteUser returns an error
 *
 * The route is intentionally NOT best-effort — it MUST fail loudly so the
 * UI knows the deletion did not happen. We assert both Supabase calls
 * were made in the expected order so a regression that skips the
 * user_preferences pre-clean leaves orphan TEXT-keyed prefs behind is
 * caught at CI time.
 *
 * Run with: npx vitest run 08-Agent/tests/account_delete_wire.test.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../server';

const USER_ID = '00000000-0000-0000-0000-0000000000a1';

const TEST_BEARER = 'test-jwt';
const bearerHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...extra,
  Authorization: `Bearer ${TEST_BEARER}`,
});
const testVerify = async (token: string) => (token === TEST_BEARER
  ? { id: USER_ID, email: 'test@example.com' }
  : null);

interface CallLog {
  method: 'from.delete' | 'auth.admin.deleteUser';
  target: string;
  payload?: unknown;
}

let calls: CallLog[] = [];
let deleteUserError: { message: string } | null = null;

function makeMockSupabase(): unknown {
  calls = [];
  deleteUserError = null;

  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      calls.push({ method: 'from.delete', target: `eq:${col}=${val}` });
      return chain;
    },
    delete: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
  };

  return {
    from: () => chain,
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          calls.push({ method: 'auth.admin.deleteUser', target: id });
          if (deleteUserError) {
            return { data: null, error: deleteUserError };
          }
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };
}

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | undefined;

beforeAll(async () => {
  const app = buildApp({
    supabase: makeMockSupabase() as never,
    verify: testVerify,
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(() => {
  calls = [];
  deleteUserError = null;
});

const deleteAccount = (body?: unknown): Promise<Response> =>
  fetch(`${baseUrl}/agent/account`, {
    method: 'DELETE',
    headers: bearerHeaders({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('DELETE /agent/account', () => {
  it('returns 401 without a Bearer token', async () => {
    const res = await fetch(`${baseUrl}/agent/account`, { method: 'DELETE' });
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('returns 400 when confirmation is not the literal string "DELETE"', async () => {
    const res = await deleteAccount({ confirmation: 'delete' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_confirmation');
    expect(calls).toEqual([]);
  });

  it('returns 400 when confirmation is a non-string type', async () => {
    const res = await deleteAccount({ confirmation: 42 });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('returns 200 with empty body and calls both pre-clean + admin.deleteUser', async () => {
    const res = await deleteAccount();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Order matters: user_preferences pre-clean MUST run before the
    // auth.users deletion (otherwise orphans could be written under the
    // new anonymous device-id afterwards, but a paranoid sequence is
    // cleaner).
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      method: 'from.delete',
      target: `eq:client_user_id=${USER_ID}`,
    });
    expect(calls[1]).toEqual({
      method: 'auth.admin.deleteUser',
      target: USER_ID,
    });
  });

  it('returns 200 when confirmation === "DELETE" (explicit ack)', async () => {
    const res = await deleteAccount({ confirmation: 'DELETE' });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('returns 500 when admin.deleteUser fails', async () => {
    deleteUserError = { message: 'user not found' };
    const res = await deleteAccount();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('delete_failed');
    expect(body.message).toBe('user not found');
    // The pre-clean still ran — order is preserved.
    expect(calls).toHaveLength(2);
  });

  it('returns 500 when admin.deleteUser throws unexpectedly', async () => {
    // Override the chain to throw from deleteUser.
    // (We rebuild the app with a custom mock for this single test.)
    deleteUserError = null;
    const throwingSupabase = {
      from: (_table: string) => ({
        delete: () => ({
          eq: (col: string, val: unknown) => {
            calls.push({ method: 'from.delete', target: `eq:${col}=${val}` });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      auth: {
        admin: {
          deleteUser: async () => {
            calls.push({ method: 'auth.admin.deleteUser', target: USER_ID });
            throw new Error('boom');
          },
        },
      },
    };

    // Stop the shared server, spin up a new one with the throwing client.
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const app = buildApp({
      supabase: throwingSupabase as never,
      verify: testVerify,
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server!.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    calls = [];
    const res = await fetch(`${baseUrl}/agent/account`, {
      method: 'DELETE',
      headers: bearerHeaders({ 'Content-Type': 'application/json' }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('delete_failed');
    expect(body.message).toBe('boom');
  });
});
