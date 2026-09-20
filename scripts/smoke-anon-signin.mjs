#!/usr/bin/env node
// Smoke-test: Supabase anonymous sign-ins mot projektet i 06-UI/.env.local.
// Skriver ALDRIG ut nycklar eller tokens — endast PASS/FAIL + korta id-prefix.
// Kör: node scripts/smoke-anon-signin.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

const env = loadEnv(join(root, '06-UI/.env.local'));
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('FAIL  saknar EXPO_PUBLIC_SUPABASE_URL/ANON_KEY i 06-UI/.env.local');
  process.exit(1);
}

const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const decodeJwtPayload = (jwt) =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

try {
  const { data, error } = await supabase.auth.signInAnonymously();
  check('signInAnonymously returnerar session', !error && !!data?.session, error?.message);
  if (error || !data?.session) throw new Error('avbryter — ingen session');

  const user = data.user;
  check('user.is_anonymous === true', user?.is_anonymous === true);

  const payload = decodeJwtPayload(data.session.access_token);
  check('JWT har is_anonymous=true-claim', payload.is_anonymous === true);
  check('JWT sub matchar user.id', payload.sub === user.id);

  const { data: ref, error: rerr } = await supabase.auth.refreshSession();
  const okRefresh =
    !rerr && ref?.session && decodeJwtPayload(ref.session.access_token).sub === user.id;
  check('refreshSession fungerar, sub oförändrat', !!okRefresh, rerr?.message);

  const { error: perr } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });
  // RLS-block (permission) räknas som PASS — nyckeln accepterades av gateway:en.
  const probeOk = !perr || /permission|policy|rls/i.test(perr.message ?? '');
  check('anon-JWT accepteras av PostgREST (events head-count)', probeOk, perr?.message ?? 'OK');

  console.log(`\nanon user id-prefix: ${user.id.slice(0, 8)}…`);
} catch (e) {
  console.error('FAIL  undantag:', e.message);
  results.push(false);
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failed} steg)`);
process.exit(failed === 0 ? 0 : 1);
