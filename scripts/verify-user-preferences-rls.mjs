#!/usr/bin/env node
// Live-bevis: user_preferences RLS efter 20260920-0001 (anon sign-in-ägarmönster).
// Skapar en ENGÅNGS-anonym användare, bevisar ägar-RLS, raderar användaren igen.
// Skriver ALDRIG ut nycklar/tokens — endast PASS/FAIL + korta id-prefix.
// Kör: node scripts/verify-user-preferences-rls.mjs

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

const ui = loadEnv(join(root, '06-UI/.env.local'));
const server = loadEnv(join(root, '.env'));
const url = ui.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = ui.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = server.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('FAIL  saknar url/anon-key (06-UI/.env.local) eller service-role (.env)');
  process.exit(1);
}

const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

let userId = null;
try {
  const { data, error } = await anon.auth.signInAnonymously();
  check('signInAnonymously', !error && !!data?.session, error?.message);
  if (error || !data?.session) throw new Error('avbryter — ingen session');
  userId = data.user.id;

  // 1. Anonymous user kan skriva SIN egen rad (INSERT WITH CHECK auth.uid()).
  const { error: ierr } = await anon
    .from('user_preferences')
    .insert({ client_user_id: userId, preferences: { categories: ['music'], source: 'rls-verify' } });
  check('anon insert egen rad tillåts', !ierr, ierr?.message ?? 'OK');

  // 2. …och läsa tillbaka den (SELECT USING auth.uid()).
  const { data: own, error: serr } = await anon
    .from('user_preferences')
    .select('client_user_id, preferences')
    .eq('client_user_id', userId);
  const ownOk = !serr && own?.length === 1 && own[0].client_user_id === userId;
  check('anon select egen rad (1 rad, egen)', ownOk, serr?.message ?? 'OK');

  // 3. INSERT med ANNONAN användares id måste stoppas av WITH CHECK.
  const otherId = crypto.randomUUID();
  const { error: oerr } = await anon
    .from('user_preferences')
    .insert({ client_user_id: otherId, preferences: { source: 'rls-verify' } });
  let blocked = !!oerr;
  if (!blocked) {
    const { data: leaked } = await service
      .from('user_preferences')
      .select('client_user_id', { count: 'exact', head: true })
      .eq('client_user_id', otherId);
    blocked = (leaked ?? []).length === 0; // tyst no-op räknas också som blockerad
  }
  check('insert med annan användares id blockeras (RLS)', blocked, oerr?.message ?? 'ingen rad skapades');

  // 4. SELECT * visar BARA egna rader (cross-user isolation via policy).
  const { data: visible, error: verr } = await anon.from('user_preferences').select('client_user_id');
  const onlyOwn = !verr && (visible ?? []).every((r) => r.client_user_id === userId);
  check('anon select * synliggör endast egna rader', onlyOwn, `${(visible ?? []).length} synliga rader`);

  // 5. Rensning + CASCADE-bevis: ta bort engångsanvändaren → raden försvinner.
  const { error: derr } = await service.auth.admin.deleteUser(userId);
  check('admin.deleteUser på engångsanvändaren', !derr, derr?.message ?? 'OK');

  const { count: leftover } = await service
    .from('user_preferences')
    .select('*', { count: 'exact', head: true })
    .eq('client_user_id', userId);
  check('FK ON DELETE CASCADE tog bort prefs-raden', leftover === 0, `kvarvarande=${leftover}`);
  userId = null;

  console.log('\nanvändaren borttagen (cascade) — ingen rest kvar.');
} catch (e) {
  console.error('FAIL  undantag:', e.message);
  results.push(false);
} finally {
  if (userId) {
    // Best effort: lämna ingen engångsanvändare kvar om något kastade.
    await service.from('user_preferences').delete().eq('client_user_id', userId);
    await service.auth.admin.deleteUser(userId).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failed} steg)`);
process.exit(failed === 0 ? 0 : 1);
