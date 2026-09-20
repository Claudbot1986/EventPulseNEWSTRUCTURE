/**
 * Wire + unit tests for the email-auth landing page (GET /auth/callback).
 *
 * Context: Supabase verify-links used to dead-end on localhost:3000 when
 * the mail was opened anywhere but inside the app's custom scheme. The
 * page is what the browser actually loads after GoTrue has verified the
 * token — it must (a) exist on the real HTTPS server, (b) bounce the
 * fragment tokens into the installed app via eventpulse://, and (c) never
 * inject attacker-controlled query strings into the DOM (textContent only).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildApp } from '../server';
import {
  APP_DEEP_LINK,
  AUTH_CALLBACK_PATH,
  renderAuthCallbackPage,
} from '../services/authCallbackPage';

// The page route never touches Supabase; buildApp still requires a client
// (createRequireUser resolves it eagerly), so hand it a harmless stub.
const sbStub = {} as SupabaseClient;

let baseUrl = '';
let server: ReturnType<ReturnType<typeof buildApp>['listen']> | null = null;

beforeAll(async () => {
  const app = buildApp({ supabase: sbStub, verify: async () => null });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server ? server.close((err) => (err ? reject(err) : resolve())) : resolve()
  );
});

describe('GET /auth/callback (wire)', () => {
  it('serves 200 text/html with the auth-landing page', async () => {
    const res = await fetch(`${baseUrl}${AUTH_CALLBACK_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('EventPulse');
    expect(body).toContain(APP_DEEP_LINK);
  });

  it('is marked no-store + no-referrer and locked down with CSP (tokens in fragment)', async () => {
    const res = await fetch(`${baseUrl}${AUTH_CALLBACK_PATH}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    await res.arrayBuffer();
  });

  it('accepts a fragment-less and error-query visit without crashing (200 both)', async () => {
    const bare = await fetch(`${baseUrl}${AUTH_CALLBACK_PATH}`);
    expect(bare.status).toBe(200);
    await bare.arrayBuffer();
    const withError = await fetch(
      `${baseUrl}${AUTH_CALLBACK_PATH}?error=access_denied&error_description=otp_expired`
    );
    expect(withError.status).toBe(200);
    await withError.arrayBuffer();
  });
});

describe('renderAuthCallbackPage (unit)', () => {
  const html = renderAuthCallbackPage();

  it('bounces tokens into the app scheme via location.replace', () => {
    expect(html).toContain("indexOf('access_token=')");
    expect(html).toContain('window.location.replace');
    expect(html).toContain(APP_DEEP_LINK);
  });

  it('renders Swedish confirmation copy', () => {
    expect(html).toContain('Din e-post är bekräftad');
    expect(html).toContain('Öppna EventPulse-appen');
  });

  it('never interpolates dynamic strings as HTML (textContent only)', () => {
    expect(html).toContain('.textContent');
    expect(html).not.toContain('innerHTML');
  });
});
